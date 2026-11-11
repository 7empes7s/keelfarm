// The CEO: its job queue, follow-ups, triage of stuck PRs, the phone and notifications.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { SessionResult } from '../agentRunner.ts';
import { askedFor, ceoJobPrompt, ceoSystemPrompt, IssueCap, jobLabel, nextCeoJob, queueCeoJob, type CeoJob } from '../ceo.ts';
import { ceoHeld, ceoStep, messageGoesIn, type CeoLaneInput } from '../ceoLane.ts';
import { HttpError } from '../httpError.ts';
import { triageStep, type TriagePr } from '../triage.ts';
import { cliLabel } from '../clis.ts';
import { heardAtStart, HEARD_MAX } from '../managerAsks.ts';
import { recordCost } from '../metrics.ts';
import { resolveEffort, type TaskKind } from '../../shared/costs.ts';
import { officeParts } from '../../shared/startup.ts';
import { speaks } from '../voice.ts';
import { teamKeyboard, telegramChat, telegramMessage } from '../telegram.ts';
import { clip, plainText, stuckAgents, type TeamChange } from '../notify.ts';
import { redact as scrub } from '../../shared/journal.ts';
import {
  addFollowup,
  followupEvents,
  followupStep,
  followupWaiting,
  liveMandates,
  quietReply,
  takeFollowups,
  type FollowupEvent,
} from '../../shared/followups.ts';
import { dueGreeting } from '../../shared/themes.ts';
import { charterOf, MISSION_MAX, renderCharter } from '../../shared/charter.ts';
import { CEO_ID } from '../../shared/types.ts';
import { forwardText, isHarnessText, stripHarness } from '../../shared/chat.ts';
import { feedbackPrompt, replyTarget } from '../../shared/reactions.ts';
import { researchJob, researchRef } from '../research.ts';
import { makeArtifacts, parseMessage } from '../../shared/chatParts.ts';
import { withVisualsText } from '../../shared/chatVisuals.ts';
import { fileUrl, parseRefs, refsLine, type RefContext } from '../../shared/chatRefs.ts';
import type { QuickPicks } from '../../shared/used.ts';
import { quickPicks } from '../ceoFiles.ts';
import { BACKGROUND_KINDS, jobNote } from '../ceoDigest.ts';
import type { AgentStatus, CeoInfo, PhoneMessage, RefFileView } from '../../shared/types.ts';
import { memoryPrompt } from '../../shared/ceoMemory.ts';
import { conversationsView, projectLine, touchConversation } from '../../shared/conversations.ts';
import { renotifyDue, toldCeo } from '../../shared/questions.ts';
import { decisionsReminder, probablyLeft } from '../../shared/decisions.ts';
import {
  type PersistedRepo,
  type PersistedAgent,
  type QaRecord,
  CEO_MODEL,
  CEO_EFFORT,
  CEO_NAME,
  CEO_DIR,
  MAX_ISSUES_PER_JOB,
  KEEP_MESSAGES,
  BUSY,
  FREE,
  QA_SHOTS_DIR,
} from './model.ts';
import { SKIN, lookFor, pick } from './flavour.ts';
import { SwarmCeoLog } from './ceoLog.ts';

export abstract class SwarmCeo extends SwarmCeoLog {
  protected ceoTold: string[] = []; // for the CEO's next job: the manager's answers to agents' questions
  // ---------- the CEO ----------

  protected ceoPreempted: CeoJob | null = null; // the background job stopped for the manager's message: it goes back to the queue
  protected ceoHeard: number[] = []; // the manager's messages delivered in the CEO's current job: what asked_in may name (#403)

  protected heardManager(id: number) {
    this.ceoHeard = [...this.ceoHeard, id].slice(-HEARD_MAX);
  }

  protected ceo() {
    return this.state.agents.find((a) => a.id === CEO_ID)!;
  }

  /** The company always has a CEO. One cut off by a server restart picks its job back up. */
  protected ensureCeo(interrupted: PersistedAgent[]) {
    let a = this.state.agents.find((x) => x.id === CEO_ID);
    if (!a) {
      a = {
        id: CEO_ID,
        name: CEO_NAME,
        repoId: '',
        role: 'ceo',
        look: lookFor(CEO_NAME),
        task: null,
        desk: 0,
        color: '#e63946',
        hair: '#2b2118',
        skin: pick(SKIN),
        style: null,
        model: CEO_MODEL,
        effort: CEO_EFFORT,
        cli: 'claude',
        machine: null,
        status: 'idle',
        issueNumber: null,
        issueTitle: null,
        branch: null,
        prNumber: null,
        prUrl: null,
        startedAt: null,
        endedAt: null,
        costUsd: 0,
        turns: 0,
        sessionId: null,
        sessionCli: null,
        lastError: null,
        logTail: [],
      };
      this.state.agents.push(a);
      this.agentRt.set(a.id, { log: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [], terminal: null });
      this.appendLog(a, [{ kind: 'system', text: `🏛️ ${a.name} moved into the corner office. The CEO studies every floor, sizes its team and plans its work.` }]);
    }
    const i = interrupted.indexOf(a);
    if (i >= 0) {
      interrupted.splice(i, 1);
      a.status = 'idle';
      a.lastError = null;
      this.appendLog(a, [{ kind: 'system', text: '↺ The office server restarted. Picking the job back up.' }]);
    }
    if (this.state.ceo.job) {
      this.state.ceo.queue.unshift(this.state.ceo.job);
      this.state.ceo.job = null;
    }
    this.state.ceo.lastReviewAt ??= Date.now(); // the first review comes one heartbeat after the office opens
  }

