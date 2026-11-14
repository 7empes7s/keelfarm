// The Researcher (#664): every research job (the manager's "Research: <topic>", Plan → Research first, the CEO's
// request_research) runs at the Researcher's desk in the lobby, in a session of its own on the office's default coding
// agent and model, one at a time, never in the CEO's: the CEO's chat stays free. Read-only office tools plus the web;
// past its budget it is stopped with a partial brief. The brief is saved as a file and posted as a card on the
// manager's phone, and comes back to the CEO: as a plan job for its floor, else as a follow-up. Rules in
// shared/research.ts, prompts in server/research.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ceoModelOn } from '../../shared/ceoRunsOn.ts';
import { stripHarness } from '../../shared/chat.ts';
import { finishResearch, loadResearch, nextResearch, queueResearch, RESEARCHER_ID, RESEARCHER_NAME, researcherView, researchStatus, type ResearchRequest } from '../../shared/research.ts';
import { takeResearchCard, updateResearchCard } from '../../shared/chatSender.ts';
import type { AgentStatus, ChatResearch, WorldSnapshot } from '../../shared/types.ts';
import { createOfficeTools, toolServer, type CeoJob, type OfficeHandlers, type OfficeTools } from '../ceo.ts';
import type { RequestResearchArgs } from '../ceoResearchTools.ts';
import type { WaitWorld } from '../ceoWaits.ts';
import { HOME_DIR } from '../config.ts';
import { HttpError } from '../httpError.ts';
import { recordCost } from '../metrics.ts';
import { clampResearchMin, RESEARCH_TOOL_NAMES, researcherSystemPrompt, researchPrompt, researchReadOnly, ResearchGuard, saveBrief, short } from '../research.ts';
import { CEO_DIR, type PersistedAgent } from './model.ts';
import { SwarmChecklists } from './checklists.ts';

const DESK_DIR = path.join(HOME_DIR, 'researcher');
/** Where briefs are saved: a reply to one saves it here too (research.ts researchJob). */
const BRIEF_DIR = path.join(CEO_DIR, 'research');

/** The Researcher's office tools: the read-only ones only, and every other handler refused all the same. */
export function researcherTools(h: OfficeHandlers): OfficeTools {
  return toolServer(createOfficeTools(researchReadOnly(h, () => true)).defs.filter((d) => RESEARCH_TOOL_NAMES.has(d.name)));
}

export abstract class SwarmResearcher extends SwarmChecklists {
  private researcherAgent: PersistedAgent | null = null;
  private researchGuard = new ResearchGuard();
  /** Why the running job was stopped early (its budget, the manager's Stop), or null. */
  private researchStopped: string | null = null;

  /** The Researcher as a session sees them: CEO-like (no shell), on the office's default coding agent, model and effort. */
  protected researcher(): PersistedAgent {
    const s = this.state.settings;
    const a = (this.researcherAgent ??= {
      id: RESEARCHER_ID, name: RESEARCHER_NAME, repoId: '', role: 'ceo', look: 'feminine', task: null, desk: 0, color: '#6a4c93', hair: '#1d1d1d', skin: '#8d5524', style: null,
      model: s.defaultModel, effort: s.defaultEffort, cli: s.defaultCli, machine: null, status: 'idle', issueNumber: null, issueTitle: null, branch: null, prNumber: null, prUrl: null,
      startedAt: null, endedAt: null, costUsd: this.state.research.costUsd, turns: 0, sessionId: null, sessionCli: null, lastError: null, logTail: [],
    });
    Object.assign(a, { model: s.defaultModel, effort: s.defaultEffort, cli: s.defaultCli });
    if (!this.agentRt.has(a.id)) this.agentRt.set(a.id, { log: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [], terminal: null });
    return a;
  }

  /** The saved queue and briefs, from the state file (shared/research.ts loadResearch). */
  protected loadResearchState(raw: unknown) {
    return loadResearch(raw);
  }

  /** wait_for's research_done reads the Researcher's requests and briefs. */
  protected override waitWorld(): WaitWorld {
    return { ...super.waitWorld(), research: (id) => researchStatus(this.state.research, id) };
  }

  override snapshot(): WorldSnapshot {
    return { ...super.snapshot(), research: researcherView(this.state.research) };
  }

  private researchChanged() {
    this.broadcast({ type: 'research', research: researcherView(this.state.research) });
    this.save();
  }

  /** Started once from init: research the CEO's queue held from before #664 moves to the Researcher, and a job a restart cut off starts again. */
  protected override async startUsage() {
    const c = this.state.ceo;
    for (const j of c.queue.filter((x) => x.kind === 'research')) this.researchFromCeoJob(j);
    c.queue = c.queue.filter((x) => x.kind !== 'research');
    setTimeout(() => this.startResearch(), 3000);
    await super.startUsage();
  }

