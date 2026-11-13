// Handing out work: the scheduler, pacing on Claude's usage, mission control's numbers.
import type { SessionHandle, SessionResult } from '../agentRunner.ts';
import { stillOpen } from '../closeCleanup.ts';
import { CeoHolds } from '../ceoHold.ts';
import { CONSULT_DISALLOWED, consultAnswer, consultPrompt, nextConsult, type Consult } from '../consult.ts';
import { clip } from '../notify.ts';
import { ONE_TURN } from '../prompts.ts';
import { resolveEffort } from '../../shared/costs.ts';
import { redact as scrub } from '../../shared/journal.ts';
import { mergeSwitches, sessionTools } from '../../shared/tooling.ts';
import { fixGoesTo, pickTester, pipelineQueue, prepHeld, runnerFor, runsHere, WORK_PHASES } from '../handOut.ts';
import { localFirst } from '../hybrid.ts';
import { HttpError } from '../httpError.ts';
import type { SessionKind } from '../health.ts';
import { accountUsageLabel, mergeReadings, readingsChanged, usageChoice } from '../../shared/usage.ts';
import { sharesSignature, usageShares } from '../../shared/usageShares.ts';
import { afterPoll, pollDue, type PollState, type UsageCheck } from '../usagePoll.ts';
import {
  clampPacingSessions,
  fullSpeedByChoice,
  mayStart,
  pacingMessage,
  resumeRefusal,
  usageLabel,
  usageView,
  warningOutcome,
  warningView,
  type UsageWarning,
  type WorkKind,
} from '../pacing.ts';
import { opsView, recordAvoided, recordChecks, recordMerges, type OpsFloorState } from '../metrics.ts';
import { mergedPulls } from '../costLedger.ts';
import { preferCli } from '../../shared/experiments.ts';
import { blockers, holdUps } from '../../shared/issues.ts';
import { planAssign } from '../../shared/assignIssue.ts';
import { questionOf, waitsOnAnswer } from '../../shared/questions.ts';
import { chooseIssue, predictFiles } from '../../shared/practices.ts';
import { areaFiles, isPriorityLabel, pickNext, playbookAreas } from '../../shared/conflicts.ts';
import type { OpsView, PullInfo, ServerEvent, SwarmSettings, UsageReading, UsageView, UsageWarningView, WorldSnapshot } from '../../shared/types.ts';
import {
  type PersistedRepo,
  type PersistedAgent,
  type QaRecord,
  prepKey,
  FREE,
  BUSY,
  ERROR_COOLDOWN_MS,
  MAX_ISSUE_FAILURES,
  LIMIT_PAUSE_MS,
  READINGS_MS,
  SHARES_MS,
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
    if (this.pinWait(a)) return false; // pinned to an account that's out (#360, #579)
    if (this.setupBlocks(a.id)) return false; // signed out, as the setup advisor found (#366)
    if (questionOf(this.state.questions, a.id)) return false; // waiting on an answer: it resumes their task
    if (this.consulting(a)) return false;
    return FREE.includes(a.status) || (a.status === 'error' && Date.now() - (a.endedAt ?? 0) >= ERROR_COOLDOWN_MS);
  }

  /** A floor's agents who can take work now, by desk; in Hybrid this computer's first (#260: no Box CPU cost; runner() still sends work to a Box when memory is short). */
  protected available(repo: PersistedRepo) {
    const free = this.state.agents.filter((a) => a.repoId === repo.id && a.role !== 'ceo' && this.isFree(a)).sort((x, y) => x.desk - y.desk);
    return this.state.settings.cloud.machineKind === 'hybrid' ? localFirst(free) : free;
  }

  protected scheduleOffset = 0;
  protected pausedUntil = 0; // Claude's usage limit was hit: nothing new starts before this
  private pausedAllOut = false; // that pause is rotation's every-account-out one, which ends once an account has room
  protected pacingUntil = 0; // Claude warned about usage: new issues are paced until this
  protected pacingLimit: string | null = null; // which of Claude's limits the pacing is for
  protected lastWarning: UsageWarningView | null = null; // the latest usage warning, for the usage meter
  protected lastUsage = '';
  protected shownReadings: UsageReading[] = []; // the readings the office was last sent
  protected readingsTimer: NodeJS.Timeout | null = null;
  private sharesTimer: NodeJS.Timeout | null = null;
  private sentShares = ''; // the floor shares the tabs were last sent (#334)
  protected usagePoll: PollState = { lastTry: 0, failures: 0 }; // the office's own checks of Claude's usage while idle (#89)
  protected usagePolling = false;

  /** Backlog issues that can start now, most urgent first: the ones holding up the longest chain of other issues, then the oldest. */
  protected readyIssues(repo: PersistedRepo) {
    const issues = this.repoRt.get(repo.id)!.issues;
    const open = new Set(issues.map((i) => i.number));
    const weight = holdUps(issues);
    return issues
      .filter(
        (i) =>
          !i.untrusted &&
          !i.labels.some((l) => /^(swarm:skip|wontfix|question)$/i.test(l)) &&
          !this.issueTaken(repo, i.number) &&
          !this.isHeld(repo.id, i.number) &&
          !this.state.agents.some((a) => a.repoId === repo.id && a.nextIssue === i.number) && // someone's next task (#265)
          blockers(i.body, open).length === 0 &&
          (this.issueFailures.get(`${repo.id}#${i.number}`) ?? 0) < MAX_ISSUE_FAILURES,
      )
      .map((issue) => ({ issue, ...weight.get(issue.number)! }))
      .sort((x, y) => y.chain - x.chain || y.waiting - x.waiting || x.issue.number - y.issue.number);
  }

  /**
   * Finish work in flight (handOut.ts pipelineQueue): bring QA-passed PRs up to date, test queued PRs and get failed ones fixed. Returns true if work started.
   * Any free agent but the PR's author tests it (handOut.ts pickTester); its author goes on with other work meanwhile. A failed PR goes back to its author when they're free; while the
   * author is still in a session on it, it waits for them; otherwise any free agent takes it. A PR whose desks keep
   * failing to set up sits out.
   */
  protected startPipelineWork(repo: PersistedRepo): boolean {
    const free = this.available(repo);
    if (!free.length) return false;
    const now = Date.now();
    const rt = this.repoRt.get(repo.id)!;
    const floor = this.floorState(rt);
    const asking = (q: QaRecord) => waitsOnAnswer(this.state.questions, repo.id, rt.pulls.find((p) => p.number === q.prNumber), [q.devAgentId, ...this.state.agents.filter((a) => a.repoId === repo.id && a.prNumber === q.prNumber).map((a) => a.id)]);
    const queue = pipelineQueue(this.state.qa.filter((q) => q.repoId === repo.id && stillOpen({ kind: 'pr', number: q.prNumber }, floor) && !this.outsidePull(repo.id, q.prNumber) && !asking(q))).filter(
      ({ rec, task }) => !prepHeld(this.prepStrikes.get(prepKey(repo.id, rec.prNumber, task)), now),
    );
    const owed = new Set(queue.flatMap(({ rec, task }) => (task === 'fix' && rec.devAgentId ? [rec.devAgentId] : [])));
    for (const { rec, task } of queue) {
      if (task === 'fix') {
        const started = this.startFix(repo, rec, free, owed);
        if (started !== false) return !!started;
        continue;
      }
      const othersCan = this.state.agents.some((a) => a.repoId === repo.id && a.role !== 'ceo' && a.id !== rec.devAgentId && a.status !== 'stopped');
      const qaCli = this.lab.practice(repo.id, rec.issueNumber, rec.prNumber, 'qa').qaCli; // cross-model QA (#23)
      const pick = (pool: PersistedAgent[]) => pickTester(preferCli(pool, qaCli, rec.devAgentId, (a) => a.cli || this.state.settings.defaultCli), rec.devAgentId, owed, othersCan, now - rec.updatedAt);
      const picked = pick(free);
      if (!picked) continue;
      const tester = this.runner('qa', repo, picked, free, pick);
      if (!tester) return false;
      void this.runQa(tester, repo, rec);
      return true;
    }
    return false;
  }

  /** Hand a failed PR's fix to its author when free, else to a free agent (handOut.ts fixGoesTo). True: it started; false: it waits for its author; null: for memory. */
  protected startFix(repo: PersistedRepo, rec: QaRecord, free: PersistedAgent[], owed: ReadonlySet<string>): boolean | null {
    const author = this.state.agents.find((a) => a.id === rec.devAgentId && a.repoId === repo.id && a.role !== 'ceo') ?? null;
    const headRef = this.repoRt.get(repo.id)!.pulls.find((p) => p.number === rec.prNumber)?.headRefName ?? null;
    const to = fixGoesTo(author, !!author && free.includes(author), rec.prNumber, headRef);
    if (to === 'wait') return false; // the author gets it when their session ends
    const pick = (pool: PersistedAgent[]) => (to === 'author' && pool.includes(author!) ? author! : (pool.find((a) => !owed.has(a.id)) ?? pool[0] ?? null));
    const fixer = this.runner('fix', repo, pick(free)!, free, pick);
    if (!fixer) return null;
    void this.runFix(fixer, repo, rec);
    return true;
  }

  /** Who of the floor's free agents runs work of `kind` that `picked` would get: a free Box agent (`pick`ed from them) when this computer is short of memory for a local one (#263). Null: it waits for memory. */
  protected runner(kind: SessionKind, repo: PersistedRepo, picked: PersistedAgent, free: PersistedAgent[], pick: (pool: PersistedAgent[]) => PersistedAgent | null) {
    return runnerFor(picked, () => pick(free.filter((a) => !runsHere(a))), () => !this.health.refusal(kind), () => this.health.admit(kind, repo.id));
  }

  /**
   * Give a free agent the next backlog issue (auto-assign floors only). Returns true if work started. Issues that say
   * "Depends on #N" wait until #N is closed; the rest go in readyIssues() order.
   */
  protected startIssueWork(repo: PersistedRepo): boolean {
    if (!repo.autoAssign) return false;
    if (!this.mayStart('issue')) {
      this.nextIssue(repo, false); // paced: the floor still shows what leases hold back
      return false;
    }
    const free = this.available(repo);
    const { issue: next, avoided } = this.nextIssue(repo, free.length > 0);
    if (!free[0] || !next) return false;
    const agent = this.runner('build', repo, free[0], free, (pool) => pool[0] ?? null);
    if (!agent) return false;
    // assign() flips the agent to 'preparing' synchronously, so the next pass sees it as busy.
    void this.assign(agent.id, next.number).catch((err) => console.warn('auto-assign failed', err));
    if (avoided && agent.status === 'preparing') recordAvoided(this.state.ops, repo.id, next.number, Date.now()); // Mission control's conflicts avoided (#256)
    return agent.status === 'preparing';
  }

  // ---------- Assign to… (#265, shared/assignIssue.ts) ----------

  /** Can an agent start an issue by hand right now? Busy, consulting, asking or waiting for a sign-in: no, it waits as their next task. */
  protected startable(a: PersistedAgent) {
    return !BUSY.includes(a.status) && !a.needsSignIn && !questionOf(this.state.questions, a.id) && !this.consulting(a);
  }

  /**
   * The manager's Assign to… (Kanban card, issue sheet) and the CEO's assign_issue: a free agent starts the issue now,
   * a busy one gets it as their next task (startQueuedWork), and no running work stops. The manager's goes to the CEO
   * as a change (#207). `who`: an agent's id or name, or "next free".
   */
  async assignIssue(repoId: string, issueNumber: number, who: string, by: 'manager' | 'ceo' = 'manager') {
    const repo = this.repo(repoId);
    const issue = (this.repoRt.get(repo.id)?.issues ?? []).find((i) => i.number === issueNumber);
    if (!issue) throw new HttpError(404, `Issue #${issueNumber} is not open on ${repo.fullName}.`);
    if (issue.untrusted) throw new HttpError(403, `#${issueNumber} is from @${issue.author ?? 'ghost'}, who isn't trusted on ${repo.fullName}: only the manager can let it in (Trust this issue on the Kanban).`);
    const team = this.state.agents.filter((a) => a.repoId === repo.id && a.role !== 'ceo').sort((x, y) => x.desk - y.desk);
    const holder = team.find((a) => a.task === 'issue' && a.issueNumber === issueNumber && BUSY.includes(a.status));
    let plan;
    try {
      plan = planAssign(team.map((a) => ({ id: a.id, name: a.name, free: this.startable(a), startedAt: a.startedAt, nextIssue: a.nextIssue })), issueNumber, who, holder?.name);
    } catch (err) {
      throw new HttpError(409, (err as Error).message);
    }
    const a = this.agent(plan.agentId);
    for (const x of team.filter((t) => t !== a && t.nextIssue === issueNumber)) {
      x.nextIssue = null; // one agent's next task at a time: it moves to the new pick
      this.emitAgent(x);
    }
    let started = false;
    if (plan.start) {
      try {
        await this.assign(a.id, issueNumber);
        started = true;
      } catch (err) {
        // No session slot or memory for it now: it waits as their next task and starts once there is.
        if (!(err instanceof HttpError) || (err.status !== 429 && err.status !== 503)) throw err;
      }
    }
    if (!started) {
      a.nextIssue = issueNumber;
      this.appendLog(a, [{ kind: 'system', text: `📌 Next: #${issueNumber} ${issue.title}${BUSY.includes(a.status) ? ', after the current task' : ''} (${by === 'ceo' ? `assigned by ${this.ceo().name}` : 'assigned by the manager'})` }]);
      this.emitAgent(a);
    }
    const when = started ? 'starts now' : BUSY.includes(a.status) ? `next, after ${this.agentDoing(a)}` : 'next, when a session can start';
    if (by === 'manager') this.managerChange(repo, 'assign', { issue: issueNumber }, `assigned #${issueNumber} "${clip(issue.title, 60)}" to ${a.name} (${when})`, []);
    else this.save();
    return { agent: this.agentView(a, false), started, replaces: plan.replaces, text: `${a.name} ${started ? `starts #${issueNumber} now` : `takes #${issueNumber} ${when.replace(/^next, /, '')}`}${plan.replaces ? `, instead of #${plan.replaces}` : ''}.` };
  }

  /** Free agents with a next task (#265) start it before any other work; one no longer open or already taken is dropped. */
  protected startQueuedWork(repo: PersistedRepo): boolean {
    for (const a of this.available(repo)) {
      const n = a.nextIssue;
      if (n == null) continue;
      const issue = this.repoRt.get(repo.id)!.issues.find((i) => i.number === n);
      const holder = this.state.agents.find((x) => x.id !== a.id && x.repoId === repo.id && x.task === 'issue' && x.issueNumber === n && BUSY.includes(x.status));
      if (!issue || issue.untrusted || holder) {
        a.nextIssue = null;
        this.appendLog(a, [{ kind: 'system', text: `📌 #${n} is no longer their next task: ${holder ? `${holder.name} is building it` : 'it closed'}.` }]);
        this.emitAgent(a);
        this.save();
        continue;
      }
      if (!this.runner('build', repo, a, [a], (pool) => pool[0] ?? null)) continue; // waits for memory, still queued
      void this.assign(a.id, n).catch((err) => console.warn('next task failed to start', err));
      if (a.status !== 'preparing') continue;
      a.nextIssue = null;
      this.emitAgent(a);
      return true;
    }
    return false;
  }

  /**
   * The ready issue to start next: the first in readyIssues() order, unless file leases (#24) or conflict-aware
   * scheduling (#256) are on for the floor or an experiment's variant. With leases, one whose predicted files overlap
   * work in flight waits (chooseIssue); with conflict-aware scheduling, one overlapping busy files heavily waits for a
   * non-overlapping one, never leaving an agent idle, and a priority pick never waits (pickNext). The holds are worked
   * out on every pass, so the floor shows them even while nobody is free. `avoided`: an overlapping issue was skipped.
   */
  protected nextIssue(repo: PersistedRepo, someoneFree: boolean) {
    if (!this.leasesWanted(repo)) return { issue: someoneFree ? this.readyIssues(repo)[0]?.issue : undefined, avoided: false };
    const ready = this.readyIssues(repo).map((r) => r.issue);
    const fp = this.floorPractice(repo.id);
    const known = fp.known();
    const busy = this.busyWanted(repo);
    const areas = busy ? playbookAreas(repo.playbook) : [];
    const items = ready.map((i) => {
      const p = this.practicesOf(repo, i.number, null, i);
      const text = `${i.title}\n${i.body}`;
      const files = predictFiles(text, known);
      // Conflict-aware scheduling also reads the floor's areas and the files the issue's earlier PRs changed.
      const more = busy ? [...areaFiles(text, areas, known), ...(fp.issueFiles.get(i.number) ?? [])] : [];
      return { number: i.number, files: [...new Set([...files, ...more])], on: busy ? p.busyFiles : p.leases, priority: i.labels.some(isPriorityLabel) };
    });
    const o = { now: Date.now(), heldSince: fp.since() };
    const { pick, held, avoided } = busy ? pickNext(items, this.leasesOf(repo), o) : { ...chooseIssue(items, this.leasesOf(repo), o), avoided: false };
    if (fp.setHolds(held)) this.emitRepo(repo);
    return { issue: someoneFree ? ready.find((i) => i.number === pick) : undefined, avoided };
  }

  protected limited() {
    return Date.now() < this.pausedUntil;
  }

  /** Claude turned a session away for the usage limit: start nothing new until it resets, rather than failing agent after agent. */
  protected pauseForLimit(resetsAt: number | null, told = false, allOut = false) {
    const until = (resetsAt ?? Date.now() + LIMIT_PAUSE_MS) + 30_000;
    if (allOut) this.pausedAllOut = true; // every account, the built-in login too, is marked out in rotation
    if (until <= this.pausedUntil) return;
    const fresh = Date.now() >= this.pausedUntil;
    this.pausedUntil = until;
    this.pausedAllOut = allOut;
    if (fresh && !told) this.postMessage('office', `⏸ ${this.limitWho()} reached its usage limit. The office starts no new work until ${new Date(until).toLocaleTimeString()}; sessions already running carry on.`);
    this.emitUsage();
  }

  /** company.usage's account (#383): the one the next session starts on, named, with its own numbers ("next on Ultra: 5h 67% · week 11%"). */
  protected nextUsage(): string {
    const n = this.accounts.upNext('claude');
    return n ? `next on ${accountUsageLabel(n.label, n.usage, Date.now(), this.accounts.list().find((a) => a.id === n.id)?.builtIn ? this.usageCheck : null)}` : '';
  }

  /**
   * The pause for every account being out ends as soon as rotation has one with room again (its limit lifted by the
   * provider's own usage, a new sign-in, or a reset), not at the reset time the first message named. A pause for the
   * built-in or only login's limit isn't rotation's to lift: it waits for its reset.
   */
  protected liftPauseWhenFree() {
    if (!this.pausedAllOut || !this.limited() || !this.accounts.hasFree('claude')) return;
    this.pausedUntil = 0;
    this.pausedAllOut = false;
    const n = this.accounts.upNext('claude');
    this.postMessage('office', `▶ ${n?.label ?? 'A Claude account'} has room again: new work starts now.`);
    this.emitUsage();
  }

  /** Who a pause at the limit is for (#383): only the built-in login (or the only account) pauses the office, so it's named. */
  private limitWho(): string {
    return this.accounts.list().find((a) => a.builtIn && a.cli === 'claude')?.label ?? 'Claude';
  }

  /** Claude warned that usage is getting high: pace new issues until the window resets, rather than run into the limit. */
  protected paceForWarning(info: UsageWarning) {
    const now = Date.now();
    this.lastWarning = warningView(info, now);
    // Nothing paces under "Keep full speed", or when the manager already resumed full speed for this window (they topped up, or their usage was reset).
    const pace = warningOutcome(info, { now, pacingUntil: this.pacingUntil, waiver: this.state.usageWaiver ?? null, choice: this.usageChoice() });
    if (!pace) return this.emitUsage();
    this.pacingUntil = pace.until;
    this.pacingLimit = info.rateLimitType;
    if (pace.fresh) this.postMessage('office', pacingMessage(info, pace.until, this.state.settings.pacingSessions, now), undefined, { pacing: true });
    this.emitUsage();
  }

  protected usageChoice() {
    return usageChoice(this.state.settings.usageWarnings);
  }

  /** Settings → Agents' pacing fields. Choosing "Keep full speed" while pacing ends it now, as Resume full speed would. */
  protected pacingSettings(patch: Partial<Pick<SwarmSettings, 'pacingSessions' | 'usageWarnings'>>) {
    const s = this.state.settings;
    if (patch.pacingSessions !== undefined) s.pacingSessions = clampPacingSessions(patch.pacingSessions);
    if (patch.usageWarnings === undefined) return;
    s.usageWarnings = usageChoice(patch.usageWarnings);
    if (s.usageWarnings !== 'full' || this.usageNow().state !== 'pacing') return this.emitUsage();
    this.endPacing('⏩ Full speed from now on, by your choice: Claude\'s usage warnings no longer pace new work (Settings → Agents to change it). If Claude turns a session away at the limit, the office still pauses until it resets.');
  }

  /** Pacing ends now by the manager's choice, remembered for its usage window (across restarts too). */
  protected endPacing(text: string) {
    this.state.usageWaiver = { until: this.pacingUntil, limit: this.pacingLimit };
    this.pacingUntil = 0;
    this.save();
    this.postMessage('office', text);
    this.emitUsage();
    setTimeout(() => this.schedule(), 200);
  }

  /** The manager's "Resume full speed" (they topped up, or their usage was reset): pacing ends now. A hard pause never does. */
  resumeFullSpeed(): UsageView {
    const now = Date.now();
    const refused = resumeRefusal({ now, pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil });
    if (refused) throw new HttpError(409, refused);
    this.endPacing('⏩ You resumed full speed: new issues start as usual again. If Claude turns a session away at the limit, the office still pauses until it resets.');
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
      if (this.usageChoice() !== 'full') this.state.usageWaiver = null; // a simulated warning paces even after Resume full speed; "Keep full speed" is respected
      this.paceForWarning(usage);
    }
    return this.usageNow();
  }

  /**
   * POST /api/accounts/:id/use-now, the chat's "Use API key" when every account is out (#248): that paused account is
   * resumed and the pause lifted, so rotation carries on there (and the CEO's waiting job runs).
   */
  useAccountNow(id: string) {
    const view = this.accounts.update(id, { enabled: true });
    if (this.limited() && this.accounts.rotation().on) {
      this.pausedUntil = 0;
      this.pausedAllOut = false;
      this.postMessage('office', `▶ ${this.accounts.label(id)} is on: new work starts on it now${this.accounts.list().find((a) => a.id === id)?.kind === 'api-key' ? ', billed per token' : ''}.`);
      this.emitUsage();
      setTimeout(() => this.schedule(), 200);
    }
    return view;
  }

  /** May work of this kind start now, as far as Claude's usage goes? */
  protected mayStart(kind: WorkKind) {
    return mayStart(kind, { now: Date.now(), pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil, running: this.running(), pacingSessions: this.state.settings.pacingSessions });
  }

  protected usageNow() {
    const now = Date.now();
    return usageView({ now, pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil }, this.lastWarning, fullSpeedByChoice(this.usageChoice(), this.state.usageWaiver ?? null, this.lastWarning, now));
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
      if (usage.state === 'paused') this.notice({ kind: 'usage', title: `${this.limitWho()} reached its usage limit`, text: `The office starts no new work until ${until}; running sessions carry on.` }, { event: 'usage' });
      else this.notice({ kind: 'usage', title: 'Pacing new work', text: `Claude warned that usage is high, so new issues start slowly until ${until}.` }, { event: 'usage' });
    }
  }

  /** Each usage bar's floor shares of the office's spend in its window, from the cost ledger (#334). */
  private usageSharesNow() {
    return usageShares(this.spend.ledger.all(), this.state.claudeUsage, Date.now());
  }

  /** Claude's readings for the usage meter, with their floor shares. */
  protected claudeUsageEvent(check = this.usageCheck): ServerEvent {
    const shares = this.usageSharesNow();
    this.sentShares = sharesSignature(shares);
    return { type: 'claudeUsage', readings: this.state.claudeUsage, check, shares };
  }

  /** A session's cost was booked: within a minute, the meter's shares if their rows or percentages changed (one pending at most). */
  protected usageSharesSoon() {
    if (this.sharesTimer) return;
    this.sharesTimer = setTimeout(() => {
      this.sharesTimer = null;
      if (sharesSignature(this.usageSharesNow()) !== this.sentShares) this.broadcast(this.claudeUsageEvent());
    }, SHARES_MS);
    this.sharesTimer.unref?.();
  }

  override snapshot(): WorldSnapshot {
    return { ...super.snapshot(), claudeUsageShares: this.usageSharesNow() };
  }

  /** Claude's latest usage readings from any session: kept and saved, and sent to the office at most every few seconds. */
  protected recordUsage(readings: UsageReading[]) {
    this.usageCheck = null; // a fresh reading answers for itself
    this.state.claudeUsage = mergeReadings(this.state.claudeUsage, readings);
    this.accounts.builtInReadings(); // readings with room end the built-in login's limit
    if (this.readingsTimer || !readingsChanged(this.shownReadings, this.state.claudeUsage)) return;
    this.readingsTimer = setTimeout(() => {
      this.readingsTimer = null;
      this.shownReadings = this.state.claudeUsage;
      this.broadcast(this.claudeUsageEvent());
      this.accounts.emit(); // the built-in login's card and meter row
      this.save();
    }, READINGS_MS);
    this.readingsTimer.unref?.();
  }

  /** No session has given a reading for a while: read Claude's usage directly, quietly backing off when that fails (#89). */
  protected pollUsage() {
    const now = Date.now();
    const newest = Math.max(0, ...this.state.claudeUsage.map((r) => r.at));
    if (this.usagePolling || !pollDue(newest, this.usagePoll, now)) return;
    this.usagePolling = true;
    void this.backend
      .usageCheck()
      .catch((): UsageCheck => ({ error: 'failed' }))
      .then((res) => {
        this.usagePoll = afterPoll(this.usagePoll, 'readings' in res, Date.now());
        if ('error' in res) {
          if (res.error === this.usageCheck) return; // quiet: no repeats, nothing logged
          this.usageCheck = res.error;
          this.broadcast(this.claudeUsageEvent(res.error));
          return;
        }
        if (res.noFiveHour) this.state.claudeUsage = this.state.claudeUsage.filter((r) => r.type !== 'five_hour'); // no 5-hour window on this plan
        this.recordUsage(res.readings); // clears the failed check
        // A full 5-hour or weekly window on the built-in login pauses new work, as a session hitting the limit would,
        // unless rotation has another Claude account to start it on: then only that login is out (its status already
        // says limited, from these readings). With every account out, the pause lasts until the first one is back.
        const full = res.readings.find((r) => (r.type === 'five_hour' || r.type === 'seven_day') && r.pct >= 100 && r.resetsAt && r.resetsAt > Date.now());
        if (full && !this.accounts.hasFree('claude')) this.pauseForLimit(this.accounts.rotation().on ? (this.accounts.firstBack('claude') ?? full.resetsAt) : full.resetsAt);
      })
      .finally(() => (this.usagePolling = false));
  }

  /** Pacing and pauses run out on their own: say so when pacing ends. */
  protected tickUsage() {
    if (this.state.usageWaiver && Date.now() >= this.state.usageWaiver.until) {
      this.state.usageWaiver = null; // its window ended: the next warning paces again
      this.save();
    }
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
    this.liftPauseWhenFree();
    this.tickUsage();
    this.pollUsage();
    this.progressTick();
    const draining = this.officeUpdateTick(); // draining for the office's own update: only the CEO's chat starts
    if (!draining) this.applyTeamChanges(); // before handing out work, so agents on their way out get none
    if (!draining && !this.limited()) {
      this.maybeHeartbeat();
      this.maybeFollowup();
      this.maybeChanges();
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
    // The manager's and the CEO's picks go first (#265), then finished work, consults and new issues.
    const starts = { queued: (r: PersistedRepo) => this.startQueuedWork(r), pipeline: (r: PersistedRepo) => this.startPipelineWork(r), consult: (r: PersistedRepo) => this.startConsultWork(r), issue: (r: PersistedRepo) => this.startIssueWork(r) };
    for (const start of WORK_PHASES.map((p) => starts[p])) {
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

  // ---------- the CEO's waits, questions and consults (#28) ----------

  protected holds = new CeoHolds(() => this.emitCeo());
  protected ceoWaited = false; // the current CEO job waited (the ledger's ceo-wait)
  protected consultAnswers = new Map<string, string | null>(); // consults the CEO waits on: their answer once in

  /** End the CEO's waits and questions, and consults no session waits for any more. */
  protected cancelHolds(why: string) {
    if (!this.holds.waiting()) return;
    this.holds.cancel(why);
    this.consults = this.consults.filter((c) => c.runningOn);
  }

  /** A free agent on this floor takes the next consult (nextConsult). True: one started. */
  protected startConsultWork(repo: PersistedRepo): boolean {
    const free = this.available(repo).filter((a) => a.host !== 'box' && !this.agentRt.get(a.id)?.session);
    const pick = nextConsult(this.consults, repo.id, free.map((a) => a.id), this.state.settings.ceoAwake.consultMax, () => this.health.admit('consult', repo.id));
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
    handle = this.startOnAccount(a,
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
