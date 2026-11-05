// The CEO's office tools (ceo.ts createOfficeTools): what each one reads and does.
import crypto from 'node:crypto';
import {
  checkCloseIssue,
  createOfficeTools,
  experimentInput,
  floorCapacity,
  issueRefusal,
  MANDATE_NOT_ASKED,
  planDependencies,
  prDiffText,
  agentLogText,
  qaReportText,
  AGENT_LOG_MAX as AGENT_LOG_MAX_LINES,
  type OfficeHandlers,
  type OfficeTools,
} from '../ceo.ts';
import { researchReadOnly } from '../research.ts';
import { nameList } from '../closeCleanup.ts';
import { HttpError } from '../httpError.ts';
import { parsePreviewPatch } from '../previews.ts';
import { qaShotFile, qaShotsDir } from '../qaShots.ts';
import { answerPrompt, escalated, newQuestion, questionEvent, questionFromTurn, questionOf, type AgentQuestion } from '../../shared/questions.ts';
import { readingsLabel } from '../../shared/usage.ts';
import { usageLabel } from '../pacing.ts';
import { floorSpend } from '../costLedger.ts';
import { checkRestart, sessionKind } from '../health.ts';
import { resumesAfterRestart } from '../restartRecovery.ts';
import { blockers } from '../../shared/issues.ts';
import { redact as scrub } from '../../shared/journal.ts';
import { historyText } from '../../shared/history.ts';
import { mandateFor, MAX_MANDATES } from '../../shared/followups.ts';
import { PLAYBOOK_MAX } from '../../shared/types.ts';
import { OFFICE_PLAYBOOK_MAX } from '../../shared/officePlaybook.ts';
import type { HireRequestView } from '../../shared/types.ts';
import { type PersistedAgent, type PersistedRepo, CEO_MODEL, CEO_EFFORT, BUSY, QA_SHOTS_DIR } from './model.ts';
import { clip } from '../notify.ts';
import { SwarmTeam } from './team.ts';

export abstract class SwarmCeoTools extends SwarmTeam {
  /**
   * The CEO's office tools. Every session gets its own server: one can only be connected to one session at a time, so
   * a shared one left the next session connected but without any tools while an earlier session still held it.
   */
  protected officeTools(): OfficeTools {
    const acts = this.spend.acts;
    return createOfficeTools(researchReadOnly({
      companyStatus: () => this.companyStatus(),
      agentDetail: (a) => this.agentDetail(a),
      setFloorProfile: acts((a) => this.setFloorProfile(a)),
      setOfficePlaybook: acts((a) => `Saved the office playbook (${this.setOfficePlaybook(a.playbook).length} of ${OFFICE_PLAYBOOK_MAX} characters).`),
      scaleTeam: acts((a) => this.scaleTeam(a)),
      configureAgent: acts((a) => this.configureAgent(a)),
      fileIssue: (a) => this.fileIssue(a),
      setDependencies: acts((a) => this.setDependencies(a)),
      closeIssue: acts((a) => this.closeIssue(a)),
      retryQa: acts((a) => this.triageRetryQa(a)),
      sendBack: acts((a) => this.triageSendBack(a)),
      rerunChecks: acts((a) => this.triageRerunChecks(a)),
      closePull: acts((a) => this.triageClosePull(a)),
      escalate: acts((a) => this.triageEscalate(a)),
      attachFile: (a) => this.ceoFiles.attach(a),
      keepFile: (a) => this.ceoFiles.keep(a),
      setMandate: acts((a) => this.setMandate(a)),
      defineExperiment: acts((a) => this.lab.defineText(experimentInput(a, (n) => this.state.repos.find((r) => r.floor === n)?.id ?? null))),
      agentLog: (a) => this.agentLog(a),
      restartAgent: acts((a) => this.restartAgent(a)),
      messageAgent: acts((a) => this.messageAgent(a)),
      answerAgent: acts((a) => this.answerAgent(a)),
      askManagerChoice: acts((a) => this.askManagerChoice(a)),
      qaReport: (a) => this.qaReport(a),
      worktreeFile: (a) => this.worktreeFile(a),
      prDiff: (a) => this.prDiff(a),
      sendTelegram: (a) => this.sendTelegram(a),
      sessionHistory: (a) => this.sessionHistory(a),
    }, () => this.state.ceo.job?.kind === 'research'));
  }