  /** Research never goes into the CEO's queue: every research job comes to the Researcher's desk. */
  protected override enqueueCeo(job: CeoJob) {
    if (job.kind !== 'research') return super.enqueueCeo(job);
    const r = this.researchFromCeoJob(job);
    if (!r.joined) this.researchCard(r.request, r.ahead ? { state: 'queued' } : { state: 'running', startedAt: Date.now() }, `🔎 ${RESEARCHER_NAME} ${r.ahead ? `will research "${short(r.request.topic)}" next (${r.ahead} ahead)` : `is researching "${short(r.request.topic)}"`}: up to ${r.request.minutes} min. ${this.ceo().name} stays free to chat.`);
  }

  /** A research job's interim card (#679): its new state goes into its card in the chat, else a new card. Never spoken or pushed. */
  private researchCard(req: ResearchRequest, card: Omit<ChatResearch, 'topic'>, text: string) {
    const research: ChatResearch = { topic: req.topic, ...(req.repoId && { repoId: req.repoId }), job: req.id, budget: req.minutes, ...card };
    const m = updateResearchCard(this.state.messages, req.id, { text, research });
    if (!m) return void this.postMessage('office', text, undefined, { research });
    this.broadcast({ type: 'ceoChat', message: m });
    this.save();
  }

  private researchFromCeoJob(job: CeoJob) {
    return this.queueResearchJob({ topic: job.topic ?? '', ...(job.repoId && { repoId: job.repoId }), by: 'manager', ...(job.messageIds?.length && { messageIds: job.messageIds }), minutes: this.state.settings.researchMin, at: job.at });
  }

  private queueResearchJob(req: Omit<ResearchRequest, 'id'>) {
    const r = queueResearch(this.state.research, req);
    if (req.messageIds?.length) this.markDelivery(req.messageIds, 'read');
    this.researchChanged();
    setTimeout(() => this.startResearch(), 50);
    return r;
  }

  /** The CEO's request_research: queued at once, never waited on here. */
  protected requestResearch(a: RequestResearchArgs): string {
    const topic = String(a.topic ?? '').trim().slice(0, 1000);
    if (!topic) throw new Error('Say what to research.');
    const repo = a.floor === undefined ? undefined : this.floorRepo(a.floor);
    const questions = (a.questions ?? []).map((q) => String(q).trim().slice(0, 300)).filter(Boolean).slice(0, 8);
    const minutes = a.deadline_min === undefined ? this.state.settings.researchMin : clampResearchMin(a.deadline_min);
    const r = this.queueResearchJob({ topic, ...(repo && { repoId: repo.id }), ...(questions.length && { questions }), minutes, by: 'ceo', at: Date.now() });
    if (!r.joined) this.researchCard(r.request, r.ahead ? { state: 'queued' } : { state: 'running', startedAt: Date.now() }, `🔎 ${this.ceo().name} asked ${RESEARCHER_NAME} to research "${short(topic)}"${repo ? ` for floor ${repo.floor}` : ''}: up to ${minutes} min.`);
    const back = repo ? `as a plan job for floor ${repo.floor}` : 'as a follow-up';
    return `Queued research #${r.request.id} with ${RESEARCHER_NAME} (${r.ahead ? `${r.ahead} ahead` : 'starting now'}, up to ${r.request.minutes} min). Don't search the web yourself: carry on or end this job. The brief reaches the manager's phone and comes back to you ${back}; wait_for research_done (research ${r.request.id}) holds for it.`;
  }

  /** POST /api/research/stop: the running job stops and posts what it has as a partial brief. */
  stopResearch() {
    const session = this.agentRt.get(RESEARCHER_ID)?.session;
    if (!this.state.research.job || !session) throw new HttpError(409, 'No research is running.');
    this.researchStopped = 'the manager stopped it';
    session.stop();
    return { ok: true };
  }

  /** The next job, when the desk is free: one at a time (the server's memory is shared). */
  protected startResearch() {
    const r = this.state.research;
    if (r.job || !r.queue.length || this.officeUpdate.sent || this.agentRt.get(RESEARCHER_ID)?.session) return;
    const job = nextResearch(r, Date.now())!;
    this.researchChanged();
    void this.runResearch(job);
  }

