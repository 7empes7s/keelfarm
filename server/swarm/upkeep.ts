// Keeping the office healthy and lively: idle desks, the watchdog and doctor, progress, ping-pong.
import type { Backend } from '../backend.ts';
import { issueOpen, nameList, pullNow } from '../closeCleanup.ts';
import { HttpError } from '../httpError.ts';
import { restartMessage, workState, type WorkState } from '../reconcile.ts';
import {
  diagnose,
  finding,
  forget,
  NUDGE_WAIT_MS,
  nudgeText,
  QUIET_MS,
  triage,
  unclosedIssues,
  type Problem,
  type Remedy,
  type WatchAgent,
  type WatchMemory,
} from '../watchdog.ts';
import { PREVIEW_SLUG } from '../previewRunner.ts';
import { pruneQaShots } from '../qaShots.ts';
import { previewSettings } from '../prTheatre.ts';
import { desksToTrim, formatBytes, freedMessage, idleSince } from '../deskTrim.ts';
import { machineName } from '../machines.ts';
import { burstFloor, burstLeavers, hybridPlace, localRoom } from '../hybrid.ts';
import { recordBurst } from '../metrics.ts';
import type { DeskTrim } from '../workspace.ts';
import {
  addTenure,
  apply as applyLedger,
  buy as buyDecor,
  grant as grantCoins,
  place as placeDecor,
  progressView,
  type CommandResult,
  type Effects,
  type LedgerEvent,
  workOf,
} from '../ledger.ts';
import { careerTimeline, type TimelineView } from '../../shared/careerTimeline.ts';
import { followupEvents } from '../../shared/followups.ts';
import { achievementDef, type ProgressView } from '../../shared/progress.ts';
import { parsePongResult, PONG_PLAYER, recordGame } from '../../shared/pong.ts';
import type { CostRecord, CostSession } from '../../shared/costs.ts';
import type { DoctorFinding, DoctorFix, MachineHost, PullInfo } from '../../shared/types.ts';
import { type PersistedRepo, type PersistedAgent, BUSY, FULL_HOUSE, oneLine, QA_SHOTS_DIR } from './model.ts';
import { LAB_SLUG } from '../testLabRunner.ts';
import { slugify } from './flavour.ts';
import { SwarmCeo } from './ceoJobs.ts';

export abstract class SwarmUpkeep extends SwarmCeo {
  // ---------- idle desks ----------

  protected bootAt = Date.now();
  protected deskWatch = new Map<string, { busyAt: number | null; trimmedAt: number | null }>(); // desk → what the sweeps saw
  protected trimming = false;

  /** An agent's desk is in use: a task (preparing, working, testing or fixing) or a live CLI in their terminal. Hands off a fired agent's. */
  protected deskBusy(a: PersistedAgent) {
    const rt = this.agentRt.get(a.id);
    return !rt || !this.state.agents.includes(a) || BUSY.includes(a.status) || !!rt.session || !!rt.terminal?.live;
  }

