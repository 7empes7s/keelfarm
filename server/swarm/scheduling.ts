// Handing out work: the scheduler, pacing on Claude's usage, mission control's numbers.
import type { SessionHandle, SessionResult } from '../agentRunner.ts';
import { stillOpen } from '../closeCleanup.ts';
import { CONSULT_DISALLOWED, consultAnswer, consultPrompt, nextConsult, type Consult } from '../consult.ts';
import { clip } from '../notify.ts';
import { ONE_TURN } from '../prompts.ts';
import { resolveEffort } from '../../shared/costs.ts';
import { redact as scrub } from '../../shared/journal.ts';
import { mergeSwitches, sessionTools } from '../../shared/tooling.ts';
import { fixGoesTo, pickTester, prepHeld } from '../handOut.ts';
import { HttpError } from '../httpError.ts';
import { mergeReadings, readingsChanged } from '../../shared/usage.ts';
import {
  mayStart,
  PACING_MS,
  pacingMessage,
  resumeRefusal,
  usageLabel,
  usageView,
  waived,
  warningView,
  type UsageWarning,
  type Waiver,
  type WorkKind,
} from '../pacing.ts';
import { opsView, recordChecks, recordMerges, type OpsFloorState } from '../metrics.ts';
import { mergedPulls } from '../costLedger.ts';
import { preferCli } from '../../shared/experiments.ts';
import { blockers, holdUps } from '../../shared/issues.ts';
import type { OpsView, PullInfo, UsageReading, UsageView, UsageWarningView } from '../../shared/types.ts';
import {
  type PersistedRepo,
  type PersistedAgent,
  type QaRecord,
  type PrepJob,
  prepKey,
  FREE,
  ERROR_COOLDOWN_MS,
  MAX_ISSUE_FAILURES,
  LIMIT_PAUSE_MS,
  READINGS_MS,
} from './model.ts';
import { SwarmQa } from './qa.ts';

export abstract class SwarmScheduling extends SwarmQa {
  // ---------- scheduling ----------

  /**
   * Can this agent take work now? One whose last session failed sits out a short cooldown, then gets work like everyone
   * else instead of waiting for the manager to reset them.
   */
  protected isFree(a: PersistedAgent) {
    if (a.needsSignIn) return false; // a cloud agent waiting to be signed in takes no work (docs/cloud.md)
    if (this.consulting(a)) return false;
    return FREE.includes(a.status) || (a.status === 'error' && Date.now() - (a.endedAt ?? 0) >= ERROR_COOLDOWN_MS);
  }

  /** A floor's agents who can take work now, by desk. */
  protected available(repo: PersistedRepo) {
    return this.state.agents.filter((a) => a.repoId === repo.id && a.role !== 'ceo' && this.isFree(a)).sort((x, y) => x.desk - y.desk);
  }

  protected scheduleOffset = 0;
  protected pausedUntil = 0; // Claude's usage limit was hit: nothing new starts before this
  protected pacingUntil = 0; // Claude warned about usage: new issues are paced until this
  protected pacingLimit: string | null = null; // which of Claude's limits the pacing is for
  protected lastWarning: UsageWarningView | null = null; // the latest usage warning, for the usage meter
  protected waiver: Waiver | null = null; // pacing the manager cleared with "Resume full speed"
  protected lastUsage = '';
  protected shownReadings: UsageReading[] = []; // the readings the office was last sent
  protected readingsTimer: NodeJS.Timeout | null = null;

  /** Backlog issues that can start now, most urgent first: the ones holding up the longest chain of other issues, then the oldest. */
  protected readyIssues(repo: PersistedRepo) {
    const issues = this.repoRt.get(repo.id)!.issues;
    const open = new Set(issues.map((i) => i.number));
    const weight = holdUps(issues);
    return issues
      .filter(
        (i) =>
          !i.labels.some((l) => /^(swarm:skip|wontfix|question)$/i.test(l)) &&
          !this.issueTaken(repo, i.number) &&
          !this.isHeld(repo.id, i.number) &&
          blockers(i.body, open).length === 0 &&
          (this.issueFailures.get(`${repo.id}#${i.number}`) ?? 0) < MAX_ISSUE_FAILURES,
      )
      .map((issue) => ({ issue, ...weight.get(issue.number)! }))
      .sort((x, y) => y.chain - x.chain || y.waiting - x.waiting || x.issue.number - y.issue.number);
  }