  protected ceoFloor(repoId?: string) {
    const repo = repoId ? this.state.repos.find((r) => r.id === repoId) : undefined;
    if (!repo) return null;
    return { floor: repo.floor, fullName: repo.fullName, clone: this.backend.mainDir(repo.fullName), mission: repo.mission, charter: renderCharter(charterOf(repo.mission, repo.charter)), backlog: this.repoRt.get(repo.id)?.issues.length ?? 0 };
  }

  protected ceoInfo(): CeoInfo {
    const c = this.state.ceo;
    const view = (j: CeoJob) => ({ kind: j.kind, label: jobLabel(j, this.ceoFloor(j.repoId)) });
    const min = this.state.settings.ceoHeartbeatMin;
    return {
      queue: c.queue.map(view),
      job: c.job ? view(c.job) : null,
      lastReviewAt: c.lastReviewAt,
      nextReviewAt: min > 0 && c.lastReviewAt ? c.lastReviewAt + min * 60_000 : null,
      followups: this.followupView(),
      session: { turns: c.kept.turns, costUsd: Math.round(c.kept.costUsd * 100) / 100, startedAt: c.kept.startedAt, waiting: this.holds.waiting(), consults: this.consults.length },
      held: ceoHeld({ now: Date.now(), pausedUntil: this.ceoPausedUntil(), chatQueued: c.queue.some((j) => j.kind === 'chat') }),
      questions: this.state.questions,
      researchedAt: c.researchedAt ?? null,
    };
  }

  protected emitCeo() {
    this.broadcast({ type: 'ceo', ceo: this.ceoInfo() });
  }