  /**
   * Free disk space on desks idle longer than settings.trimIdleDesksMin: every agent's desk, and each floor's preview
   * worktree while no preview runs. One desk at a time, once per idle stretch; one phone message per sweep that freed anything.
   */
  protected async trimIdleDesks() {
    const min = this.state.settings.trimIdleDesksMin;
    if (!min || this.trimming) return;
    this.trimming = true;
    try {
      const now = Date.now();
      type Desk = { key: string; name: string; endedAt: number | null; busy: () => boolean; trim: (stillIdle: () => boolean) => Promise<DeskTrim | null> };
      const desks: Desk[] = [];
      for (const a of this.state.agents) {
        const repo = this.state.repos.find((r) => r.id === a.repoId);
        if (!repo) continue;
        const name = `${a.name}'s desk on ${repo.fullName}`;
        const trim = a.machine ? (idle: () => boolean) => this.machinesFor(a).trimDesk(a.machine!, repo.fullName, idle) : (idle: () => boolean) => this.backend.trimDesk(repo.fullName, this.agentSlug(a), idle);
        desks.push({ key: a.id, name, endedAt: a.endedAt, busy: () => this.deskBusy(a), trim });
      }
      for (const repo of this.state.repos) {
        const busy = () => !this.state.repos.includes(repo) || this.previews.active(repo);
        desks.push({ key: `preview:${repo.id}`, name: `the preview desk of ${repo.fullName}`, endedAt: null, busy, trim: (idle) => this.backend.trimDesk(repo.fullName, PREVIEW_SLUG, idle) });
      }
      for (const key of this.deskWatch.keys()) if (!desks.some((d) => d.key === key)) this.deskWatch.delete(key);
      const seen = desks.map((d) => {
        const w = this.deskWatch.get(d.key) ?? { busyAt: null, trimmedAt: null };
        this.deskWatch.set(d.key, w);
        const busy = d.busy();
        if (busy) w.busyAt = now;
        return { key: d.key, busy, idleSince: idleSince(d.endedAt, w.busyAt, this.bootAt), trimmedAt: w.trimmedAt };
      });
      const due = new Set(desksToTrim(seen, min, now));
      let freed = 0;
      let count = 0;
      for (const d of desks.filter((x) => due.has(x.key))) {
        // Asked again inside the repo lock: a task that started since is never pulled out from under its agent.
        const result = await d.trim(() => !d.busy()).catch((err) => {
          console.warn(`could not trim ${d.name}:`, oneLine(err));
          return undefined;
        });
        if (result === undefined) continue;
        // Folders Windows still had locked are tried again at the next sweep.
        if (!result?.skipped.length) this.deskWatch.get(d.key)!.trimmedAt = Date.now();
        if (!result?.freed) continue;
        freed += result.freed;
        count++;
        const locked = result.skipped.length ? `; still locked: ${result.skipped.join(', ')}` : '';
        console.log(`trimmed ${d.name}: freed ${formatBytes(result.freed)} (${result.removed.join(', ')})${locked}`);
      }
      if (count) this.postMessage('office', freedMessage(freed, count));
    } finally {
      this.trimming = false;
    }
  }
  /** Settings → the previews' chip window and main idle stop, clamped (#204). */
  protected previewSettings(patch: Partial<Record<'previewRecentHours' | 'mainPreviewIdleMin', unknown>>) {
    Object.assign(this.state.settings, previewSettings(this.state.settings, patch));
  }

  /**
   * Nothing outlives its session (#227): stop processes in machines' worktrees that no live session owns, and at boot
   * in the lab's checkouts. The office's processes and everything under them are left alone.
   */
  protected async sweepOrphans(boot = false) {
    const live = this.state.agents.filter((a) => a.machine && (BUSY.includes(a.status) || !!this.agentRt.get(a.id)?.session)).map((a) => a.machine!);
    const idle = boot ? this.state.repos.map((r) => this.backend.deskDir(r.fullName, LAB_SLUG)) : [];
    for (const line of await this.backend.machines.orphans(live, idle).catch(() => [])) console.log(`sweep: stopped ${line}, left by no live session`);
  }

  /** Previews' upkeep (#204): leftover PR slot desks go, QA shots of PRs no longer in QA go, and the stats say when. */
  protected async cleanPreviews() {
    const diskBytes = await this.previews.cleanLeftovers(this.state.repos).catch(() => null);
    await pruneQaShots(QA_SHOTS_DIR, new Set(this.state.qa.map((q) => `${q.repoId}#${q.prNumber}`))).catch(() => undefined);
    this.setPreviewStats({ diskBytes, cleanedAt: Date.now() });
  }

  protected watch: WatchMemory = { remedied: new Map(), nudged: new Map() };
  protected doctor: DoctorFinding[] = [];
  protected ignored = new Set<string>(); // findings the manager ignored, until they go away
  protected lastDoctor = '';
  protected stalled = new Set<string>(); // the demo's stuck sessions

  /**
   * A session about to start in a desk folder that's gone: the desk is set up again first, on the same branch (at the
   * PR's head when there is one). Null when it couldn't be (prepare() said why) or the agent was stopped meanwhile.
   */
  protected async restoreDesk(a: PersistedAgent, repo: PersistedRepo): Promise<string | null> {
    a.status = 'preparing';
    this.appendLog(a, [{ kind: 'system', text: 'Their desk folder is gone, so it is set up again first.' }]);
    this.emitAgent(a);
    const desk = await this.prepare(a, repo, { pr: a.prNumber ?? undefined }, a.branch ?? `swarm/desk-${this.agentSlug(a)}`);
    return desk?.cwd ?? null;
  }