  /**
   * Finish work in flight: test queued PRs (oldest first) and get failed ones fixed. Returns true if work started.
   * Any free agent but the PR's author tests it (handOut.ts pickTester); its author goes on with other work meanwhile. A failed PR goes back to its author when they're free; while the
   * author is still in a session on it, it waits for them; otherwise any free agent takes it. A PR whose desks keep
   * failing to set up sits out.
   */
  protected startPipelineWork(repo: PersistedRepo): boolean {
    const free = this.available(repo);
    if (!free.length) return false;
    const now = Date.now();
    const floor = this.floorState(this.repoRt.get(repo.id)!);
    const waiting = (status: QaRecord['status'], task: PrepJob['task']) =>
      this.state.qa
        .filter(
          (q) =>
            q.repoId === repo.id &&
            q.status === status &&
            stillOpen({ kind: 'pr', number: q.prNumber }, floor) &&
            !prepHeld(this.prepStrikes.get(prepKey(repo.id, q.prNumber, task)), now),
        )
        .sort((x, y) => x.updatedAt - y.updatedAt);
    const fixes = waiting('failed', 'fix');
    const owed = new Set(fixes.map((q) => q.devAgentId).filter((id): id is string => !!id));
    for (const rec of waiting('queued', 'qa')) {
      const othersCan = this.state.agents.some((a) => a.repoId === repo.id && a.role !== 'ceo' && a.id !== rec.devAgentId && a.status !== 'stopped');
      const qaCli = this.lab.practice(repo.id, rec.issueNumber, rec.prNumber, 'qa').qaCli; // cross-model QA (#23)
      const tester = pickTester(preferCli(free, qaCli, rec.devAgentId, (a) => a.cli || this.state.settings.defaultCli), rec.devAgentId, owed, othersCan, now - rec.updatedAt);
      if (!tester) continue;
      if (!this.health.admit('qa')) return false;
      void this.runQa(tester, repo, rec);
      return true;
    }
    for (const rec of fixes) {
      const author = this.state.agents.find((a) => a.id === rec.devAgentId && a.repoId === repo.id && a.role !== 'ceo') ?? null;
      const headRef = this.repoRt.get(repo.id)!.pulls.find((p) => p.number === rec.prNumber)?.headRefName ?? null;
      const to = fixGoesTo(author, !!author && free.includes(author), rec.prNumber, headRef);
      if (to === 'wait') continue; // the author gets it when their session ends
      if (!this.health.admit('fix')) return false;
      void this.runFix(to === 'author' ? author! : (free.find((a) => !owed.has(a.id)) ?? free[0]), repo, rec);
      return true;
    }
    return false;
  }

  /**
   * Give a free agent the next backlog issue (auto-assign floors only). Returns true if work started. Issues that say
   * "Depends on #N" wait until #N is closed; the rest go in readyIssues() order.
   */
  protected startIssueWork(repo: PersistedRepo): boolean {
    if (!repo.autoAssign || !this.mayStart('issue')) return false;
    const agent = this.available(repo)[0];
    const next = agent ? this.readyIssues(repo)[0] : undefined;
    if (!agent || !next || !this.health.admit('build')) return false;
    // assign() flips the agent to 'preparing' synchronously, so the next pass sees it as busy.
    void this.assign(agent.id, next.issue.number).catch((err) => console.warn('auto-assign failed', err));
    return agent.status === 'preparing';
  }

  protected limited() {
    return Date.now() < this.pausedUntil;
  }

  /** Claude turned a session away for the usage limit: start nothing new until it resets, rather than failing agent after agent. */
  protected pauseForLimit(resetsAt: number | null) {
    const until = (resetsAt ?? Date.now() + LIMIT_PAUSE_MS) + 30_000;
    if (until <= this.pausedUntil) return;
    const fresh = Date.now() >= this.pausedUntil;
    this.pausedUntil = until;
    if (fresh) this.postMessage('office', `⏸ Claude's usage limit was reached. The office starts no new work until ${new Date(until).toLocaleTimeString()}; sessions already running carry on.`);
    this.emitUsage();
  }