  // ---------- the CEO's office tools ----------

  protected floorRepo(floor: number) {
    const r = this.state.repos.find((x) => x.floor === Number(floor));
    if (!r) throw new Error(`There is no floor ${floor}. Floors: ${this.state.repos.map((x) => `${x.floor} (${x.fullName})`).join(', ') || 'none'}.`);
    return r;
  }

  protected agentByRef(ref: string) {
    const r = String(ref ?? '').trim().toLowerCase();
    const a = this.state.agents.find((x) => x.id === ref || x.name.toLowerCase() === r);
    if (!a) throw new Error(`No agent "${ref}". Use the ids from company_status.`);
    return a;
  }

  protected agentDoing(a: PersistedAgent) {
    return !BUSY.includes(a.status) ? null : a.task === 'qa' ? `testing PR #${a.prNumber}` : a.task === 'fix' ? `fixing PR #${a.prNumber}` : `issue #${a.issueNumber}`;
  }

  /** What an agent runs, defaults resolved, for the CEO. */
  protected agentSetup(a: PersistedAgent) {
    const ceo = a.role === 'ceo';
    const cli = ceo ? 'claude' : a.cli || this.state.settings.defaultCli;
    return {
      codingAgent: cli,
      model: ceo ? a.model || CEO_MODEL : this.modelFor(a, cli) || 'the coding agent default',
      effort: a.effort || (ceo ? CEO_EFFORT : this.state.settings.defaultEffort),
    };
  }

  protected companyStatus() {
    const s = this.state.settings;
    const ops = this.opsNow();
    const pending = this.state.requests.filter((r) => r.status === 'pending');
    const floors = [...this.state.repos]
      .sort((x, y) => x.floor - y.floor)
      .map((r) => {
        const rt = this.repoRt.get(r.id)!;
        const open = new Set(rt.issues.map((i) => i.number));
        const team = this.teamNow(r);
        const nums = ops.floors.find((f) => f.repoId === r.id);
        return {
          floor: r.floor,
          repo: r.fullName,
          description: r.description,
          clone: rt.cloneStatus === 'ready' ? this.backend.mainDir(r.fullName) : `(not available: clone ${rt.cloneStatus})`,
          brief: r.mission || null,
          profile: r.summary || null,
          qaBrief: r.qaBrief || null,
          playbook: r.playbook || null,
          preview: { command: r.preview.command, env: r.preview.env, status: this.previews.view(r).status },
          autoAssign: r.autoAssign,
          autoMerge: r.autoMerge,
          folderSync: rt.folderSync,
          team: { size: team.agents.length, max: s.maxAgents, free: this.available(r).length, pendingHires: team.pendingHires.length, pendingLetGos: team.pendingLetGos.length },
          throughput: {
            mergedLastHour: nums?.mergedHour ?? 0,
            mergedToday: nums?.mergedToday ?? 0,
            medianLeadMinutes: nums?.leadMs != null ? Math.round(nums.leadMs / 60_000) : null,
            qaPassRate: nums?.qaPass ?? null,
            qaFirstRoundPassRate: nums?.qaFirstPass ?? null,
            qaRoundsPerMerge: nums?.qaRoundsPerMerge != null ? Math.round(nums.qaRoundsPerMerge * 100) / 100 : null,
          },
          spend: floorSpend(this.spend.ledger.all(), r.id, Date.now()),
          capacity: {
            issuesReadyToStart: this.readyIssues(r).length,
            ...floorCapacity({
              issues: rt.issues,
              inProgress: (n) => this.issueTaken(r, n),
              openPrs: rt.pulls.filter((p) => p.state === 'OPEN').map((p) => p.number),
              qa: this.state.qa.filter((q) => q.repoId === r.id),
            }),
          },
          agents: this.state.agents
            .filter((a) => a.repoId === r.id)
            .map((a) => ({ id: a.id, name: a.name, status: a.status, doing: this.agentDoing(a), ...this.agentSetup(a) })),
          backlog: rt.issues.map((i) => ({
            number: i.number,
            title: i.title,
            waitsFor: blockers(i.body, open),
            inProgress: this.issueTaken(r, i.number),
            ...(this.isHeld(r.id, i.number) ? { waitsForManager: 'its PR was closed; only the manager hands it out again' } : {}),
          })),
          pullRequests: rt.pulls
            .filter((p) => p.state === 'OPEN')
            .map((p) => {
              const q = this.state.qa.find((x) => x.repoId === r.id && x.prNumber === p.number);
              return { number: p.number, title: p.title, qa: q ? `${q.status}${q.round > 1 ? ` (round ${q.round})` : ''}` : 'not tested', merge: q?.mergeNote ?? null, checks: p.checks };
            }),
          mergedRecently: rt.pulls.filter((p) => p.state === 'MERGED').map((p) => `#${p.number} ${p.title}`),
          questions: this.state.questions.filter((q) => q.repoId === r.id).map((q) => ({ agent: q.agentId, name: q.agentName, issue: q.issue, pr: q.pr, question: q.text, options: q.options, waitingFor: q.to === 'ceo' ? 'you' : 'the manager' })),
        };
      });
    const req = (r: HireRequestView) => ({
      id: r.id,
      kind: r.kind,
      floor: this.state.repos.find((x) => x.id === r.repoId)?.floor ?? null,
      name: r.name,
      reason: r.reason,
      status: r.status,
      managerNote: r.note || null,
    });
    return JSON.stringify(
      {
        company: {
          ceo: this.ceo().name,
          scaling: s.scaling === 'auto' ? 'team changes apply straight away' : 'the manager approves every team change',
          maxAgentsPerFloor: s.maxAgents,
          sessionLimit: s.sessionLimit || 'none',
          sessionsRunning: this.running(),
          usage: `${usageLabel(this.usageNow(), Date.now())} · ${readingsLabel(this.state.claudeUsage, Date.now())}`,
          experiments: this.lab.summary(), // only the manager starts, stops and promotes them
          officePlaybook: s.officePlaybook || null,
        },
        floors,
        pendingChanges: pending.map(req),
        recentDecisions: this.state.requests.filter((r) => r.status !== 'pending').slice(-10).map(req),
      },
      null,
      1,
    );
  }