  /** When an agent's session last showed signs of life. Claude Code reports every step; other CLIs may only report a turn's end, so their terminal output counts too. */
  protected activeAt(a: PersistedAgent) {
    const term = this.agentRt.get(a.id)?.terminal;
    const cli = a.sessionCli ?? (a.cli || this.state.settings.defaultCli);
    return Math.max(this.activity.get(a.id) ?? a.startedAt ?? Date.now(), cli !== 'claude' && term ? term.outputAt : 0);
  }

  /** The agent's task as the office knows it now (closeCleanup.ts). */
  protected workOf(a: PersistedAgent): WorkState {
    const rt = this.repoRt.get(a.repoId);
    if (!rt || !a.task) return 'unknown';
    const f = this.floorState(rt);
    const issue = a.task === 'issue' && a.issueNumber != null ? issueOpen(a.issueNumber, f) : null;
    return workState(issue === null ? null : issue ? 'OPEN' : 'CLOSED', a.prNumber != null ? (pullNow(a.prNumber, f)?.state ?? null) : null);
  }

  /** Every minute: find what's stuck (watchdog.ts), heal what can safely be healed, and list the rest for the doctor. heal false: only list. */
  protected watchdogTick(heal = true) {
    const now = Date.now();
    forget(this.watch, now);
    // A cloud agent whose Box is being set up, that the office can't reach right now or that waits to be signed in isn't stuck: left be.
    const away = (a: PersistedAgent) => a.host === 'box' && (!!a.needsSignIn || ['creating', 'setting-up', 'disconnected'].includes(this.boxMachines.stateOf(a.machine ?? machineName(a.id))));
    const agents: WatchAgent[] = this.state.agents.filter((a) => !away(a)).map((a) => ({
      id: a.id,
      name: a.name,
      repoId: a.repoId,
      role: a.role,
      status: a.status,
      task: a.task,
      issueNumber: a.issueNumber,
      prNumber: a.prNumber,
      startedAt: a.startedAt,
      activeAt: this.activeAt(a),
      work: this.workOf(a),
    }));
    const unclosed = this.state.repos.flatMap((r) => {
      const rt = this.repoRt.get(r.id);
      return rt?.lastSync ? unclosedIssues(r.id, rt.issues.map((i) => i.number), rt.pulls) : [];
    });
    const { auto, doctor } = triage(diagnose(agents, this.state.qa, unclosed, now), this.watch, now);
    if (heal) {
      const done = auto.map(({ problem, remedy }) => this.remedy(problem, remedy, now)).filter((t): t is string => !!t);
      if (done.length) {
        this.postMessage('office', `🩺 The watchdog ${nameList(done)}.`);
        setTimeout(() => this.schedule(), 200);
      }
    }
    const agent = (id: string | null) => this.state.agents.find((x) => x.id === id);
    this.doctor = doctor.map((p) => finding(p, (id) => agent(id)?.name ?? null, agent(p.agentId) ? this.workOf(agent(p.agentId)!) : null, now));
    for (const id of this.ignored) if (!this.doctor.some((f) => f.id === id)) this.ignored.delete(id);
    this.emitDoctor();
  }