  /** Claude warned that usage is getting high: pace new issues until the window resets, rather than run into the limit. */
  protected paceForWarning(info: UsageWarning) {
    const now = Date.now();
    this.lastWarning = warningView(info, now);
    const until = info.resetsAt && info.resetsAt > now ? info.resetsAt : now + PACING_MS;
    // The manager already resumed full speed for this window: they topped up, or their usage was reset.
    if (until <= this.pacingUntil || waived(info, this.waiver, now)) return this.emitUsage();
    const fresh = now >= this.pacingUntil;
    this.pacingUntil = until;
    this.pacingLimit = info.rateLimitType;
    if (fresh) this.postMessage('office', pacingMessage(info, until, this.state.settings.pacingSessions, now));
    this.emitUsage();
  }

  /** The manager's "Resume full speed" (they topped up, or their usage was reset): pacing ends now. A hard pause never does. */
  resumeFullSpeed(): UsageView {
    const now = Date.now();
    const refused = resumeRefusal({ now, pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil });
    if (refused) throw new HttpError(409, refused);
    this.waiver = { until: this.pacingUntil, limit: this.pacingLimit };
    this.pacingUntil = 0;
    this.postMessage('office', '⏩ You resumed full speed: new issues start as usual again. If Claude turns a session away at the limit, the office still pauses until it resets.');
    this.emitUsage();
    setTimeout(() => this.schedule(), 200);
    return this.usageNow();
  }

  /** The demo's stand-in for Claude's usage warning or limit (POST /api/usage/simulate), so pacing and the pause can be tried. */
  simulateUsage(kind: unknown): UsageView {
    const fake = this.backend.simulateUsage;
    if (!fake) throw new HttpError(404, 'Usage can only be simulated in the demo office.');
    if (kind !== 'warning' && kind !== 'limit') throw new HttpError(400, 'kind must be "warning" or "limit"');
    const usage = fake(kind, Date.now());
    if ('limitResetsAt' in usage) this.pauseForLimit(usage.limitResetsAt);
    else {
      this.waiver = null; // a simulated warning always paces, even after Resume full speed
      this.paceForWarning(usage);
    }
    return this.usageNow();
  }

  /** May work of this kind start now, as far as Claude's usage goes? */
  protected mayStart(kind: WorkKind) {
    return mayStart(kind, { now: Date.now(), pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil, running: this.running(), pacingSessions: this.state.settings.pacingSessions });
  }

  protected usageNow() {
    return usageView({ now: Date.now(), pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil }, this.lastWarning);
  }