  protected agentDetail(x: { agent_id: string }) {
    const a = this.agentByRef(x.agent_id);
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    return JSON.stringify(
      {
        id: a.id,
        name: a.name,
        floor: repo?.floor ?? null,
        ...(a.role === 'ceo' ? { role: 'CEO' } : {}),
        status: a.status,
        doing: this.agentDoing(a),
        issue: a.issueNumber ? { number: a.issueNumber, title: a.issueTitle } : null,
        pullRequest: a.prNumber ? { number: a.prNumber, url: a.prUrl } : null,
        ...this.agentSetup(a),
      },
      null,
      1,
    );
  }

  protected setFloorProfile(x: { floor: number; summary?: string; qa_brief?: string; playbook?: string; preview_command?: string; preview_env?: Record<string, string> }) {
    const r = this.floorRepo(x.floor);
    const preview = parsePreviewPatch(x.preview_command, x.preview_env);
    if (x.summary !== undefined) r.summary = String(x.summary).trim().slice(0, 140);
    if (x.qa_brief !== undefined) r.qaBrief = String(x.qa_brief).trim().slice(0, 2500);
    if (x.playbook !== undefined) r.playbook = String(x.playbook).trim().slice(0, PLAYBOOK_MAX);
    r.preview = { ...r.preview, ...preview };
    if (preview.command === null) void this.previews.refreshDefault(r);
    this.emitRepo(r);
    this.save();
    return `Saved floor ${r.floor}'s profile.`;
  }

  /** The office-wide playbook (#50), from Settings or set_office_playbook; over its cap it's refused, not cut. */
  setOfficePlaybook(text: unknown): string {
    const t = typeof text === 'string' ? text.trim() : '';
    if (t.length > OFFICE_PLAYBOOK_MAX) throw new HttpError(400, `The office playbook is ${t.length} characters: keep it to ${OFFICE_PLAYBOOK_MAX}, it is in every session's prompt.`);
    this.state.settings.officePlaybook = t;
    this.save();
    this.broadcast({ type: 'settings', settings: this.state.settings });
    return t;
  }