  /** Apply an automatic remedy. Returns what to tell the manager, or null. */
  protected remedy(p: Problem, remedy: Remedy, now: number): string | null {
    const a = p.agentId ? this.state.agents.find((x) => x.id === p.agentId) : undefined;
    const rec = p.prNumber != null ? this.state.qa.find((q) => q.repoId === p.repoId && q.prNumber === p.prNumber) : undefined;
    const what = p.prNumber != null ? `PR #${p.prNumber}` : `#${p.issueNumber}`;
    const mins = Math.round((now - p.since) / 60_000);
    if (remedy === 'nudge') {
      const session = a && this.agentRt.get(a.id)?.session;
      if (!a || !session) return null;
      this.watch.nudged.set(p.key, now);
      this.appendLog(a, [{ kind: 'system', text: `🩺 No sign of life for ${mins} minutes: the office nudged them.` }]);
      session.send(nudgeText(now - p.since));
      return null;
    }
    this.watch.remedied.set(p.key, now);
    if (remedy === 'requeue' && a) {
      if (this.agentRt.get(a.id)?.session) this.spend.watchdogStopped(a.id);
      const repo = this.state.repos.find((r) => r.id === a.repoId);
      this.followup(followupEvents.stalled(a, what, mins, repo?.id, repo && this.floorName(repo)));
      this.requeue(a, `the watchdog put ${what} back in line after ${mins} ${p.kind === 'quiet' ? 'quiet minutes and a nudge' : 'minutes setting up a desk'}`);
      return `put ${a.name}'s ${what} back in line (${p.kind === 'quiet' ? `quiet for ${mins} minutes, even after a nudge` : `stuck setting up a desk for ${mins} minutes`})`;
    }
    if (remedy === 'clear' && a) {
      this.requeue(a, `${what} is already ${this.workOf(a) === 'merged' ? 'merged' : 'closed'}`);
      return `cleared ${a.name}'s desk (${what} was finished)`;
    }
    if (remedy === 'retry-qa' && rec) {
      this.setQa(rec, { status: 'queued', qaAgentId: null });
      return `sent PR #${rec.prNumber} back to QA (nobody was testing it)`;
    }
    if (remedy === 'refix' && rec) {
      this.setQa(rec, { status: 'failed' });
      return `put PR #${rec.prNumber}'s fix back in line (nobody was on it)`;
    }
    return null;
  }