  private async runResearch(job: NonNullable<typeof this.state.research.job>) {
    const a = this.researcher();
    const rt = this.agentRt.get(a.id)!;
    const cli = this.ceoCliOf(a);
    const how = this.sessionRuntime(a);
    const repo = job.repoId ? this.state.repos.find((x) => x.id === job.repoId) : undefined;
    const floor = repo ? { floor: repo.floor, fullName: repo.fullName, clone: this.backend.mainDir(repo.fullName) } : null;
    Object.assign(a, { status: 'working' as AgentStatus, issueTitle: `Researching "${short(job.topic)}"`, startedAt: Date.now(), endedAt: null, lastError: null });
    this.researchStopped = null;
    this.researchCard(job, { state: 'running', startedAt: job.startedAt }, `🔎 ${RESEARCHER_NAME} is researching "${short(job.topic)}": up to ${job.minutes} min.`);
    await fs.mkdir(DESK_DIR, { recursive: true }).catch(() => undefined);
    const turns: string[] = [];
    rt.session = this.startOnAccount(
      a,
      {
        cwd: DESK_DIR,
        prompt: researchPrompt(job.topic, floor, job.minutes, { by: job.by, questions: job.questions }),
        systemAppend: researcherSystemPrompt({ name: a.name, company: this.state.settings.companyName, ceo: this.ceo().name }),
        model: ceoModelOn(cli, this.state.settings.defaultModel, this.state.settings, ''),
        effort: this.state.settings.defaultEffort,
        browserTesting: false,
        additionalDirectories: this.state.repos.filter((r) => this.repoRt.get(r.id)?.cloneStatus === 'ready').map((r) => this.backend.mainDir(r.fullName)),
        role: 'ceo',
        office: researcherTools(this.officeHandlers()),
        tools: this.sessionToolsFor(a, how.cli),
        keepAlive: false,
        ...how,
      },
      {
        log: (entries) => this.appendLog(a, entries),
        tool: (name) => void (rt.currentTool = name),
        sessionId: () => undefined,
        browserUrl: () => undefined,
        screenshot: () => undefined,
        turn: (raw) => {
          const text = stripHarness(raw);
          if (text.trim()) turns.push(text);
        },
        limited: (at) => this.pauseForLimit(at),
        usage: (readings) => this.recordUsage(readings),
        finished: (result) => {
          rt.session = null;
          rt.currentTool = null;
          this.researchGuard.clear();
          const now = Date.now();
          recordCost(this.state.ops, '', result.costUsd, now);
          const stopped = this.researchStopped;
          const partial = !!stopped || !result.ok;
          const why = stopped ?? (result.ok ? null : result.errors.join('; ') || 'the session failed');
          Object.assign(a, { costUsd: a.costUsd + result.costUsd, turns: a.turns + result.turns, endedAt: now, status: (partial ? (stopped ? 'stopped' : 'error') : 'done') as AgentStatus, lastError: why });
          // Wrapped up: its final message. Stopped or failed: everything it wrote, so nothing it found is lost.
          const text = partial ? turns.join('\n\n') : (turns.at(-1) ?? result.text);
          void this.deliverBrief(job, text, { costUsd: result.costUsd, why, partial, now });
        },
      },
    );
    this.researchGuard.start(job.minutes, job.topic, () => rt.session, (note) => void (this.researchStopped = note));
  }

  /** The brief: a card on the manager's phone (a reply to it hands off, research.ts), a file, and back to the CEO. */
  private async deliverBrief(job: NonNullable<typeof this.state.research.job>, text: string, o: { costUsd: number; why: string | null; partial: boolean; now: number }) {
    const minutes = Math.max(1, Math.round((o.now - job.startedAt) / 60_000));
    const cost = `$${o.costUsd.toFixed(2)}`;
    const head = `🔎 ${RESEARCHER_NAME}'s research on "${short(job.topic)}" · ${minutes} min · ${cost}${o.partial ? ` · stopped early (${o.why}): a partial brief` : ''}`;
    const body = text.trim() || `Nothing written yet. Ask again with a narrower topic or a bigger budget.`;
    // the job's interim card gives way: the brief is its card now, at the end of the chat
    const card = takeResearchCard(this.state.messages, job.id);
    if (card) this.broadcast({ type: 'ceoChat', removed: [card.id] });
    const research: ChatResearch = { topic: job.topic, ...(job.repoId && { repoId: job.repoId }), job: job.id, state: o.partial ? 'partial' : 'done', startedAt: job.startedAt, budget: job.minutes, minutes, usd: o.costUsd };
    const m = this.postMessage('ceo', `${head}\n\n${body}`, undefined, { research });
    const file = await saveBrief(path.join(BRIEF_DIR, `${m.id}.md`), m.artifacts?.length ? m.artifacts : [{ id: `${m.id}-0`, title: `Research: ${short(job.topic)}`, lead: '', markdown: m.text }]);
    const summary = m.text.slice(0, 600);
    finishResearch(this.state.research, { id: job.id, topic: job.topic, by: job.by, ...(job.repoId && { repoId: job.repoId }), file, summary, minutes, costUsd: o.costUsd, partial: o.partial, at: o.now });
    this.state.ceo.researchedAt = o.now; // the guide's tick (#496)
    if (job.messageIds?.length) {
      this.markDelivery(job.messageIds, 'replied');
      this.markStatus(job.messageIds, o.partial ? 'failed' : 'replied');
    }
    if (job.by === 'ceo') {
      // A plan job carries on with the brief; anything else comes back as a follow-up.
      if (job.repoId && this.state.repos.some((r) => r.id === job.repoId)) super.enqueueCeo({ kind: 'plan', repoId: job.repoId, topic: job.topic, ...(file && { brief: file }), at: o.now });
      else this.followup({ kind: 'research', key: `research:${job.id}`, label: `research on "${short(job.topic)}" done`, text: `The Researcher finished your request_research #${job.id} "${short(job.topic)}"${o.partial ? ' (a partial brief)' : ''}.${file ? ` Brief: ${file}.` : ''} ${summary.slice(0, 300)}` });
    }
    this.emitCeo();
    this.researchChanged();
    setTimeout(() => this.startResearch(), 200);
  }
}