  /** configure_agent: an agent's coding agent, model or effort, from their next task. */
  protected configureAgent(x: { agent_id: string; cli?: string; model?: string; effort?: string; tools_off?: string[]; tools_on?: string[]; tools_reset?: string[] }) {
    const a = this.agentByRef(x.agent_id);
    if (a.role === 'ceo') throw new Error("That's you: the manager sets the CEO up.");
    const switches = [...(x.tools_off ?? []).map((r) => [r, false] as const), ...(x.tools_on ?? []).map((r) => [r, true] as const), ...(x.tools_reset ?? []).map((r) => [r, null] as const)];
    if (x.cli === undefined && x.model === undefined && x.effort === undefined && !switches.length) throw new Error('Nothing to change: pass cli, model, effort, tools_off, tools_on, tools_reset or a mix.');
    // Switching off only takes away. Turning on, or undoing a switch, can undo the manager's own: only when they asked.
    if (!this.ceoAsked && switches.some(([, on]) => on !== false)) throw new Error('tools_on and tools_reset only when the manager asks for it in their message; tools_off is always allowed.');
    // Every name is checked before anything changes.
    const items = this.tooling.items;
    const picked = switches.map(([ref, on]) => {
      const item = items.find((i) => i.id === ref) ?? items.find((i) => i.name.toLowerCase() === ref.toLowerCase());
      if (!item) throw new Error(`No tool, plugin, skill or MCP server called "${ref}". Some there are: ${items.filter((i) => !i.locks).slice(0, 15).map((i) => i.name).join(', ')}.`);
      if (item.locks?.agent) throw new Error(`${item.name} can't be switched for agents: ${item.locks.agent.why}.`);
      return { item, on };
    });
    if (x.cli !== undefined || x.model !== undefined || x.effort !== undefined) this.updateAgent(a.id, { cli: x.cli, model: x.model, effort: x.effort });
    for (const { item, on } of picked) this.setToolSwitch(a.id, item.id, on);
    const setup = this.setupLabel(a) || 'the office defaults';
    const tools = picked.map(({ item, on }) => `${item.name} ${on === null ? 'as the office has it' : on ? 'on' : 'off'}`).join(', ');
    this.appendLog(a, [{ kind: 'system', text: `⚙️ ${this.ceo().name} set ${a.name} up with ${setup}${tools ? `; ${tools}` : ''}.` }]);
    return `${a.name} runs ${setup}${tools ? ` with ${tools}` : ''} from their next task.`;
  }

  protected async fileIssue(x: { floor: number; title: string; body: string }) {
    const repo = this.floorRepo(x.floor);
    const refused = issueRefusal({ kind: this.state.ceo.job?.kind ?? null, asked: this.ceoAsked, floor: repo.floor, mandate: mandateFor(this.state.settings.ceoMandates, repo.floor, Date.now()) });
    if (refused) throw new Error(refused);
    this.ceoIssues.check();
    const title = String(x.title ?? '').trim().slice(0, 120);
    if (!title) throw new Error('An issue needs a title.');
    const body = `${String(x.body ?? '').trim()}\n\n---\n_Filed by ${this.ceo().name}, the cubefarm CEO._`;
    const n = await this.backend.createIssue(repo.fullName, title, body);
    this.ceoIssues.record(repo.id);
    return `Filed #${n} on floor ${repo.floor}: ${title}.`;
  }

  /** Rewrite an open issue's "Depends on #N" line (see planDependencies for what is refused). */
  protected async setDependencies(x: { floor: number; number: number; depends_on: number[] }) {
    const repo = this.floorRepo(x.floor);
    const issues = this.repoRt.get(repo.id)?.issues ?? [];
    const deps = (x.depends_on ?? []).map(Number);
    const asked = [Number(x.number), ...deps].filter((n) => !issues.some((i) => i.number === n));
    const states = new Map(await Promise.all([...new Set(asked)].map(async (n) => [n, await this.backend.issueState(repo.fullName, n).catch(() => null)] as const)));
    const plan = planDependencies({
      floor: repo.floor,
      number: Number(x.number),
      dependsOn: deps,
      issues,
      closed: (n) => states.get(n) === 'CLOSED',
      inProgress: this.issueTaken(repo, Number(x.number)),
    });
    if (plan.body !== null) {
      await this.backend.editIssue(repo.fullName, Number(x.number), { body: plan.body });
      await this.syncRepo(repo.id); // the scheduler sees the new order right away
    }
    return plan.summary;
  }