  /** Stop the agent if they're busy and put their work back in line, without a strike: an issue back on the board, a QA run or fix back in its PR's queue. */
  protected requeue(a: PersistedAgent, why: string) {
    for (const q of this.state.qa) {
      if (q.qaAgentId === a.id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === a.id && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    if (BUSY.includes(a.status)) {
      // A desk stuck setting up: whatever hangs in it (an install, a checkout) is stopped, so prepare() gives up.
      const repo = this.state.repos.find((r) => r.id === a.repoId);
      if (repo && a.status === 'preparing') void this.releaseDesk(a, repo).catch(() => undefined);
      this.stopForClosure(a, why);
    } else this.dropTask(a, `↺ ${why[0].toUpperCase()}${why.slice(1)}. Cleared desk.`);
    this.save();
  }

  protected doctorView(): DoctorFinding[] {
    return this.doctor.filter((f) => !this.ignored.has(f.id));
  }

  protected emitDoctor() {
    const doctor = this.doctorView();
    const key = JSON.stringify(doctor);
    if (key === this.lastDoctor) return;
    this.lastDoctor = key;
    this.broadcast({ type: 'doctor', doctor });
  }

  /** The doctor's one-click fix (POST /api/doctor/fix): the console's own actions, for the finding they were offered on. */
  async doctorFix(id: unknown, fix: unknown) {
    const f = this.doctor.find((x) => x.id === id);
    if (!f) throw new HttpError(404, 'That finding is gone: the office may have sorted it out already.');
    if (!f.fixes.includes(fix as DoctorFix)) throw new HttpError(400, `"${String(fix)}" doesn't fix this one. Try ${f.fixes.join(' or ')}.`);
    const a = f.agentId ? this.state.agents.find((x) => x.id === f.agentId) : undefined;
    const rec = f.prNumber != null ? this.state.qa.find((q) => q.repoId === f.repoId && q.prNumber === f.prNumber) : undefined;
    const need = <T>(x: T | undefined, what: string): T => {
      if (!x) throw new HttpError(404, `${what} is gone: the office may have sorted it out already.`);
      return x;
    };
    if (fix === 'stop') this.stopAgent(need(a, 'That agent').id);
    else if (fix === 'clear') this.resetAgent(need(a, 'That agent').id);
    else if (fix === 'requeue') this.requeue(need(a, 'That agent'), 'the manager put the work back in line from the office doctor');
    else if (fix === 'retry-qa') {
      this.clearPrepStrikes(f.repoId, f.prNumber!);
      this.setQa(need(rec, `PR #${f.prNumber}'s QA record`), { status: 'queued', qaAgentId: null });
    } else if (fix === 'send-back') {
      const r = need(rec, `PR #${f.prNumber}'s QA record`);
      // A PR left "testing" or "fixing" with nobody on it goes back to a developer as it is; otherwise it's the console's Send back.
      if (r.status === 'testing' || r.status === 'fixing') this.setQa(r, { status: 'failed', qaAgentId: null });
      else await this.sendBackToDev(f.repoId, f.prNumber!);
    } else if (fix === 'close-issue') await this.closeIssueByManager(f.repoId, f.issueNumber!, f.prNumber ?? undefined);
    this.watchdogTick(false);
    setTimeout(() => this.schedule(), 200);
    return this.doctorView();
  }

  /** "Ignore" on a finding: hidden until it goes away (and shows again if it comes back). */
  doctorIgnore(id: unknown) {
    if (!this.doctor.some((f) => f.id === id)) throw new HttpError(404, 'That finding is gone already.');
    this.ignored.add(String(id));
    this.emitDoctor();
    return this.doctorView();
  }

  /**
   * The demo's scenarios (POST /api/doctor/demo). restart: an office restart that finds finished work and desks gone ·
   * stuck: a session goes quiet for 20 minutes · later: 10 more minutes pass for the stuck ones · unclosed: an issue
   * a merged PR resolved stays open · check: the watchdog looks now.
   */
  async demoDoctor(action: unknown): Promise<{ text: string; doctor: DoctorFinding[] }> {
    const dd = this.backend.demoDoctor;
    if (!dd) throw new HttpError(404, 'The office doctor can only be tried out in the demo office.');
    let text = 'The watchdog looked.';
    if (action === 'restart') text = await this.demoRestart(dd);
    else if (action === 'stuck') {
      const a = this.state.agents.find((x) => x.role !== 'ceo' && x.status === 'working' && !this.stalled.has(x.id) && this.agentRt.get(x.id)?.session && dd.stall(x.id));
      if (!a) throw new HttpError(409, 'Nobody is working right now. Wait for someone to start an issue, then try again.');
      this.stalled.add(a.id);
      this.activity.set(a.id, Date.now() - QUIET_MS - 60_000);
      this.watchdogTick();
      text = `${a.name} went quiet 21 minutes ago (pretend), and the watchdog nudged them.`;
    } else if (action === 'later') {
      const skip = NUDGE_WAIT_MS + 60_000;
      for (const id of this.stalled) {
        if (!this.state.agents.some((a) => a.id === id && a.status === 'working')) this.stalled.delete(id);
        else this.activity.set(id, (this.activity.get(id) ?? Date.now()) - skip);
      }
      for (const [key, at] of this.watch.nudged) if ([...this.stalled].some((id) => key.includes(`:${id}:`))) this.watch.nudged.set(key, at - skip);
      this.watchdogTick();
      text = 'Eleven more minutes passed for the stuck sessions.';
    } else if (action === 'unclosed') {
      const repo = this.state.repos[0];
      const made = repo && dd.unclosedMerge(repo.fullName, 15 * 60_000);
      if (!made) throw new HttpError(409, 'The first floor has no open issue to leave open.');
      await this.syncRepo(repo.id);
      this.watchdogTick();
      text = `PR #${made.pr} merged 15 minutes ago (pretend), but issue #${made.issue} is still open.`;
    } else if (action === 'check') this.watchdogTick();
    else throw new HttpError(400, 'action must be "restart", "stuck", "later", "unclosed" or "check"');
    return { text, doctor: this.doctorView() };
  }

  /**
   * The demo's restart, in place: of the people working, one's CLI keeps going (followed again), the others' sessions
   * end as if the office stopped and their desks are gone, and half of those finished their work on GitHub meanwhile.
   * Then the office reconciles as it does after a real restart.
   */
  protected async demoRestart(dd: NonNullable<Backend['demoDoctor']>): Promise<string> {
    if (this.state.agents.some((a) => a.status === 'preparing')) throw new HttpError(409, 'Someone is still setting up a desk. Try again in a moment.');
    const busy = this.state.agents.filter((a) => a.role !== 'ceo' && a.status === 'working' && a.task && this.agentRt.get(a.id)?.session);
    if (busy.length < 2) throw new HttpError(409, 'Wait until at least two people are working, then try again.');
    const [keep, ...rest] = busy;
    rest.forEach((a, i) => {
      const repo = this.repo(a.repoId);
      dd.dropDesk(this.deskOf(a, repo));
      if (i % 2 === 0) {
        if (a.task === 'issue' && !a.prNumber && a.issueNumber) dd.finishQuietly(repo.fullName, 'issue', a.issueNumber);
        else if (a.prNumber) dd.finishQuietly(repo.fullName, 'pr', a.prNumber);
      }
      const rt = this.agentRt.get(a.id)!;
      const session = rt.session;
      rt.session = null;
      rt.currentTool = null;
      this.silenced.add(a.id);
      session?.stop();
      this.silenced.delete(a.id);
    });
    const restart = await this.reconcileRestart((a) => a === keep); // keep's session never stopped: nothing to reattach
    this.finishRestart(restart);
    setTimeout(() => this.schedule(), 500);
    return restartMessage(restart.counts) ?? 'Restarted: nothing to do.';
  }

  // ---------- progress: coins, decorations, achievements and careers (#210, #226) ----------

  /** Tell the ledger something happened; send on whatever it changed. emitAgents false: the caller emits them. */
  protected ledger(ev: LedgerEvent, emitAgents = true) {
    this.fanout(applyLedger(this.state.progress, ev), emitAgents);
  }

  /** A finished session into its agent's career (#205): what they ran, the weekly totals, time working and waste. */
  protected careerWork(line: CostSession) {
    const a = this.state.agents.find((x) => x.id === line.agentId);
    if (!a || a.role === 'ceo') return;
    this.ledger({ kind: 'rig', agentId: a.id, cli: a.cli || this.state.settings.defaultCli, model: line.model, effort: line.effort, at: line.at }, false);
    this.ledger({ kind: 'work', agentId: a.id, ...workOf(line) });
  }

  protected fanout(fx: Effects, emitAgents = true) {
    if (!fx.changed) return;
    if (fx.reward) this.broadcast({ type: 'reward', reward: fx.reward });
    if (emitAgents) {
      for (const id of fx.careers) {
        const a = this.state.agents.find((x) => x.id === id);
        if (a) this.emitAgent(a);
      }
    }
    for (const u of fx.unlocked) {
      const def = achievementDef(u.id);
      if (!def) continue;
      this.postMessage('office', `🏆 Achievement unlocked: ${def.icon} ${def.name}. ${def.blurb} (${u.detail}). Its trophy is on the lobby's shelf.`);
      this.toast('success', `🏆 Achievement unlocked: ${def.icon} ${def.name}`);
    }
    if (fx.progress) this.broadcast({ type: 'progress', progress: this.progressView() });
    this.save();
  }

  /** GET /api/agents/:id/timeline (#205): what they did over the last month, built when their profile opens. */
  careerTimeline(id: string): TimelineView {
    const a = this.agent(id);
    return careerTimeline({ entries: this.history.all(), costs: this.spend.ledger.all(), agent: a, rehired: this.state.progress.careers[a.id]?.rehired ?? [], now: Date.now() });
  }

  /** A fresh demo office's made-up cost ledger, the session history it makes (timelines) and someone let go (#205). */
  protected seedCareerPast(records: CostRecord[]) {
    Object.assign(this.state.progress.past, this.backend.seedPastCareers?.(Date.now()));
    if (!this.history.all().length) void this.history.seed(this.backend.seedHistory?.(records, this.state.repos, Date.now()) ?? []);
    return this.spend.ledger.replace(records);
  }

  protected progressView(): ProgressView {
    return progressView(this.state.progress, this.state.repos.map((r) => r.id));
  }

  /** Who wrote a PR, as far as the office knows: its QA record's author, the one holding it, or the one its branch is named after. */
  protected prAuthor(repo: PersistedRepo, pr: PullInfo): string | null {
    const devs = this.state.agents.filter((a) => a.repoId === repo.id && a.role !== 'ceo');
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === pr.number);
    if (rec?.devAgentId && devs.some((a) => a.id === rec.devAgentId)) return rec.devAgentId;
    const holder = devs.find((a) => a.task !== 'qa' && (a.prNumber === pr.number || a.branch === pr.headRefName));
    if (holder) return holder.id;
    const m = /^swarm\/issue-\d+-(.+)$/i.exec(pr.headRefName);
    return m ? (devs.find((a) => slugify(a.name) === m[1].toLowerCase())?.id ?? null) : null;
  }

  /** The scheduler's beat: a new day for the ledger, and a full house when everyone on a floor is busy at once. */
  protected progressTick() {
    const now = Date.now();
    this.ledger({ kind: 'tick', at: now });
    for (const r of this.state.repos) {
      const team = this.state.agents.filter((a) => a.repoId === r.id);
      if (team.length >= FULL_HOUSE && team.every((a) => BUSY.includes(a.status))) this.ledger({ kind: 'full-house', repoName: r.fullName, people: team.length, at: now });
    }
  }

  protected command(r: CommandResult): ProgressView {
    if ('error' in r) throw new HttpError(409, r.error);
    this.fanout(r.effects);
    return this.progressView();
  }

  /** The lobby kiosk's Buy: a decoration for a floor, paid with its coins. It waits in the floor's decor box. */
  buyDecoration(repoId: string, item: unknown): ProgressView {
    return this.command(buyDecor(this.state.progress, this.repo(repoId).id, item));
  }

  /** Put a decoration in one of a floor's slots, move it to another, or (slot null) back in the floor's decor box. */
  placeDecoration(repoId: string, body: { item?: unknown; slot?: unknown; from?: unknown }): ProgressView {
    const repo = this.repo(repoId);
    const spot = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'string' ? v : undefined);
    const slot = spot(body.slot);
    const from = spot(body.from);
    if (slot === undefined || from === undefined) throw new HttpError(400, 'slot and from are decoration spots (or null)');
    return this.command(placeDecor(this.state.progress, repo.id, repo.fullName, { item: body.item, slot, from }, Date.now()));
  }