  protected emitUsage() {
    const usage = this.usageNow();
    const key = JSON.stringify(usage);
    if (key === this.lastUsage) return;
    const was = this.lastUsage ? (JSON.parse(this.lastUsage) as typeof usage).state : 'normal';
    this.lastUsage = key;
    this.broadcast({ type: 'usage', usage });
    if (usage.state !== was) {
      this.emitCeo(); // the CEO's chat is held under the limit, or free again
      const text = usage.state === 'normal' ? "Claude's usage is back to normal after pacing or a pause" : `Claude's usage is ${usageLabel(usage, Date.now())}`;
      this.followup({ kind: 'usage', key: 'usage', label: `usage ${usage.state}`, text: `${text}. Check whether team sizes and what is queued still fit.` });
    }
    if (usage.state !== was && usage.state !== 'normal') {
      const until = usage.until ? new Date(usage.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'it resets';
      if (usage.state === 'paused') this.notifier.notify('usage', "Claude's usage limit was reached", `The office starts no new work until ${until}; running sessions carry on.`);
      else this.notifier.notify('usage', 'Pacing new work', `Claude warned that usage is high, so new issues start slowly until ${until}.`);
    }
  }

  /** Claude's latest usage readings from any session: kept and saved, and sent to the office at most every few seconds. */
  protected recordUsage(readings: UsageReading[]) {
    this.state.claudeUsage = mergeReadings(this.state.claudeUsage, readings);
    if (this.readingsTimer || !readingsChanged(this.shownReadings, this.state.claudeUsage)) return;
    this.readingsTimer = setTimeout(() => {
      this.readingsTimer = null;
      this.shownReadings = this.state.claudeUsage;
      this.broadcast({ type: 'claudeUsage', readings: this.state.claudeUsage });
      this.save();
    }, READINGS_MS);
    this.readingsTimer.unref?.();
  }

  /** Pacing and pauses run out on their own: say so when pacing ends. */
  protected tickUsage() {
    if (this.pacingUntil && Date.now() >= this.pacingUntil) {
      this.pacingUntil = 0;
      this.postMessage('office', "✅ Claude's usage is back to normal. The office starts new work at full speed again.");
    }
    this.emitUsage();
  }

  // ---------- mission control ----------

  protected opsTimer: NodeJS.Timeout | null = null;
  protected lastOps = '';

  /** A sync's merges (stamped with their issues' ages) and finished check runs go into mission control's history. */
  protected recordSync(repo: PersistedRepo, pulls: PullInfo[]) {
    const now = Date.now();
    if (recordMerges(this.state.ops, repo.id, pulls, now) + recordChecks(this.state.ops, repo.id, pulls, now) > 0) this.save();
    void this.spend.ledger.merges(mergedPulls(repo.id, pulls, now));
    this.lab.pulls(repo.id, pulls);
  }

  /** Every floor as mission control sees it now. */
  protected opsNow(): OpsView {
    const floors: OpsFloorState[] = this.state.repos.map((r) => {
      const rt = this.repoRt.get(r.id);
      return {
        repoId: r.id,
        floor: r.floor,
        ready: rt?.lastSync ? this.readyIssues(r).length : 0,
        agents: this.state.agents.filter((a) => a.repoId === r.id),
        prs: (rt?.pulls ?? [])
          .filter((p) => p.state === 'OPEN')
          .map((p) => {
            const q = this.state.qa.find((x) => x.repoId === r.id && x.prNumber === p.number);
            return { number: p.number, qa: q ? this.qaView(q) : null, why: q?.stuckWhy ?? q?.mergeNote ?? null };
          }),
      };
    });
    return opsView(floors, this.state.ops, Date.now());
  }

  /** Recompute mission control shortly: changes usually come several at a time. */
  protected opsSoon() {
    this.opsTimer ??= setTimeout(() => this.emitOps(), 400);
  }

  /** Broadcast mission control's numbers, but only when they changed: the wall repaints only then. */
  protected emitOps() {
    if (this.opsTimer) clearTimeout(this.opsTimer);
    this.opsTimer = null;
    const ops = this.opsNow();
    const key = JSON.stringify(ops);
    if (key === this.lastOps) return;
    this.lastOps = key;
    this.broadcast({ type: 'ops', ops });
  }

  /** A failed session releases its issue for someone else; an issue that keeps failing waits for the manager. */
  protected issueFailed(repo: PersistedRepo, n: number | null) {
    if (n == null || this.limited()) return; // the usage limit isn't the issue's fault
    const key = `${repo.id}#${n}`;
    const failures = (this.issueFailures.get(key) ?? 0) + 1;
    this.issueFailures.set(key, failures);
    if (failures === MAX_ISSUE_FAILURES) {
      this.postMessage('office', `⚠️ Issue #${n} on ${repo.fullName} failed ${failures} sessions in a row, so auto-assign skips it now. Assign it to someone by hand once it's sorted.`);
    }
  }

  /**
   * Hand out work for free session slots. Finishing beats starting: QA and QA fixes on every floor go before any new issue.
   * Within each phase floors take turns (one job per floor per pass), and the starting floor rotates between calls,
   * so no repo can hog the slots.
   */
  protected schedule() {
    this.tickUsage();
    this.progressTick();
    const draining = this.officeUpdateTick(); // draining for the office's own update: only the CEO's chat starts
    if (!draining) this.applyTeamChanges(); // before handing out work, so agents on their way out get none
    if (!draining && !this.limited()) {
      this.maybeHeartbeat();
      this.maybeFollowup();
    }
    // Management first: the CEO's jobs are short and shape everyone else's work, and the manager's chat never waits.
    this.startCeoWork(draining);
    if (draining || this.limited()) return;
    const repos = this.state.repos.filter((r) => {
      const rt = this.repoRt.get(r.id);
      return rt && rt.lastSync != null && rt.cloneStatus !== 'error';
    });
    if (repos.length === 0) return;
    this.scheduleOffset = (this.scheduleOffset + 1) % repos.length;
    const order = [...repos.slice(this.scheduleOffset), ...repos.slice(0, this.scheduleOffset)];
    // Consults come after QA and fixes, before new issues (#28).
    for (const start of [(r: PersistedRepo) => this.startPipelineWork(r), (r: PersistedRepo) => this.startConsultWork(r), (r: PersistedRepo) => this.startIssueWork(r)]) {
      let progress = true;
      while (progress) {
        progress = false;
        for (const repo of order) {
          if (this.slotsFull()) return;
          if (start(repo)) progress = true;
        }
      }
    }
  }

  // ---------- consults for the CEO (#28) ----------

  /** A free agent on this floor takes the next consult (nextConsult). True: one started. */
  protected startConsultWork(repo: PersistedRepo): boolean {
    const free = this.available(repo).filter((a) => a.host !== 'box' && !this.agentRt.get(a.id)?.session);
    const pick = nextConsult(this.consults, repo.id, free.map((a) => a.id), this.state.settings.ceoAwake.consultMax, () => this.health.admit('consult'));
    const a = pick && this.state.agents.find((x) => x.id === pick.agentId);
    if (!pick || !a) return false;
    this.startConsult(a, pick.consult, repo);
    return true;
  }

  /** A consult session: the agent's own worktree (or the floor's clone of main), read-only, under its time cap. */
  protected startConsult(a: PersistedAgent, c: Consult, repo: PersistedRepo) {
    const rt = this.agentRt.get(a.id)!;
    c.runningOn = a.id;
    const startedAt = Date.now();
    const desk = a.machine ? this.deskOf(a, repo) : null;
    const cwd = desk && this.backend.deskExists(desk) ? desk : this.backend.mainDir(repo.fullName);
    Object.assign(c, { startedAt, dir: cwd });
    this.appendLog(a, [{ kind: 'system', text: '' }, { kind: 'system', text: `━━━ 🔎 consult · ${this.ceo().name} asks: ${clip(c.question, 200)} ━━━` }]);
    this.emitAgent(a);
    const run = this.spend.start(a.id, { kind: 'consult', effort: resolveEffort(a.effort, 'consult', this.state.settings.taskEffort, this.state.settings.defaultEffort), model: this.modelFor(a, 'claude') || a.model, startedAt, round: null });
    const t = this.state.settings.tools;
    const tools = sessionTools(this.tooling.items, 'agent', mergeSwitches(t.everyone, a.tools));
    const inTerminal = this.state.settings.runtime === 'terminal' && this.backend.terminals;
    let handle: SessionHandle | undefined;
    let done = false;
    const finished = (result: SessionResult) => {
      done = true;
      clearTimeout(cap);
      if (rt.session === handle) {
        // only its own handle: the office never lets other work start on a consulting agent, but stays safe if it did
        rt.session = null;
        rt.currentTool = null;
      }
      this.health.ended(a, 'consult', result.errors, false, false); // its peak teaches the consult estimate
      this.consults = this.consults.filter((q) => q !== c);
      const text = result.ok ? consultAnswer(a.name, repo.floor, result.text) : `${a.name} couldn't answer: ${result.errors.join('; ') || 'the consult session failed'}.`;
      this.appendLog(a, [{ kind: result.ok ? 'done' : 'error', text: `🔎 consult · ${result.ok ? 'answered' : 'no answer'} in ${Math.max(1, Math.round((Date.now() - startedAt) / 60_000))}m` }]);
      void this.spend.record({ ...a, startedAt, issueNumber: null, prNumber: null }, repo.id, run, 'consult', result, { stopped: false, ceoHint: 'done' });
      if (this.consultAnswers.has(c.id)) this.consultAnswers.set(c.id, scrub(text, this.secrets())); // else nobody waits any more
      this.holds.check();
      this.emitAgent(a);
      setTimeout(() => this.schedule(), 300);
    };
    handle = this.backend.startSession(
      {
        cwd,
        prompt: consultPrompt(c, repo.fullName, this.ceo().name),
        systemAppend: `You are ${a.name}, an agent on floor ${repo.floor}, answering a question from the CEO. ${ONE_TURN}`,
        model: run.model,
        effort: run.effort,
        browserTesting: false,
        additionalDirectories: [],
        role: a.role,
        tools: { ...tools, disallowed: [...tools.disallowed, ...CONSULT_DISALLOWED] },
        readOnly: true,
        agentId: a.id,
        ...(inTerminal ? { terminal: this.terminalFor(a), cli: 'claude' as const, label: `${a.name} · consult` } : {}),
      },
      {
        log: (entries) => this.appendLog(a, entries),
        tool: (name) => {
          rt.currentTool = name;
          this.emitAgent(a);
        },
        sessionId: () => undefined, // their own task's session stays the one to resume
        browserUrl: () => undefined,
        screenshot: () => undefined,
        finished,
      },
    );
    if (!done) rt.session = handle;
    const cap = setTimeout(() => handle?.stop(), this.state.settings.ceoAwake.consultMin * 60_000);
  }
}