  /** Close an open issue as not planned, with the CEO's reason as its comment (see checkCloseIssue for what is refused). */
  protected async closeIssue(x: { floor: number; number: number; reason: string }) {
    const repo = this.floorRepo(x.floor);
    const n = Number(x.number);
    const rt = this.repoRt.get(repo.id);
    const reason = String(x.reason ?? '').trim().slice(0, 1000);
    if (!reason) throw new HttpError(400, 'Say why the issue is closing: the reason is posted on it as a comment.');
    const state = rt?.issues.some((i) => i.number === n) ? 'OPEN' : await this.backend.issueState(repo.fullName, n).catch(() => null);
    checkCloseIssue({ floor: repo.floor, number: n, state, pulls: rt?.pulls ?? [] });
    await this.backend.closeIssue(repo.fullName, n, reason, 'not planned');
    this.postMessage('office', `🗂️ ${this.ceo().name} closed #${n} on floor ${repo.floor}: ${reason.split('\n')[0].slice(0, 200)}`);
    const stopped = this.learnIssueClosed(repo, n); // off the Kanban, out of the scheduler's queue, and whoever was on it stops
    await this.syncRepo(repo.id);
    return `Closed #${n} on floor ${repo.floor} as not planned.${stopped.length ? ` ${nameList(stopped)} stopped working on it.` : ''}`;
  }

  // ---------- the CEO's mandates and read-only tools (#27) ----------

  /** set_mandate: the manager's "keep working on X until it's perfected", for follow-ups to file issues under. */
  protected setMandate(x: { text: string; floors?: number[]; expires_in_hours?: number }) {
    if (!this.ceoAsked) throw new Error(MANDATE_NOT_ASKED);
    const text = String(x.text ?? '').trim();
    if (!text) throw new Error('Say what the mandate is, in the manager\'s words.');
    const floors = [...new Set((x.floors ?? []).map(Number))].map((f) => this.floorRepo(f).floor);
    const hours = Number(x.expires_in_hours);
    const now = Date.now();
    const kept = this.state.settings.ceoMandates.filter((m) => m.text.toLowerCase() !== text.toLowerCase());
    const mandate = { id: `m-${now.toString(36)}`, text, floors, expiresAt: Number.isFinite(hours) && hours > 0 ? now + hours * 3_600_000 : null, at: now };
    this.updateSettings({ ceoMandates: [...kept, mandate] });
    const saved = this.state.settings.ceoMandates.find((m) => m.id === mandate.id)!;
    const dropped = kept.length + 1 > MAX_MANDATES ? ` The oldest went: at most ${MAX_MANDATES} are kept.` : '';
    return `Recorded: "${saved.text}" for ${saved.floors.length ? `floor${saved.floors.length === 1 ? '' : 's'} ${saved.floors.join(', ')}` : 'every floor'}${saved.expiresAt ? ` until ${new Date(saved.expiresAt).toISOString().slice(0, 16)} UTC` : ''}. Follow-ups may file issues there.${dropped}`;
  }

  /** agent_log: an agent's last terminal lines and their session, secrets masked as for the journal. */
  protected agentLog(x: { agent_id: string; lines?: number }) {
    const a = this.agentByRef(x.agent_id);
    const rt = this.agentRt.get(a.id);
    const secrets = this.secrets();
    const lines = rt?.terminal ? rt.terminal.tail(AGENT_LOG_MAX_LINES) : (rt?.log ?? a.logTail).map((l) => l.text);
    const floor = this.state.repos.find((r) => r.id === a.repoId)?.floor ?? null;
    return agentLogText(a, { floor, doing: this.agentDoing(a), lines, wanted: x.lines, mask: (t) => scrub(t, secrets) });
  }

  /** session_history: past sessions from the history (#49), filtered, newest first, a page at a time. */
  protected sessionHistory(x: Parameters<OfficeHandlers['sessionHistory']>[0]) {
    const per = 20;
    const page = Math.max(1, Math.floor(x.page ?? 1));
    const repoId = x.floor === undefined ? undefined : this.floorRepo(x.floor).id;
    const since = Date.now() - (x.days ?? 7) * 86_400_000;
    return historyText(this.history.page({ repoId, agent: x.agent, kind: x.kind, outcome: x.outcome, issue: x.issue, pr: x.pr, q: x.query, since, offset: (page - 1) * per, limit: per }), page, per);
  }

  /** The CEO still chats while the office drains for its update (#46), but starts no agent's session until the restart. */
  protected refuseWhileUpdating() {
    if (this.officeUpdate.drainingSince !== null || this.officeUpdate.sent) throw new Error('The office is updating itself: no agent session starts until it restarts. Tell the manager, and try again after the update.');
  }