  /** The player finished a coffee; `id` is the browser's own for it, so a retried report counts once. */
  drankCoffee(id: unknown) {
    if (typeof id !== 'string' || !/^[\w-]{4,80}$/.test(id)) throw new HttpError(400, 'A coffee needs an id');
    this.ledger({ kind: 'coffee', id, at: Date.now() });
    return { coffees: this.state.progress.coffees };
  }

  /** Demo only, for QA: coins for a floor (`coins`), or more time on the team (`tenure`, everyone without an agent id). */
  demoProgress(body: { action?: unknown; repoId?: unknown; coins?: unknown; agentId?: unknown; days?: unknown }): ProgressView {
    if (!this.backend.demo) throw new HttpError(403, 'Only the demo office hands out coins and tenure');
    if (body.action === 'coins') return this.command(grantCoins(this.state.progress, this.repo(String(body.repoId ?? '')).id, Number(body.coins)));
    if (body.action === 'tenure') {
      const agentId = typeof body.agentId === 'string' && body.agentId ? this.agent(body.agentId).id : undefined;
      return this.command(addTenure(this.state.progress, Number(body.days), agentId));
    }
    throw new HttpError(400, 'action is "coins" or "tenure"');
  }

  // ---------- Hybrid (#260, docs/cloud.md) ----------