  /** Queue a job for the CEO (ceo.ts queueCeoJob). */
  protected enqueueCeo(job: CeoJob) {
    queueCeoJob(this.state.ceo.queue, job);
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 150);
  }

  /** Claude's usage pause holds the CEO, unless the manager put it on another coding agent or an account of its own that has room (#418). */
  protected ceoPausedUntil(): number {
    const a = this.state.agents.find((x) => x.id === CEO_ID);
    const cli = a ? this.ceoCliOf(a) : 'claude';
    if (!a || this.pausedUntil <= Date.now() || (cli === 'claude' && !a.account)) return this.pausedUntil;
    return cli === 'opencode' || this.accounts.ready(a.account, cli) ? 0 : this.pausedUntil;
  }

  /** What ceoStep (server/ceoLane.ts) sees now. */
  protected ceoLane(draining: boolean): CeoLaneInput {
    const a = this.state.agents.find((x) => x.id === CEO_ID);
    const c = this.state.ceo;
    return {
      now: Date.now(),
      pausedUntil: this.ceoPausedUntil(),
      draining,
      handingOver: this.officeUpdate.sent && draining,
      busy: !!a && BUSY.includes(a.status),
      job: c.job?.kind ?? null,
      session: !!this.agentRt.get(CEO_ID)?.session,
      chatQueued: c.queue.some((j) => j.kind === 'chat'),
    };
  }

  /**
   * Start the CEO's next job when they're free; they never wait for a session slot. Replies to the manager go first, and
   * preempt a background job (it goes back to the queue). While the office drains for its update, only chat starts.
   */
  protected startCeoWork(draining = false): void {
    const a = this.state.agents.find((x) => x.id === CEO_ID);
    const c = this.state.ceo;
    // A triage whose PR is no longer stuck (the manager stepped in, or it closed) has nothing left to do.
    const stale = c.queue.filter((j) => j.kind === 'triage' && !this.stuckRecord(j));
    if (stale.length) {
      c.queue = c.queue.filter((j) => !stale.includes(j));
      this.emitCeo();
      this.save();
    }
    if (!a || c.queue.length === 0) return;
    const step = ceoStep(this.ceoLane(draining));
    if (step.do === 'preempt') {
      this.preemptCeo(a);
      if (!c.job) this.startCeoWork(draining); // the session stopped at once: the reply starts now
      return;
    }
    if (step.do === 'wait') return;
    // A floor's jobs wait for its clone and first sync, so the CEO has something to read.
    const ready = (j: CeoJob) => {
      if (step.only === 'chat' && j.kind !== 'chat') return false;
      const rt = j.repoId ? this.repoRt.get(j.repoId) : undefined;
      return !rt || rt.cloneStatus === 'error' || (rt.cloneStatus === 'ready' && rt.lastSync != null);
    };
    const job = nextCeoJob(c.queue, ready);
    if (!job) return;
    c.queue.splice(c.queue.indexOf(job), 1);
    const rt = job.repoId ? this.repoRt.get(job.repoId) : undefined;
    if (job.repoId && (!rt || rt.cloneStatus === 'error')) {
      const repo = this.state.repos.find((r) => r.id === job.repoId);
      if (repo) this.postMessage('office', `⚠️ ${a.name} couldn't study floor ${repo.floor}: the repository clone failed (${rt?.cloneError ?? 'unknown error'}).`);
      this.emitCeo();
      this.save();
      return this.startCeoWork(draining);
    }
    void this.runCeoJob(a, job);
  }

  /** The manager wrote while the CEO works on a background job: stop it and put it back in the queue, so the reply comes now. */
  protected preemptCeo(a: PersistedAgent) {
    const job = this.state.ceo.job;
    if (!job || this.ceoPreempted) return;
    this.ceoPreempted = job;
    this.appendLog(a, [{ kind: 'system', text: `⏸ The manager wrote: ${jobLabel(job, this.ceoFloor(job.repoId)).toLowerCase()} goes back to the queue until the reply is out.` }]);
    this.agentRt.get(a.id)?.session?.stop();
  }

  protected ceoPromptInput(a: PersistedAgent): Parameters<typeof ceoSystemPrompt>[0] {
    const s = this.state.settings;
    return { name: a.name, company: s.companyName, manager: s.managerName, notesFile: path.join(CEO_DIR, 'NOTES.md'), sessionLimit: s.sessionLimit, maxAgents: s.maxAgents, scaling: s.scaling, officePlaybook: s.officePlaybook };
  }

  protected async runCeoJob(a: PersistedAgent, job: CeoJob) {
    const rt = this.agentRt.get(a.id)!;
    const floor = this.ceoFloor(job.repoId);
    const label = jobLabel(job, floor);
    const model = this.ceoJobModel(a, job);
    this.state.ceo.job = job;
    Object.assign(a, { status: 'working' as AgentStatus, task: null, issueNumber: null, issueTitle: label, startedAt: Date.now(), endedAt: null, costUsd: 0, turns: 0, lastError: null });
    this.appendLog(a, [
      { kind: 'system', text: '' },
      { kind: 'system', text: `━━━ ${label} · ${model || `${cliLabel(this.ceoCliOf(a))}'s default model`} ━━━` },
    ]);
    if (job.kind === 'chat') this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${job.text}` }]);
    if (job.messageIds?.length) this.markDelivery(job.messageIds, 'read');
    if (job.kind === 'review') {
      this.state.ceo.lastReviewAt = Date.now();
      this.state.ceo.lastFingerprint = this.fingerprint();
    }
    this.ceoIssues = new IssueCap(MAX_ISSUES_PER_JOB);
    this.spend.ceoActs = 0;
    this.ceoAsked = askedFor(job);
    this.ceoHeard = heardAtStart(job);
    this.ceoChat.startJob();
    this.ceoWaited = false;
    this.emitAgent(a);
    this.emitCeo();
    this.save();
    await fs.mkdir(CEO_DIR, { recursive: true }).catch(() => undefined);
    const triage = job.kind === 'triage' ? await this.triagePr(job) : null;
    const plan = await this.ceoSessionPlan(a, job); // fresh, or the kept session (#28, #330)
    if (a.status !== 'working') {
      // stopped before the session started
      this.state.ceo.job = null;
      if (job.kind === 'triage') this.endTriage(job);
      this.emitCeo();
      return;
    }
    const open = this.ceoOpening(a, job, plan, model);
    const how = this.sessionRuntime(a, open.resumeId);
    const kind: TaskKind = `ceo-${job.kind}`;
    const prompt = open.start + ceoJobPrompt(job, floor, triage, liveMandates(this.state.settings.ceoMandates, Date.now()), this.state.settings.researchMin) + (job.kind === 'chat' ? this.openDecisionsLine() : '') + open.since + toldCeo(this.ceoTold.splice(0)) + feedbackPrompt(this.ceoFeedback.splice(0)) + (open.start ? '' : memoryPrompt(this.state.ceo.remember)) + this.takeChanges(job);
    const system = ceoSystemPrompt(this.ceoPromptInput(a));
    const run = this.spend.start(a.id, { kind, effort: resolveEffort(a.effort, kind, this.state.settings.taskEffort, CEO_EFFORT), model, startedAt: Date.now(), round: null, known: officeParts({ system, prompt }), cwd: CEO_DIR, sessionId: how.resumeSessionId ?? null, title: label, resumed: !!open.resumeId });
    rt.session = this.startCeoSession(a,
      {
        cwd: CEO_DIR,
        prompt,
        systemAppend: system,
        model: run.model,
        effort: run.effort,
        browserTesting: false,
        // The clones, and QA's screenshots for qa_report's paths.
        additionalDirectories: [...this.state.repos.filter((r) => this.repoRt.get(r.id)?.cloneStatus === 'ready').map((r) => this.backend.mainDir(r.fullName)), QA_SHOTS_DIR],
        role: 'ceo',
        office: this.officeTools(),
        tools: this.sessionToolsFor(a, how.cli),
        stream: true,
        keepAlive: this.state.settings.ceoAwake.keepAlive && !plan.fresh,
        ...how,
      },
      {
        log: (entries) => {
          this.appendLog(a, entries);
          this.ceoFiles.record(entries);
          this.ceoChat.log(entries);
        },
        text: (text, done) => this.ceoChat.text(text, done),
        tool: (name) => {
          if (this.ceoAsked || job.messageIds?.length) this.markStatus('open', 'working');
          if (rt.currentTool === name) return;
          rt.currentTool = name;
          this.emitAgent(a);
        },
        sessionId: (id) => {
          if (!plan.fresh) Object.assign(a, { sessionId: id, sessionCli: id ? (how.cli ?? 'claude') : null, sessionAccount: id ? this.sessionOn.get(a.id) : undefined }); // a fresh job's session isn't the chat's
          if (id) run.sessionId = id;
        },
        browserUrl: () => undefined,
        screenshot: () => undefined,
        // A follow-up that found nothing to do stays off the manager's phone.
        turn: (text) => {
          if (job.kind === 'followup' && quietReply(text)) {
            this.turnAnswer = null;
            return void this.ceoChat.finishTurn(text);
          }
          this.postCeoReply(text);
          this.markDelivery('all', 'replied');
          if (this.ceoAsked || job.messageIds?.length) this.markStatus('open', 'replied'); // only a job with the manager's messages answers them
        },
        limited: (at) => this.pauseForLimit(at),
        usageWarning: (info) => this.paceForWarning(info),
        usage: (readings) => this.recordUsage(readings),
        startup: (st) => this.spend.startup(a.id, st.tokens, st.memoryChars),
        finished: (result) => this.onCeoFinished(a, this.spend.perTurn(a.id, this.spend.sid(a.id), result)), // its kept session reports a running total (#254)
      },
    );
    if (job.kind === 'research') this.researchGuard.start(this.state.settings.researchMin, job.topic ?? '', () => rt.session, (note) => { Object.assign(a, { status: 'stopped' as AgentStatus, lastError: note }); this.postMessage('office', `⏱ ${a.name}: ${note}`); });
  }

  protected onCeoFinished(a: PersistedAgent, result: SessionResult) {
    const rt = this.agentRt.get(a.id);
    if (!rt || this.officeUpdate.cutOff.has(a.id)) return;
    this.health.ended(a, 'ceo', result.errors, false, false); // its peak teaches the CEO's estimate
    rt.session = null;
    rt.currentTool = null;
    a.endedAt = Date.now();
    a.costUsd += result.costUsd;
    a.turns += result.turns;
    recordCost(this.state.ops, '', result.costUsd, a.endedAt);
    this.cancelHolds('The job ended.');
    const kept = this.state.ceo.kept;
    if (!this.ceoFresh) Object.assign(kept, { turns: kept.turns + result.turns, costUsd: kept.costUsd + result.costUsd, lastEndedAt: a.endedAt }); // a fresh job's session isn't the kept one
    const job = this.state.ceo.job;
    this.state.ceo.job = null;
    this.researchGuard.clear();
    const preempted = !!job && job === this.ceoPreempted;
    this.ceoPreempted = null;
    const retry = this.retryOnCeoModel(a, job, result, preempted);
    this.ceoFresh = false;
    if (this.settleChanges(preempted || retry) && job) this.state.ceo.queue.push(job); // a preempted or retried job hears its changes again
    else if (job?.kind === 'triage') this.endTriage(job);
    if (this.ceoFiles.pending()) this.postCeoReply(''); // files attached after its last reply still reach the phone
    this.ceoFiles.endJob();
    this.ceoChat.endJob();
    if (result.interrupted) this.interrupted(a);
    const floorJob = job?.repoId && this.state.repos.some((r) => r.id === job.repoId) ? job.repoId : '';
    const run = this.spend.take(a.id);
    if (run && this.ceoWaited) run.kind = 'ceo-wait';
    this.ceoJobEnds(job, run, result, this.ceoIssues.total, preempted || retry); // its row in the CEO jobs log, its inputs for a redo (#332)
    void this.spend.record({ ...a, issueNumber: null, prNumber: job?.prNumber ?? null }, floorJob, run, 'ceo-chat', result, { stopped: a.status === 'stopped' || preempted, ceoHint: result.ok ? (this.ceoIssues.total > 0 || this.spend.ceoActs > 0 ? 'ceo-acted' : 'ceo-idle') : undefined });
    if (a.status === 'stopped') {
      // the manager already logged the stop
    } else if (preempted || retry) {
      a.status = 'idle'; // the manager's chat, or the retry, starts next
    } else if (!result.ok) {
      a.status = 'error';
      a.lastError = result.errors.join('; ') || 'Session failed';
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      const what = job ? jobLabel(job, this.ceoFloor(job.repoId)).toLowerCase() : 'working';
      if (!result.signedOut) this.postMessage('office', `⚠️ ${a.name} hit a problem while ${what}: ${a.lastError.slice(0, 240)}`); // a sign-in has its card (ceoStuck.ts)
    } else {
      a.status = 'done';
      const filed = this.ceoIssues.total ? ` · ${this.ceoIssues.total} issue${this.ceoIssues.total === 1 ? '' : 's'} filed` : '';
      this.appendLog(a, [{ kind: 'done', text: `✔ Done in ${this.minutes(a)}m · ${a.turns} turns${filed}` }]);
    }
    if (!retry && (this.ceoAsked || job?.messageIds?.length)) this.markStatus('open', a.status === 'done' ? 'replied' : 'failed'); // ✅ or ⚠️ on the manager's messages it held
    if (a.startedAt) this.ceoTold.push(...probablyLeft(this.state.decisions.list, a.startedAt)); // #208: back in its next job, not in the chat
    for (const id of this.ceoIssues.repos) void this.syncRepo(id);
    this.emitAgent(a);
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 300);
  }

  /** The manager's phone (or Telegram) → the CEO, with a quote of the message it replies to and any files. Injected into a running session, otherwise the CEO picks it up next; "Research: <topic>" and replies to research are jobs of their own. */
  async messageCeo(text: string, replyTo?: number, via?: 'telegram', fileIds: readonly string[] = [], tg?: number, clientId?: string) {
    const t = text.trim().slice(0, 4000);
    const attachments = this.ceoFiles.managerFiles(fileIds);
    if (!t && !attachments.length) throw new HttpError(400, 'Empty message');
    if (isHarnessText(t)) throw new HttpError(400, "That's the CEO session's own output, not a message: it stays out of the chat.");
    const a = this.ceo();
    const agentAsked = replyTo === undefined ? undefined : this.state.questions.find((q) => q.messageId === replyTo);
    if (agentAsked && t) return this.managerAnswer(agentAsked, t, replyTo!, via);
    const quoted = replyTo === undefined ? undefined : this.state.messages.find((m) => m.id === replyTo);
    const m = this.postMessage('manager', t, undefined, { ...(replyTo !== undefined && { replyTo }), ...(clientId && { clientId }), delivery: 'sent', ...(via && { telegram: 'in' as const, ...(tg !== undefined && { tg }) }), ...(attachments.length && { attachments }) });
    const forward = [projectLine(this.state.ceo.chats, this.state.messages, m, this.state.repos), forwardText(t, quoted), refsLine(m.text, m.refs), this.ceoFiles.forwardLines(attachments)].filter(Boolean).join('\n');
    const asked = this.holds.answer(replyTo, [t, this.ceoFiles.forwardLines(attachments)].filter(Boolean).join('\n')); // no quote: it answers the question asked
    if (asked && !asked.resume) {
      // ask_manager's answer: it goes to the waiting tool call, not into the session as a new message (#28).
      this.appendLog(a, [{ kind: 'manager', text: `▶ Manager answered: ${forward}` }]);
      this.ceoAsked = true;
      this.heardManager(m.id);
      this.markDelivery([m.id], 'read');
      return { id: m.id };
    }
    const research = await researchJob({ text: t, quoted, forward, id: m.id, dir: path.join(CEO_DIR, 'research'), onlyRepo: this.state.repos.length === 1 ? this.state.repos[0].id : undefined });
    const rt = this.agentRt.get(a.id)!;
    if (rt.session && !research && messageGoesIn({ now: Date.now(), pausedUntil: this.ceoPausedUntil(), job: this.state.ceo.job?.kind ?? null, session: true })) {
      this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${forward}` }]);
      this.ceoIssues.managerMessage(); // a new request: the issue cap counts from here
      this.ceoAsked = true;
      this.heardManager(m.id);
      rt.session.send(`Message from the manager (they read your reply on their phone, so keep it short):\n(message ${m.id}) ${forward}${this.openDecisionsLine()}`);
      this.markDelivery([m.id], 'read');
      return { id: m.id };
    }
    if (this.state.ceo.job) this.markStatus([m.id], 'queued'); // 🕓 behind the job under way
    this.enqueueCeo(research ?? { kind: 'chat', text: `(message ${m.id}) ${forward}`, messageIds: [m.id], at: Date.now() });
    return { id: m.id };
  }

  /** The open questions of the last day, for a job or message with the manager's words (#208). */
  private openDecisionsLine() {
    return decisionsReminder(this.state.decisions.list, Date.now(), (id) => this.state.repos.find((r) => r.id === id)?.floor ?? null);
  }

  requestReview() {
    if (this.state.repos.length === 0) throw new HttpError(400, 'Connect a repo first: the CEO needs a floor to review.');
    this.enqueueCeo({ kind: 'review', by: 'manager', at: Date.now() });
  }

  onboardFloor(repoId: string) {
    const repo = this.repo(repoId);
    this.enqueueCeo({ kind: 'onboard', repoId: repo.id, at: Date.now() });
  }

  /** The manager hands the CEO a brief for a floor; the CEO turns it into issues and a team, or researches it first. */
  planFloor(repoId: string, mission?: string, research = false) {
    const repo = this.repo(repoId);
    if (typeof mission === 'string') {
      this.applyCharter(repo, { ...charterOf(repo.mission, repo.charter), mission: mission.trim().slice(0, MISSION_MAX) }, this.managerLabel(), 'brief edited');
      this.emitRepo(repo);
    }
    if (!repo.mission) throw new HttpError(400, 'Write a brief first: what should this floor build?');
    this.enqueueCeo(research ? { kind: 'research', repoId: repo.id, topic: repo.mission.slice(0, 1000), at: Date.now() } : { kind: 'plan', repoId: repo.id, at: Date.now() });
  }

  /** Everything the heartbeat cares about. When it hasn't changed since the last review, the review is skipped. */
  protected fingerprint() {
    const data = {
      repos: this.state.repos.map((r) => {
        const rt = this.repoRt.get(r.id);
        return [r.id, r.mission, r.summary, rt?.issues.map((i) => i.number), rt?.pulls.filter((p) => p.state === 'OPEN').map((p) => p.number)];
      }),
      agents: this.state.agents.filter((a) => a.role !== 'ceo').map((a) => [a.id, FREE.includes(a.status) ? 'free' : a.status]),
      qa: this.state.qa.map((q) => [q.repoId, q.prNumber, q.status]),
      requests: this.state.requests.filter((r) => r.status === 'pending').map((r) => r.id),
    };
    return crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');
  }

  protected maybeHeartbeat() {
    const min = this.state.settings.ceoHeartbeatMin;
    const c = this.state.ceo;
    if (!min || this.state.repos.length === 0 || c.job?.kind === 'review' || c.queue.some((j) => j.kind === 'review')) return;
    if (Date.now() < (c.lastReviewAt ?? 0) + min * 60_000) return;
    if (this.fingerprint() === c.lastFingerprint) {
      c.lastReviewAt = Date.now(); // nothing changed since the last review
      this.emitCeo();
      this.save();
      return;
    }
    this.enqueueCeo({ kind: 'review', at: Date.now() });
  }

  // ---------- follow-ups (#27) ----------

  /** Something happened the CEO may want to follow up on: queued unless Settings → The CEO turned its kind off. */
  protected followup(ev: Omit<FollowupEvent, 'id' | 'at'>): boolean {
    if (!addFollowup(this.state.ceo.followups, { ...ev, at: Date.now() }, this.state.settings.ceoFollowups)) return false;
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 150);
    return true;
  }

  /** Start a follow-up job when its batch window has passed, unless the hourly cap or Claude's usage holds it. */
  protected maybeFollowup() {
    const f = this.state.ceo.followups;
    const had = f.pending.length;
    const step = followupStep(f, { now: Date.now(), settings: this.state.settings.ceoFollowups, usage: this.usageNow().state });
    if (step.do === 'start') this.enqueueCeo({ kind: 'followup', events: takeFollowups(f, Date.now()), at: Date.now() });
    else if (f.pending.length !== had) {
      this.emitCeo();
      this.save();
    }
  }

  protected followupView(): CeoInfo['followups'] {
    return followupWaiting(this.state.ceo.followups, { now: Date.now(), settings: this.state.settings.ceoFollowups, usage: this.usageNow().state });
  }

  protected floorName(repo: PersistedRepo) {
    return `floor ${repo.floor} (${repo.fullName})`;
  }

  // ---------- triage ----------

  /**
   * A PR the office can't move on its own (needs-human): the CEO triages it first, at most MAX_TRIAGES times, and the
   * manager hears when the CEO escalates or takes no action, or when it keeps getting stuck. True: it went to the CEO.
   */
  protected stuck(rec: QaRecord, patch: Partial<QaRecord>, why: string): boolean {
    if (!this.state.qa.includes(rec)) return false; // its PR closed: nothing is stuck
    this.setQa(rec, { ...patch, status: 'needs-human', stuckWhy: why });
    const step = triageStep({ kind: 'stuck', triages: rec.triages });
    if (step.do !== 'triage') {
      this.escalate(rec, step.do === 'escalate' ? step.note : null);
      return false;
    }
    rec.triages += 1;
    this.enqueueCeo({ kind: 'triage', repoId: rec.repoId, prNumber: rec.prNumber, at: Date.now() });
    this.setQa(rec, {}); // the card shows the CEO looking
    return true;
  }

  /** Tell the manager a stuck PR needs them, once each time it gets stuck. note: what the CEO adds. */
  protected escalate(rec: QaRecord, note: string | null) {
    if (rec.status !== 'needs-human' || rec.escalated) return;
    this.setQa(rec, { escalated: true, ceoNote: note });
    const repo = this.state.repos.find((r) => r.id === rec.repoId);
    if (repo) this.postMessage('office', `⚠️ PR #${rec.prNumber} on ${repo.fullName} needs you: ${rec.stuckWhy ?? 'it is stuck'}.${note ? ` ${note}` : ''}`);
  }

  /** The CEO's triage job for this PR, queued or running. */
  protected triageJob(q: Pick<QaRecord, 'repoId' | 'prNumber'>) {
    const c = this.state.ceo;
    return [c.job, ...c.queue].find((j) => j?.kind === 'triage' && j.repoId === q.repoId && j.prNumber === q.prNumber) ?? null;
  }

  /** The record a triage job is for, while it is still waiting on a decision. */
  protected stuckRecord(job: CeoJob) {
    return this.state.qa.find((q) => q.repoId === job.repoId && q.prNumber === job.prNumber && q.status === 'needs-human' && !q.escalated);
  }

  /** What a triage job's prompt says about its PR: the QA record and GitHub's view of it now. null: no longer stuck. */
  protected async triagePr(job: CeoJob): Promise<TriagePr | null> {
    const rec = this.stuckRecord(job);
    const repo = this.state.repos.find((r) => r.id === job.repoId);
    if (!rec || !repo) return null;
    const listed = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === rec.prNumber);
    const pr = await this.backend.prDetails(repo.fullName, rec.prNumber).catch(() => null);
    if ((pr ?? listed)?.state !== 'OPEN') return null;
    return {
      number: rec.prNumber,
      title: pr?.title ?? listed?.title ?? '',
      url: pr?.url ?? listed?.url ?? '',
      round: rec.round,
      why: rec.stuckWhy,
      summary: rec.summary,
      fixInstructions: rec.fixInstructions,
      mergeNote: rec.mergeNote,
      checks: pr?.checks ?? listed?.checks ?? 'none',
      failedChecks: pr?.failedChecks ?? listed?.failedChecks.map((c) => c.name) ?? [],
      pendingChecks: pr?.pendingChecks ?? listed?.pendingChecks ?? [],
      mergeable: pr?.mergeable ?? listed?.mergeable ?? 'UNKNOWN',
      mergeState: pr?.mergeState ?? listed?.mergeState ?? 'UNKNOWN',
      triage: rec.triages,
    };
  }

  /** A triage job ended (done, failed or stopped): a PR still waiting on a decision goes to the manager. */
  protected endTriage(job: CeoJob) {
    const rec = this.stuckRecord(job);
    const pull = rec && this.repoRt.get(rec.repoId)?.pulls.find((p) => p.number === rec.prNumber);
    const step = triageStep({ kind: 'ended', acted: !rec || (pull != null && pull.state !== 'OPEN') }); // a closed PR leaves QA on the next sync
    if (rec && step.do === 'escalate') this.escalate(rec, step.note);
  }

  // ---------- the phone ----------

  /** `changes`: the team changes a CEO message proposes (Telegram gets their buttons); `telegram: 'in'`: sent from there; `closing`: a CEO turn's closing text (ceoSpoken). */
  protected postMessage(from: PhoneMessage['from'], text: string, requestId?: string, opts: Pick<PhoneMessage, 'replyTo' | 'clientId' | 'delivery' | 'telegram' | 'tg' | 'attachments' | 'used' | 'research' | 'log' | 'actions' | 'question' | 'notice' | 'signIn' | 'switch' | 'ceoStuck' | 'ceoRuns' | 'pacing' | 'ceoJob'> & { changes?: TeamChange[]; closing?: boolean } = {}) {
    const { changes, closing = false, ...extra } = opts;
    // The CEO's suggestion boxes and artifacts come out of the text; the office's notes are cleaned (shared/chatParts.ts).
    const parts = parseMessage(from, text);
    const id = this.messageSeq++;
    const artifacts = makeArtifacts(id, parts.artifacts);
    const body = parts.text.trim().slice(0, 6000);
    // The agents, floors, issues and files it names become chips (shared/chatRefs.ts).
    const home = extra.question ? this.state.questions.find((q) => q.id === extra.question)?.repoId : undefined;
    const refs = from === 'office' ? [] : parseRefs(body, { ...this.refContext(), ...(home && { home }) });
    const m: PhoneMessage = { id, from, text: body, at: Date.now(), ...(requestId ? { requestId } : {}), ...extra, ...(parts.suggestions && { suggestions: parts.suggestions }), ...(parts.ask && { ask: parts.ask }), ...(from === 'ceo' && this.ceoSpoken(parts, closing)), ...(parts.idea && { idea: parts.idea }), ...(artifacts && { artifacts }), ...(parts.visuals && { visuals: parts.visuals }), ...(refs.length && { refs }) };
    const v = this.state.settings.voice;
    if (v.provider !== 'off' && speaks(m, v)) m.voice = v.provider; // what the phone's ▶ replays it with
    if (from === 'ceo' && this.mirrorsToTelegram()) {
      m.telegram = 'out';
      void this.telegram.send(telegramMessage(this.ceo().name, m, this.state.settings.notify.officeUrl), changes ? teamKeyboard(changes) : undefined, id, this.state.messages.find((x) => x.id === m.replyTo)?.tg).then((why) => {
        if (why) this.postMessage('office', `That message didn't reach Telegram: ${why}.`);
      });
    }
    this.state.messages.push(m);
    if (this.state.messages.length > KEEP_MESSAGES) this.state.messages.splice(0, this.state.messages.length - KEEP_MESSAGES);
    this.broadcast({ type: 'message', message: m });
    if (touchConversation(this.state.ceo.chats, m)) this.broadcast({ type: 'ceoChat', conversations: conversationsView(this.state.ceo.chats) });
    this.save();
    // Proposals and agents' questions are notified as such (proposeHire, proposeLetGo, notifyQuestion).
    if (from === 'ceo' && !requestId && !m.question) {
      const said = m.text || (m.visuals ? withVisualsText('', m.visuals) : `📎 ${[...(m.artifacts ?? []).map((a) => a.title), ...(m.attachments ?? []).map((f) => f.name)].join(', ')}`);
      this.notice({ kind: 'ceo', title: this.ceo().name, text: plainText(said), actions: ['reply'] }, { event: 'ceoMessage', line: `${this.ceo().name}: ${plainText(said, 100)}`, message: m.id });
    }
    return m;
  }

  protected refContext(): RefContext {
    return {
      floors: this.state.repos.map((r) => ({ floor: r.floor, repoId: r.id })),
      agents: this.state.agents.filter((a) => a.role !== 'ceo').map((a) => ({ id: a.id, name: a.name })),
      hasFile: (repoId, rel) => {
        const repo = this.state.repos.find((r) => r.id === repoId);
        return !!repo && this.backend.hasRepoFile(repo.fullName, rel);
      },
      hasNumber: (repoId, n) => {
        const rt = this.repoRt.get(repoId);
        return !!rt && (rt.issues.some((i) => i.number === n) || rt.pulls.some((p) => p.number === n && p.state !== 'CLOSED'));
      },
    };
  }

  /** GET /api/messages/:id/refs/:index/file: a file ref's text on its floor's default branch, read when asked. */
  async refFile(messageId: number, index: number): Promise<RefFileView> {
    const ref = this.state.messages.find((m) => m.id === messageId)?.refs?.[index];
    if (ref?.kind !== 'file') throw new HttpError(404, 'That file reference is no longer saved');
    const repo = this.state.repos.find((r) => r.id === ref.repoId);
    if (!repo) throw new HttpError(404, 'That floor is no longer in the office');
    const url = fileUrl(repo.fullName, repo.defaultBranch, ref.path, ref.line);
    const text = await this.backend.readRepoFile(repo.fullName, repo.defaultBranch, ref.path).catch((e: Error) => Promise.reject(new HttpError(404, e.message)));
    return { path: ref.path, line: ref.line ?? null, text, url };
  }

  /** A CEO reply on the phone, with the files it attached and what it used since its last one. */
  protected postCeoReply(raw: string) {
    const text = stripHarness(raw); // harness output it echoed stays backend (#193)
    const job = this.state.ceo.job;
    const extra = { ...this.ceoFiles.takeReply(), ...researchRef(job), ...this.ceoChat.finishTurn(text) };
    if (job && BACKGROUND_KINDS.includes(job.kind) && text.trim()) this.state.ceo.lastJob = jobNote(job.kind, jobLabel(job, this.ceoFloor(job.repoId)), text, extra, Date.now()); // for the chat's digest (#330)
    const replyTo = replyTarget(this.state.messages); // the message it answers, when others came after it
    if (this.foldTurn(text, extra)) return; // folded into this turn's reply, a quiet note, or nothing to say (#378)
    this.ceoJobReplied(this.postMessage('ceo', text, undefined, { ...extra, ...this.ceoJobTag(), ...(replyTo !== undefined && { replyTo }), closing: true }));
  }

  /** GET /api/ceo/picks: the "/" list, the manager's installed skills and apps plus the connectors the CEO has used lately. */
  async ceoPicks(): Promise<QuickPicks> {
    return quickPicks(await this.backend.quickPicks().catch(() => ({ skills: [], apps: [] })), this.state.messages);
  }

  /** CEO messages go to Telegram too: the manager's last message came from there, or Settings mirrors the whole chat. */
  protected mirrorsToTelegram(): boolean {
    if (!this.telegram.active()) return false;
    if (this.state.settings.notify.telegramMirror) return true;
    return [...this.state.messages].reverse().find((m) => m.from === 'manager')?.telegram === 'in';
  }

  /** A team-change button pressed on Telegram: the same approve and decline as the lobby's. */
  protected decideFromTelegram(verdict: 'approve' | 'decline', id: string): string | Promise<string> {
    if (id.startsWith('it-')) return this.itDecide(verdict, id); // an IT card sent on this bot, as IT has none of its own (#524)
    const req = this.state.requests.find((r) => r.id === id);
    if (verdict === 'approve') this.approveRequest(id);
    else this.rejectRequest(id);
    return verdict === 'approve' ? `✅ Done: ${req?.kind === 'let-go' ? `${req.name} leaves` : `${req?.name ?? 'they'} joined`}.` : `✋ Declined${req ? `: ${req.name}` : ''}.`;
  }

  /** The CEO's send_telegram: to the manager's linked chat only. */
  protected async sendTelegram(a: { text: string }): Promise<string> {
    if (!this.telegram.active()) throw new Error(this.telegram.linked() ? 'The manager switched Telegram off in Settings → Notifications. Answer here instead.' : "Telegram isn't set up: the manager links their chat in Settings → Notifications → Telegram. Answer here instead.");
    const text = String(a.text ?? '').trim();
    if (!text) throw new Error('Write the message.');
    const why = await this.telegram.send(telegramChat(this.ceo().name, text.slice(0, 4000)));
    if (why) throw new Error(`It didn't go out: ${why}.`);
    return "Sent to the manager's Telegram.";
  }

  /** POST /api/notify/telegram/demo: the demo's fake manager on Telegram (see TelegramBot.demo). */
  telegramDemo(body: { kind?: unknown; text?: unknown }) {
    if (!this.backend.demo) throw new HttpError(404, 'Only the demo office has a fake Telegram.');
    return this.telegram.demo(body);
  }

  /** GET /api/messages/:id/artifacts/:artifactId: an artifact's markdown, for one the snapshot sent without it. */
  artifact(messageId: number, artifactId: string): { markdown: string } {
    const a = this.state.messages.find((m) => m.id === messageId)?.artifacts?.find((x) => x.id === artifactId);
    if (!a?.markdown) throw new HttpError(404, 'That attachment is no longer saved');
    return { markdown: a.markdown };
  }

  /** The team's holiday greeting (shared/themes.ts) from the CEO, once a day while a theme is on. */
  protected greet() {
    const text = dueGreeting(new Date(), this.state.settings.themes, this.state.settings.managerName || this.user || '', this.state.messages);
    if (text) this.postMessage('ceo', text);
  }

  // ---------- notifications ----------

  protected notifyNeedsHuman(rec: QaRecord) {
    const repo = this.state.repos.find((r) => r.id === rec.repoId);
    const title = this.repoRt.get(rec.repoId)?.pulls.find((p) => p.number === rec.prNumber)?.title;
    const name = repo?.fullName.split('/')[1] ?? rec.repoId;
    this.notice({ kind: 'needsYou', title: `PR #${rec.prNumber} needs you`, text: `${name}${title ? `: ${title}` : ''}. ${rec.stuckWhy ? `Stuck because ${rec.stuckWhy}.` : rec.summary ?? ''}`, target: { kind: 'qa', repoId: rec.repoId, number: rec.prNumber }, actions: ['openQa', 'openPr'] }, { event: 'needsHuman', line: `${name} #${rec.prNumber}${title ? ` ${title}` : ''}` });
  }

  protected notifyMerge(repo: PersistedRepo, n: number, title: string) {
    const name = repo.fullName.split('/')[1];
    this.notice({ kind: 'merge', title: `Merged PR #${n} into ${repo.defaultBranch}`, text: `${name}${title ? `: ${title}` : ''}`, target: { kind: 'issue', repoId: repo.id, number: n }, actions: ['openPr'] }, { event: 'merge', title: `Merged PR #${n}`, line: `${name} #${n}${title ? ` ${title}` : ''}` });
    const closes = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === n)?.closesIssues ?? [];
    this.followup(followupEvents.merged(repo.id, this.floorName(repo), n, clip(title, 100), closes));
  }

  /** Agents stuck in an error for STUCK_ERROR_MS: the manager hears once per error (checked every minute). */
  protected notifyStuck() {
    const now = Date.now();
    for (const { agent: a, key } of stuckAgents(this.state.agents, now, this.toldStuck)) {
      this.toldStuck.add(key);
      const repo = this.state.repos.find((r) => r.id === a.repoId);
      const mins = Math.round((now - (a.endedAt ?? now)) / 60_000);
      this.notice({ kind: 'stuck', title: `${a.name} needs help`, text: `In an error for ${mins} minutes${repo ? ` on floor ${repo.floor}` : ''}: ${clip(a.lastError ?? 'their session failed', 200)}`, target: { kind: 'agent', agentId: a.id, terminal: true }, actions: ['terminal', 'retry'] }, { event: 'agentError', line: `${a.name}${repo ? ` (floor ${repo.floor})` : ''}` });
      if (a.role !== 'ceo') this.followup(followupEvents.agentError(a, key, mins, clip(scrub(a.lastError ?? 'their session failed', this.secrets()), 200), repo?.id, repo && this.floorName(repo)));
    }
    this.alertBlocked(); // a prompt the watchdog couldn't answer is told after 5 minutes (liveState.ts)
    for (const q of this.state.questions) if (renotifyDue(q, now)) this.notifyQuestion(Object.assign(q, { renotified: true }), true);
    for (const key of this.toldStuck) if (!this.state.agents.some((a) => key === `${a.id}:${a.endedAt ?? 0}` && a.status === 'error')) this.toldStuck.delete(key);
  }

  markPhoneRead(at: number) {
    const t = Math.min(Number(at) || Date.now(), Date.now());
    if (t <= this.state.phoneReadAt) return;
    this.state.phoneReadAt = t;
    this.broadcast({ type: 'phoneRead', at: t });
    this.save();
  }
}