  protected restartAgent(x: { agent_id: string }) {
    const a = checkRestart(this.agentByRef(x.agent_id));
    const resumes = resumesAfterRestart(a, false, this.backend.demo);
    if (resumes) {
      this.refuseWhileUpdating();
      this.ensureSlot(sessionKind(a)); // refused with the reason: memory, or the session limit
    }
    this.recover([a], new Set(), new Set(resumes ? [] : [a]), undefined, 'The CEO restarted your task');
    return resumes ? `${a.name} picks their session back up.` : `${a.name}'s task went back to the queue; they are free for the next one.`;
  }

  // ---------- agents' questions (#36, shared/questions.ts) ----------

  /** A session that ended asking something: the agent waits, and a follow-up wakes the CEO (else the manager is asked). */
  protected ask(a: PersistedAgent, repo: PersistedRepo, text: string): boolean {
    const asked = questionFromTurn(scrub(text, this.secrets())); // it goes to the CEO, the chat and notifications
    if (!asked) return false;
    const q = newQuestion(`q-${crypto.randomUUID().slice(0, 8)}`, asked, { agentId: a.id, agentName: a.name, repoId: repo.id, floor: repo.floor, issue: a.issueNumber, pr: a.prNumber }, Date.now());
    this.setQuestions([...this.state.questions.filter((x) => x.agentId !== a.id), q]);
    this.appendLog(a, [{ kind: 'system', text: `❓ Waiting for an answer: ${clip(q.text, 160)}` }]);
    if (!this.followup(questionEvent(q, this.floorName(repo)))) this.askManager(q, { question: q.text, options: q.options, recommendation: '' }, 'office');
    return true;
  }

  /** The question goes to the manager: a chat message with one-tap options, and a notification. */
  protected askManager(q: AgentQuestion, x: { question: string; options: string[]; recommendation: string }, from: 'ceo' | 'office') {
    const mask = (t: string) => scrub(t, this.secrets());
    const e = escalated(q, { question: mask(x.question), options: x.options.map(mask), recommendation: mask(x.recommendation) }, Date.now());
    const work = e.issue ? `, #${e.issue}` : e.pr ? `, PR #${e.pr}` : '';
    const m = this.postMessage(from, `❓ ${e.agentName} asks (floor ${e.floor}${work}): ${e.text}${e.recommendation ? `\nMy pick: ${e.recommendation}` : ''}`, undefined, { question: e.id });
    this.setQuestions(this.state.questions.map((y) => (y.id === q.id ? { ...e, messageId: m.id } : y)));
    this.notifyQuestion(e, false);
  }