  /** Why this computer has no room for one more agent (null: it has). */
  protected localRoomWhy() {
    const local = this.state.agents.filter((a) => a.role !== 'ceo' && a.host !== 'box').length;
    return localRoom({ fit: this.health.fit('build'), slotsFull: this.slotsFull(), sessionLimit: this.state.settings.sessionLimit, localAgents: local, localMax: this.state.settings.cloud.hybrid.localMax });
  }

  /**
   * Hybrid's place for a new agent (hostFor): this computer while it has room, else a Box (`boxWhy`: why not, null when
   * it can). With room in neither, `strict` (the manager or CEO hiring) says both reasons; otherwise they work here.
   */
  protected hybridHost(boxWhy: string | null, strict: boolean): MachineHost {
    const place = hybridPlace(this.localRoomWhy(), boxWhy);
    if (typeof place === 'string') return place;
    if (strict) throw new HttpError(409, place.refusal);
    return 'local';
  }

  /** On the scheduler's beat, in Hybrid: add a cloud agent while ready work waits for memory (burst), and let added ones go once idle. */
  protected hybridTick(now = Date.now()) {
    const cloud = this.state.settings.cloud;
    if (cloud.machineKind !== 'hybrid') return;
    const busy = (a: PersistedAgent) => !!a.task || BUSY.includes(a.status) || this.consulting(a) || !!this.signIns.get(a.id)?.held;
    const held = this.health.heldFloors();
    const demo = this.health.simulated; // the demo's Simulate low memory shows a burst within half a minute
    const starting = (a: PersistedAgent) => !!a.needsSignIn || ['none', 'creating', 'setting-up'].includes(this.boxMachines.stateOf(a.machine ?? machineName(a.id)));
    const agents = this.state.agents.map((a) => ({ id: a.id, burst: a.burst, busy: busy(a), starting: starting(a), endedAt: a.endedAt }));
    const room = !held && !this.localRoomWhy();
    const leaving = burstLeavers({ now, idleMs: demo ? 120_000 : cloud.hybrid.burstIdleMin * 60_000, localRoom: room, agents });
    for (const id of leaving) {
      const a = this.state.agents.find((x) => x.id === id)!;
      const why = room ? 'this computer has room again' : `idle for ${Math.round((now - Math.max(a.burst!, a.endedAt ?? 0)) / 60_000)} minutes`;
      try {
        this.fireAgent(id);
        this.postMessage('office', `☁️ ${a.name} left the cloud: ${why}. Their Box is deleted.`);
      } catch (err) {
        delete a.burst; // the floor's last agent stays, as one of the team
        console.warn('burst back', err);
      }
    }
    if (!cloud.hybrid.burst || !this.cloud.boxApi()) return;
    const floors = this.state.repos.map((r) => {
      const team = this.state.agents.filter((a) => a.repoId === r.id && a.role !== 'ceo');
      const free = team.filter((a) => this.isFree(a));
      const queued = this.state.qa.filter((q) => q.repoId === r.id && (q.status === 'queued' || q.status === 'failed')).length;
      const waiting = held?.floors.has(r.id) && free.some((a) => a.host !== 'box') ? (r.autoAssign ? this.readyIssues(r).length : 0) + queued : 0;
      return { repoId: r.id, team: team.length, max: this.state.settings.maxAgents, waiting, cloudFree: team.filter((a) => a.host === 'box' && !busy(a)).length };
    });
    const pick = burstFloor({ now, waitingSince: held?.since ?? null, afterMs: demo ? 20_000 : cloud.hybrid.burstAfterMin * 60_000, floors, bursting: this.state.agents.filter((a) => a.burst).length, burstMax: cloud.hybrid.burstMax, boxRoom: this.boxRoom() });
    if (!pick) return;
    const repo = this.repo(pick.repoId);
    try {
      const view = this.hireAgent(repo.id, { host: 'box', strict: true });
      const a = this.agent(view.id);
      a.burst = now;
      recordBurst(this.state.ops, repo.id, now);
      this.save();
      this.emitAgent(a);
      this.emitOps();
      const tasks = `${pick.waiting} task${pick.waiting === 1 ? '' : 's'} waiting`;
      this.postMessage('office', `☁️ Added ${a.name} in the cloud on floor ${repo.floor}: this computer is full, ${tasks}. They leave once idle.`);
      this.followup(followupEvents.burst(a, repo.id, this.floorName(repo), pick.waiting));
    } catch (err) {
      console.warn('burst hire', err);
    }
  }

  // ---------- ping-pong ----------

  /**
   * A ping-pong game finished on `repoId`'s floor (the client plays it): onto that floor's leaderboard it goes.
   * `players` are 'player' (the manager) or agents on the floor, `score` their points in the same order.
   */
  recordPong(repoId: string, body: unknown) {
    this.repo(repoId);
    const game = parsePongResult(body);
    if ('error' in game) throw new HttpError(400, game.error);
    const [a, b] = game.players.map((id) => {
      if (id === PONG_PLAYER) return { id, name: this.state.settings.managerName.trim() || 'Manager' };
      const agent = this.state.agents.find((x) => x.id === id && x.repoId === repoId);
      if (!agent) throw new HttpError(400, `${id} doesn't work on this floor`);
      return { id, name: agent.name };
    });
    const board = recordGame(this.state.pong[repoId] ?? [], { players: [a, b], score: game.score, at: Date.now() });
    this.state.pong[repoId] = board;
    this.broadcast({ type: 'pong', repoId, board });
    this.save();
    return board;
  }
}