  protected notifyQuestion(q: AgentQuestion, again: boolean) {
    const title = `${q.agentName} ${again ? 'still waits for your answer' : 'asks you'}`;
    this.notifier.notify('question', title, `${q.text}${q.recommendation ? ` (CEO's pick: ${q.recommendation})` : ''}`, `${q.agentName} (floor ${q.floor}): ${clip(q.text, 120)}`);
  }

  /** An answer typed into the agent's session as their next message; the question closes first. */
  protected async answerQuestion(q: AgentQuestion, text: string, who: string) {
    this.setQuestions(this.state.questions.filter((x) => x.id !== q.id));
    try {
      await this.message(q.agentId, answerPrompt(q, text, who), false, who);
    } catch (err) {
      if (this.state.agents.some((a) => a.id === q.agentId)) this.setQuestions([...this.state.questions, q]);
      throw err;
    }
  }

  /** The manager answered a question (tapped an option, or replied to its message): to the agent, and the CEO hears. */
  protected async managerAnswer(q: AgentQuestion, text: string, replyTo: number, via?: 'telegram') {
    const m = this.postMessage('manager', text, undefined, { replyTo, delivery: 'read', ...(via && { telegram: 'in' as const }) });
    try {
      await this.answerQuestion(q, text, this.state.settings.managerName || 'the manager');
      this.ceoTold.push(`The manager answered ${q.agentName}'s question "${clip(q.text, 120)}": ${clip(text, 200)}`);
      this.postMessage('office', `↪ Sent to ${q.agentName}: they carry on with your answer.`);
    } catch (err) {
      this.postMessage('office', `That answer didn't reach ${q.agentName}: ${(err as Error).message}`);
    }
    return { id: m.id };
  }

  protected async answerAgent(x: { agent_id: string; text: string }) {
    const a = this.agentByRef(x.agent_id);
    const q = questionOf(this.state.questions, a.id);
    if (!q) throw new Error(`${a.name} has no open question. Use message_agent to guide them.`);
    if (q.to === 'manager') throw new Error(`${a.name}'s question is with the manager already; their answer goes straight to ${a.name}.`);
    await this.answerQuestion(q, x.text, `${this.ceo().name} (CEO)`);
    return `Sent: ${a.name} carries on with your answer.`;
  }

  protected askManagerChoice(x: { agent_id: string; question: string; options: string[]; recommendation: string }) {
    const a = this.agentByRef(x.agent_id);
    const q = questionOf(this.state.questions, a.id);
    if (!q) throw new Error(`${a.name} has no open question to bring to the manager.`);
    if (q.to === 'manager') throw new Error(`${a.name}'s question is with the manager already.`);
    this.askManager(q, x, 'ceo');
    return `Asked the manager with your recommendation; their answer goes straight to ${a.name}.`;
  }

  protected async messageAgent(x: { floor: number; agent_id: string; text: string }) {
    const a = this.agentByRef(x.agent_id);
    if (a.repoId !== this.floorRepo(x.floor).id) throw new Error(`${a.name} is not on floor ${x.floor}: check their floor in company_status.`);
    const running = !!this.agentRt.get(a.id)?.session;
    if (!running) this.refuseWhileUpdating();
    await this.message(a.id, x.text, false, `${this.ceo().name} (CEO)`);
    return running ? `Sent: ${a.name} reads it after their current step.` : `${a.name} picked their session back up with your message.`;
  }

  /** qa_report: a PR's latest QA verdict, report and screenshots (as files the CEO can Read). */
  protected qaReport(x: { floor: number; pr: number }) {
    const repo = this.floorRepo(x.floor);
    const pr = Number(x.pr);
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === pr);
    if (!rec) throw new Error(`PR #${pr} on floor ${repo.floor} has no QA record: it hasn't been tested yet, or it has closed.`);
    const secrets = this.secrets();
    const dir = qaShotsDir(QA_SHOTS_DIR, repo.id, pr);
    return qaReportText(rec, repo.floor, (t) => scrub(t, secrets), (i, mime) => qaShotFile(dir, i, mime));
  }

  /** worktree_file: a file or diff from an agent's worktree, or their branch in the floor's clone once it's gone. */
  protected async worktreeFile(x: { agent_id: string; mode: 'file' | 'diff_stat' | 'diff'; path?: string }) {
    const a = this.agentByRef(x.agent_id);
    if (a.role === 'ceo') throw new Error('You have no worktree. Read the clones directly.');
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    if (!repo) throw new Error(`${a.name} isn't on a floor.`);
    if (a.host === 'box') throw new Error(`${a.name} works in a cloud machine, which the office can't read from here. pr_diff shows their pull request.`);
    if (!['file', 'diff_stat', 'diff'].includes(x.mode)) throw new Error('mode is file, diff_stat or diff.');
    const base = `origin/${repo.defaultBranch}`;
    const dir = this.deskOf(a, repo);
    if (this.backend.deskExists(dir)) {
      const out = await this.backend.readWorktree({ dir, ref: null, base, mode: x.mode, path: x.path });
      return `${a.name}'s worktree${a.branch ? ` (${a.branch})` : ''}:\n${scrub(out, this.secrets())}`;
    }
    if (!a.branch) throw new Error(`${a.name} has no worktree or branch right now: they aren't working on anything.`);
    const out = await this.backend.readWorktree({ dir: this.backend.mainDir(repo.fullName), ref: `origin/${a.branch}`, base, mode: x.mode, path: x.path });
    return `${a.name}'s branch ${a.branch} (their worktree is gone; pushed commits only):\n${scrub(out, this.secrets())}`;
  }

  /** pr_diff: a PR's changed files, and its diff when asked, through gh. */
  protected async prDiff(x: { floor: number; pr: number; patch?: boolean }) {
    const repo = this.floorRepo(x.floor);
    const d = await this.backend.prDiff(repo.fullName, Number(x.pr), !!x.patch);
    return prDiffText({ files: d.files, diff: d.diff === null ? null : scrub(d.diff, this.secrets()) });
  }
}
