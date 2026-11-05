// `Swarm`, the orchestrator: the façade index.ts, ceo.ts and the tests use. Its parts are layers under server/swarm/,
// each extending the one before (CLAUDE.md, "Where things live"); this file is the top one.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Backend } from './backend.ts';
import type { SessionResult } from './agentRunner.ts';
import type { BoxCliRecord } from './boxCli.ts';
import type { ReconnectedCli } from './cliRunner.ts';
import { DESK_SWEEP_INTERVAL_MS, SCHEDULER_INTERVAL_MS, STATE_FILE, SYNC_INTERVAL_MS } from './config.ts';
import {
  askedFor,
  ceoJobPrompt,
  ceoSystemPrompt,
  checkCloseIssue,
  createOfficeTools,
  floorCapacity,
  IssueCap,
  issueRefusal,
  jobLabel,
  MANDATE_NOT_ASKED,
  planDependencies,
  prDiffText,
  agentLogText,
  qaReportText,
  AGENT_LOG_MAX as AGENT_LOG_MAX_LINES,
  plannedSize,
  scalePlan,
  type CeoJob,
  type OfficeTools,
  type TeamNow,
} from './ceo.ts';
import { issueOpen, nameList, pullNow } from './closeCleanup.ts';
import { HttpError } from './httpError.ts';
import { issuesResolvedBy } from './issueClaims.ts';
import { failedRunIds } from './mergeGate.ts';
import { orphanedQa } from './qaOrphans.ts';
import { catchUp, PR_LIMITS_VERSION } from './prOwnership.ts';
import { followKeptCli, resumeNote, resumesAfterRestart } from './restartRecovery.ts';
import {
  reconcileStep,
  restartMessage,
  workState,
  type ReconcileStep,
  type RestartCounts,
  type WorkState,
} from './reconcile.ts';
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
} from './watchdog.ts';
import { checkTriageTarget, triageStep, type TriagePr } from './triage.ts';
import { parsePreviewPatch } from './previews.ts';
import { PREVIEW_SLUG } from './previewRunner.ts';
import { pruneQaShots, qaShotFile, qaShotsDir } from './qaShots.ts';
import { mergeReadings, readingsLabel } from '../shared/usage.ts';
import { clampPacingSessions, usageLabel } from './pacing.ts';
import { loadHistory, recordCost } from './metrics.ts';
import { clampTrimIdleMin, desksToTrim, formatBytes, freedMessage, idleSince, TRIM_SWEEP_MS } from './deskTrim.ts';
import { cliLabel, isCli } from './clis.ts';
import { machineName } from './machines.ts';
import type { DeskTrim } from './workspace.ts';
import { floorSpend, taskEfforts } from './costLedger.ts';
import { resolveEffort, type TaskKind } from '../shared/costs.ts';
import {
  addTenure,
  apply as applyLedger,
  buy as buyDecor,
  grant as grantCoins,
  loadLedger,
  place as placeDecor,
  progressView,
  type CommandResult,
  type Effects,
  type LedgerEvent,
} from './ledger.ts';
import { DEFAULT_LISTEN, DEFAULT_VOICE, listenSettings, speaks, voiceSettings } from './voice.ts';
import { teamKeyboard, telegramChat } from './telegram.ts';
import { clip, plainText, stuckAgents, type TeamChange } from './notify.ts';
import { DEFAULT_NOTIFY, notifySettings, officeUrl } from '../shared/notify.ts';
import { cloudSettings, DEFAULT_CLOUD } from '../shared/cloud.ts';
import { cleanSwitches, DEFAULT_TOOL_SETTINGS, toolSettings } from '../shared/tooling.ts';
import { blockers } from '../shared/issues.ts';
import { legacyAgent, legacyRequest, redact as scrub } from '../shared/journal.ts';
import {
  addFollowup,
  DEFAULT_FOLLOWUPS,
  followupEvents,
  followupSettings,
  followupStep,
  followupWaiting,
  liveMandates,
  loadFollowups,
  mandateFor,
  mandateList,
  MAX_MANDATES,
  quietReply,
  takeFollowups,
  type FollowupEvent,
} from '../shared/followups.ts';
import { cleanStyle } from '../shared/looks.ts';
import { achievementDef, type ProgressView } from '../shared/progress.ts';
import { parsePongResult, PONG_PLAYER, recordGame } from '../shared/pong.ts';
import { DEFAULT_WEATHER, DEFAULT_WORLD_EVENTS, weatherSettings, worldEventSettings } from '../shared/outside.ts';
import { DEFAULT_THEME_SETTINGS, dueGreeting, themeSettings } from '../shared/themes.ts';
import { CEO_ID, DEFAULT_DOG_NAME, DEFAULT_MAX_AGENTS, FLOOR_SEATS, PLAYBOOK_MAX } from '../shared/types.ts';
import { forwardText, nextDelivery } from '../shared/chat.ts';
import { makeArtifacts, parseCeoMessage } from '../shared/chatParts.ts';
import { SWEEP_MS } from '../shared/files.ts';
import type { QuickPicks } from '../shared/used.ts';
import { quickPicks } from './ceoFiles.ts';
import type {
  AgentCli,
  AgentLook,
  AgentStatus,
  CeoInfo,
  CloudSettings,
  DoctorFinding,
  DoctorFix,
  EffortLevel,
  HireRequestView,
  MachineHost,
  PhoneMessage,
  PullInfo,
  ServerDelivery,
  SwarmSettings,
} from '../shared/types.ts';
import {
  type PersistedRepo,
  type PersistedAgent,
  type QaRecord,
  type Persisted,
  type Restart,
  DEFAULT_MODEL,
  EFFORTS,
  CEO_MODEL,
  CEO_EFFORT,
  CEO_NAME,
  CEO_DIR,
  MAX_ISSUES_PER_JOB,
  KEEP_MESSAGES,
  KEEP_DECIDED_REQUESTS,
  BUSY,
  FREE,
  FULL_HOUSE,
  OPS_TICK_MS,
  WATCHDOG_MS,
  oneLine,
  QA_SHOTS_DIR,
  TERMINAL_SAVE_MS,
  clampMaxAgents,
} from './swarm/model.ts';
import { SHIRTS, HAIR, SKIN, lookFor, LOOKS, pick, slugify } from './swarm/flavour.ts';
import { loadScreen } from './swarm/screens.ts';
import { SwarmUpdate } from './swarm/update.ts';

export { HttpError };

export class Swarm extends SwarmUpdate {
  /**
   * The CEO's office tools. Every session gets its own server: one can only be connected to one session at a time, so
   * a shared one left the next session connected but without any tools while an earlier session still held it.
   */
  protected officeTools(): OfficeTools {
    const acts = this.spend.acts;
    return createOfficeTools({
      companyStatus: () => this.companyStatus(),
      agentDetail: (a) => this.agentDetail(a),
      setFloorProfile: acts((a) => this.setFloorProfile(a)),
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
      agentLog: (a) => this.agentLog(a),
      qaReport: (a) => this.qaReport(a),
      worktreeFile: (a) => this.worktreeFile(a),
      prDiff: (a) => this.prDiff(a),
      sendTelegram: (a) => this.sendTelegram(a),
    });
  }

  // ---------- lifecycle ----------

  async init() {
    await this.files.load().catch((err) => console.warn('files: could not load the store', err));
    void this.files.sweep();
    try {
      const raw = await fs.readFile(STATE_FILE, 'utf8');
      const loaded = JSON.parse(raw) as Partial<Persisted>;
      this.state = {
        settings: { ...this.state.settings, ...loaded.settings },
        repos: (loaded.repos ?? []).map((r) => ({
          ...r,
          autoMerge: r.autoMerge ?? true,
          links: r.links ?? [],
          mission: r.mission ?? '',
          summary: r.summary ?? '',
          qaBrief: r.qaBrief ?? '',
          playbook: r.playbook ?? '',
          localPath: r.localPath ?? null,
          preview: { command: r.preview?.command ?? null, env: { ...r.preview?.env } },
        })),
        // Developers and QA testers became agents (docs/agents.md): testers keep their seats, now the east-wall desks.
        agents: (loaded.agents ?? []).map((raw) => legacyAgent<PersistedAgent>(raw)).map((a) => ({
          ...a,
          machine: a.machine ?? null,
          boxCli: a.host === 'box' ? (a.boxCli ?? null) : null,
          effort: a.effort ?? '',
          look: a.look ?? lookFor(a.name),
          style: cleanStyle(a.style),
          task: a.task ?? (a.issueNumber ? 'issue' : null),
          cli: isCli(a.cli) ? a.cli : '',
          sessionCli: a.sessionCli ?? (a.sessionId ? 'claude' : null),
          tools: cleanSwitches(a.tools),
        })),
        qa: (loaded.qa ?? []).map((q) => ({
          ...q,
          testedSha: q.testedSha ?? null,
          passedSha: q.passedSha ?? null,
          fixReason: q.fixReason ?? null,
          mergeFixes: q.mergeFixes ?? 0,
          retests: q.retests ?? 0,
          pendingSince: q.pendingSince ?? null,
          mergeRetryAt: q.mergeRetryAt ?? null,
          alerted: q.alerted ?? false,
          preQa: q.preQa ?? null,
          noChangeSha: q.noChangeSha ?? null,
          rerunSha: q.rerunSha ?? null,
          rerunAt: q.rerunAt ?? null,
          qaChecks: q.qaChecks ?? null,
          stuckWhy: q.stuckWhy ?? null,
          triages: q.triages ?? 0,
          escalated: q.escalated ?? q.status === 'needs-human', // stuck before triage existed: the manager was told
          mergeNote: null,
        })),
        requests: (loaded.requests ?? []).map((raw) => legacyRequest<HireRequestView>(raw)),
        ceo: { ...this.state.ceo, ...loaded.ceo, followups: loadFollowups(loaded.ceo?.followups) },
        messages: loaded.messages ?? [],
        phoneReadAt: loaded.phoneReadAt ?? 0,
        prLimits: loaded.prLimits ?? 1,
        ops: loadHistory(loaded.ops, Date.now()),
        held: loaded.held ?? [],
        progress: loadLedger(loaded.progress),
        pong: loaded.pong && typeof loaded.pong === 'object' ? loaded.pong : {},
        officeId: typeof loaded.officeId === 'string' && /^[a-z0-9]{6}$/.test(loaded.officeId) ? loaded.officeId : this.state.officeId,
        claudeUsage: Array.isArray(loaded.claudeUsage) ? mergeReadings([], loaded.claudeUsage.filter((r) => r && typeof r.type === 'string' && Number.isFinite(r.pct) && Number.isFinite(r.at))) : [],
      };
      for (const m of this.state.messages) this.messageSeq = Math.max(this.messageSeq, m.id + 1);
      if (!EFFORTS.includes(this.state.settings.defaultEffort)) this.state.settings.defaultEffort = 'medium';
      if (this.state.settings.runtime !== 'sdk') this.state.settings.runtime = 'terminal';
      if (!isCli(this.state.settings.defaultCli)) this.state.settings.defaultCli = 'claude';
      this.state.settings.trimIdleDesksMin = clampTrimIdleMin(this.state.settings.trimIdleDesksMin);
      if (!this.state.settings.defaultModel && this.state.settings.defaultCli === 'claude') this.state.settings.defaultModel = DEFAULT_MODEL;
      // "Max concurrent sessions" (default 4) became an optional session limit. The old default goes; a limit the manager chose stays.
      const old = this.state.settings as SwarmSettings & { maxConcurrent?: number; permissionMode?: string };
      if (old.maxConcurrent !== undefined) {
        if (loaded.settings?.sessionLimit === undefined) old.sessionLimit = old.maxConcurrent === 4 ? 0 : old.maxConcurrent;
        delete old.maxConcurrent;
      }
      delete old.permissionMode; // the office's rules are instructions now, not a permission mode
      // Hiring titled roles became team changes: the approval choice carries over, the team cap (an auto-approve limit) doesn't.
      const hiring = old as SwarmSettings & { hiring?: string; teamCap?: number };
      if (hiring.hiring !== undefined) {
        if (loaded.settings?.scaling === undefined) this.state.settings.scaling = hiring.hiring === 'auto' ? 'auto' : 'approve';
        // Teams hired before the limit existed stay whole: the CEO isn't asked to shrink them to fit a new default.
        const biggest = Math.max(0, ...this.state.repos.map((r) => this.state.agents.filter((a) => a.repoId === r.id).length));
        if (loaded.settings?.maxAgents === undefined) this.state.settings.maxAgents = Math.max(DEFAULT_MAX_AGENTS, biggest);
        delete hiring.hiring;
        delete hiring.teamCap;
      }
      if (this.state.settings.scaling !== 'auto') this.state.settings.scaling = 'approve';
      this.state.settings.maxAgents = clampMaxAgents(this.state.settings.maxAgents);
      this.state.settings.voice = voiceSettings(DEFAULT_VOICE, loaded.settings?.voice);
      this.state.settings.themes = themeSettings(DEFAULT_THEME_SETTINGS, loaded.settings?.themes);
      this.state.settings.weather = weatherSettings(DEFAULT_WEATHER, loaded.settings?.weather);
      this.state.settings.worldEvents = worldEventSettings(DEFAULT_WORLD_EVENTS, loaded.settings?.worldEvents);
      this.state.settings.listen = listenSettings(DEFAULT_LISTEN, loaded.settings?.listen);
      this.state.settings.notify = notifySettings(DEFAULT_NOTIFY, loaded.settings?.notify);
      this.state.settings.cloud = cloudSettings(DEFAULT_CLOUD, loaded.settings?.cloud);
      this.state.settings.ceoFollowups = followupSettings(DEFAULT_FOLLOWUPS, loaded.settings?.ceoFollowups);
      this.state.settings.ceoMandates = mandateList(loaded.settings?.ceoMandates);
      this.state.settings.tools = toolSettings(DEFAULT_TOOL_SETTINGS, loaded.settings?.tools);
      // Offices that were set up before the setup wizard existed skip it.
      if (loaded.settings && loaded.settings.setupDone === undefined && this.state.repos.length > 0) {
        Object.assign(this.state.settings, { setupDone: true, tutorialStep: -1 });
      }
    } catch {
      // first run
    }
    await this.voice.init();
    await this.weather.init();
    await this.notifier.init();
    await this.telegram.init();
    await this.cloud.init();
    if (this.state.settings.cloud.machineKind === 'box' && !this.cloud.boxApi()) this.state.settings.cloud.machineKind = 'local';
    for (const r of this.state.repos) if (r.localPath) this.backend.setLocalPath(r.fullName, r.localPath);
    const interrupted: PersistedAgent[] = [];
    for (const a of this.state.agents) {
      const tail = a.logTail ?? [];
      for (const l of tail) this.logSeq = Math.max(this.logSeq, l.id + 1);
      this.agentRt.set(a.id, { log: tail, session: null, currentTool: null, browserUrl: null, screenshot: await loadScreen(a.id), shots: [], terminal: await this.loadTerminal(a.id) });
    }
    // CLIs the terminal keeper kept running through the restart go back into their terminals, and busy ones carry on.
    // (The CEO's session is resumed instead: its office tools live in this process.)
    const terminalOf = (id: string) => {
      const a = this.state.agents.find((x) => x.id === id);
      return a && a.role !== 'ceo' ? this.terminalFor(a) : null;
    };
    const back: ReconnectedCli[] = await this.backend.reconnectClis(terminalOf).catch((err) => {
      console.warn('could not reconnect to the terminal keeper', err);
      return [];
    });
    // Cloud agents' CLIs kept working in their Boxes while the office was closed: picked up the same way (docs/cloud.md).
    const boxApi = this.cloud.boxApi();
    const boxKept = this.state.agents.filter((a) => a.host === 'box' && a.boxCli);
    if (!boxApi) for (const a of boxKept) a.boxCli = null;
    else {
      const kept = boxKept.map((a) => ({
        agentId: a.id,
        rec: a.boxCli!,
        api: boxApi,
        record: (rec: BoxCliRecord | null) => this.boxCliRecord(a.id, rec),
        connection: (up: boolean) => this.boxMachines.connection(a.machine ?? machineName(a.id), up),
      }));
      back.push(
        ...(await this.backend.cloud.reconnect(kept, terminalOf).catch((err) => {
          console.warn("could not pick up cloud agents' CLIs", err);
          return [];
        })),
      );
      // A CLI started just before a crash, that no record names, would work the same desk as the one the office starts.
      await Promise.all(this.state.agents.filter((a) => a.host === 'box' && a.machine).map((a) => this.boxMachines.sweepStrays(a.machine!, a.boxCli ? [a.boxCli.token] : []).catch(() => 0)));
    }
    for (const r of this.state.repos) this.repoRt.set(r.id, { issues: [], pulls: [], lastSync: null, syncing: false, cloneStatus: 'pending', lastMergedAt: null, folderSync: null, merging: false, closedIssues: new Map(), closedPulls: new Map(), openAt: new Map() });
    const restart = await this.reconcileRestart((a) => followKeptCli(a, back.find((c) => c.agentId === a.id)));
    interrupted.push(...restart.interrupted);
    for (const c of back) if (c.busy && !restart.carryOn.some((a) => a.id === c.agentId)) this.agentRt.get(c.agentId)?.terminal?.releaseIdle?.();
    for (const a of restart.carryOn) this.reattachSession(a);
    this.backend.hooksReady();
    // Cloud agents who waited for a sign-in: still signed out (a new sign-in starts in their terminal), or signed in now.
    for (const a of this.state.agents) if (a.host === 'box' && a.needsSignIn) void this.checkSignIn(a);

    try {
      this.user = await this.backend.user();
    } catch (err) {
      this.ghError = `GitHub CLI is not ready: ${(err as Error).message}. Run "gh auth login".`;
      console.warn(this.ghError);
    }

    if (this.backend.demo && this.state.repos.length === 0) {
      // The demo opens on a busy office; the tutorial still runs so it can be tried.
      Object.assign(this.state.settings, { setupDone: true, managerName: 'Demo Manager', companyName: 'Demo Co.' });
      for (const r of await this.backend.listMyRepos()) {
        const repo = await this.connectRepo(r.nameWithOwner);
        const size = Math.min(this.backend.demoTeam?.(repo.floor) ?? 4, FLOOR_SEATS);
        if (size > this.state.settings.maxAgents) this.state.settings.maxAgents = size; // the big-company demo fills its floors
        for (let i = 1; i < size; i++) this.hireAgent(repo.id, {}); // connecting hired the first
        this.updateRepo(repo.id, { autoAssign: true });
      }
      // Mission control opens on a week that already happened.
      this.state.ops = this.backend.seedOps?.(this.state.repos.map((r) => r.id), Date.now()) ?? this.state.ops;
    }
    for (const r of this.state.repos) this.ensureAgent(r);
    this.ensureCeo(interrupted);
    // Agents from before the ledger start their careers now.
    for (const a of this.state.agents) if (a.role !== 'ceo') applyLedger(this.state.progress, { kind: 'hired', agentId: a.id, at: Date.now() });

    for (const r of this.state.repos) void this.cloneRepo(r.id);
    await Promise.all(this.state.repos.map((r) => this.syncRepo(r.id)));
    // Anything still alive in a desk (or a preview) is left over from before the restart, except around the CLIs that
    // kept running through it: their dev servers and commands are theirs.
    await Promise.all([
      ...this.state.agents.map((a) => {
        const repo = this.state.repos.find((r) => r.id === a.repoId);
        if (!repo || back.some((c) => c.agentId === a.id)) return undefined;
        return this.releaseDesk(a, repo).catch(() => undefined);
      }),
      this.previews.clearOrphans(this.state.repos),
    ]);
    for (const r of this.state.repos) void this.previews.refreshDefault(r);
    void pruneQaShots(QA_SHOTS_DIR, new Set(this.state.qa.map((q) => `${q.repoId}#${q.prNumber}`)));
    this.finishRestart(restart);
    // A PR the restart left in "testing" with nobody on it: test it again (the result, if any, was lost).
    for (const rec of orphanedQa(this.state.qa, this.state.agents, BUSY)) this.setQa(rec, { status: 'queued', qaAgentId: null });
    if (this.state.prLimits < PR_LIMITS_VERSION) this.catchUpPrs();
    this.officeHead = await this.backend.office.head();
    const updated = await this.backend.office.takeLastUpdate().catch(() => null);
    if (updated) await this.reportUpdate(updated);
    setInterval(() => this.state.repos.forEach((r, i) => setTimeout(() => void this.syncRepo(r.id), i * 1500)), SYNC_INTERVAL_MS);
    setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
    setInterval(() => this.previews.sweepPrs(), 15_000);
    setInterval(() => void this.saveTerminals(), TERMINAL_SAVE_MS);
    // Every minute in the demo, so a short idle time shows its phone message soon.
    setInterval(() => {
      void this.trimIdleDesks();
      void this.voice.prune();
      void this.journal.prune().catch((err) => console.warn('could not prune the journal', err));
      void this.spend.ledger.prune();
    }, this.backend.demo ? 60_000 : TRIM_SWEEP_MS);
    setInterval(() => {
      this.state.repos.forEach((r, i) => setTimeout(() => void this.sweepFloor(r.id), i * 1500));
      void this.sweepMachines();
    }, DESK_SWEEP_INTERVAL_MS);
    void this.sweepMachines();
    setInterval(() => this.greet(), 60_000);
    setTimeout(() => this.greet(), 5000);
    setInterval(() => void this.files.sweep(), SWEEP_MS).unref();
    setInterval(() => this.emitOps(), OPS_TICK_MS); // the clock moves the numbers too: the last hour, today, errors turning into alarms
    setInterval(() => this.notifyStuck(), 60_000);
    setInterval(() => this.watchdogTick(), WATCHDOG_MS);
    void this.backend
      .detectClis()
      .then((clis) => {
        this.clis = clis;
        this.broadcast({ type: 'clis', clis });
      })
      .catch((err) => console.warn('could not look for agent CLIs', err));
    void this.refreshTooling();
    await this.journal.start();
    await this.spend.ledger.load();
    // A fresh demo office has a week of spending to look at.
    if (this.backend.demo && !this.spend.ledger.all().length && this.backend.seedCosts) void this.spend.ledger.replace(this.backend.seedCosts(this.state.repos, this.state.agents, Date.now()));
    // A fresh demo office has yesterday to replay too.
    if (this.backend.demo) void this.journal.hasPastDays().then((has) => (has ? undefined : this.journalSample())).catch((err) => console.warn('could not write the sample day', err));
    this.save();
    // Tabs connect after this, so each one's snapshot has at least these: later changes go out as patches on them.
    this.outbox.seed(
      this.state.agents.map((a) => {
        const { log: _log, ...view } = this.agentView(a, false);
        return view;
      }),
      this.state.repos.map((r) => this.repoView(r)),
    );
    setTimeout(() => this.schedule(), 1000);
  }

  /**
   * Startup reconciliation (reconcile.ts), before anything is reattached or scheduled: GitHub is asked about every task
   * and each desk is looked for. Finished work is cleared now (as its closure would); CLIs the keeper kept are followed
   * again only on open work at a desk that's still there; everyone else who was busy is stopped, to resume or start
   * over once the floors have synced (finishRestart). alive: the agent's CLI kept working on this task.
   */
  protected async reconcileRestart(alive: (a: PersistedAgent) => boolean): Promise<Restart> {
    const plan = new Map<PersistedAgent, ReconcileStep>();
    await Promise.all(
      this.state.agents.map(async (a) => {
        const repo = this.state.repos.find((r) => r.id === a.repoId);
        const rt = repo && this.repoRt.get(repo.id);
        if (!repo || !rt || a.role === 'ceo' || !a.task) return;
        const [issue, pr] = await Promise.all([
          a.task === 'issue' && a.issueNumber ? this.backend.issueState(repo.fullName, a.issueNumber).catch(() => null) : null,
          a.prNumber ? this.backend.prDetails(repo.fullName, a.prNumber).catch(() => null) : null,
        ]);
        // What GitHub said is learned like a sync's asks, so cleanUpClosed clears the desks, QA records and holds.
        if (issue === 'CLOSED' && a.issueNumber) rt.closedIssues.set(a.issueNumber, Date.now());
        if (pr && pr.state !== 'OPEN' && !rt.closedPulls.has(pr.number)) {
          rt.closedPulls.set(pr.number, { number: pr.number, state: pr.state, headRefName: pr.headRefName, closesIssues: pr.closesIssues, at: Date.now() });
          this.holdIssues(repo, rt.closedPulls.get(pr.number)!);
        }
        plan.set(
          a,
          reconcileStep({
            role: a.role,
            status: a.status,
            task: a.task,
            work: workState(issue, pr?.state ?? null),
            // A cloud agent's desk is in their Box: taken to be there (Upstash may be unreachable, and looking wakes it).
            deskExists: a.host === 'box' || this.backend.deskExists(this.deskOf(a, repo)),
            cliAlive: alive(a),
            resumable: resumesAfterRestart(a, a.status === 'preparing', this.backend.demo),
          }),
        );
      }),
    );
    const out: Restart = { carryOn: [], interrupted: [], preparing: new Set(), requeue: new Set(), counts: { cleared: 0, reattached: 0, resumed: 0, requeued: 0 } };
    for (const a of this.state.agents) {
      const step = plan.get(a);
      if (step === 'requeue') out.requeue.add(a);
      if (!BUSY.includes(a.status)) continue;
      if (step === 'reattach' || (step === undefined && alive(a))) {
        out.carryOn.push(a);
        continue;
      }
      if (a.status === 'preparing') out.preparing.add(a);
      a.status = 'stopped';
      a.lastError = 'The swarm server restarted while this agent was working.';
      out.interrupted.push(a);
    }
    for (const r of this.state.repos) this.cleanUpClosed(r);
    for (const [a, step] of plan) if (step === 'clear' && !a.task) out.counts.cleared++;
    out.counts.reattached = out.carryOn.filter((a) => a.role !== 'ceo').length;
    return out;
  }

  /** After the startup sync: the restart's interrupted work resumes or goes back in line, and the phone hears what happened. */
  protected finishRestart(r: Restart) {
    this.recover([...r.interrupted, ...[...r.requeue].filter((a) => !r.interrupted.includes(a))], r.preparing, r.requeue, r.counts);
    const text = restartMessage(r.counts);
    if (text) this.postMessage('office', text);
  }

  /**
   * Agents cut off by a server restart pick their session back up, told what they were doing. QA, demo agents, tasks
   * still being prepared and work whose desk is gone (requeue) start over from the queue, without a strike.
   */
  protected recover(agents: PersistedAgent[], preparing: Set<PersistedAgent>, requeue = new Set<PersistedAgent>(), counts: RestartCounts = { cleared: 0, reattached: 0, resumed: 0, requeued: 0 }) {
    for (const a of agents) {
      if (!a.task) continue; // its issue or PR closed while the office was down: the startup sync cleared the desk
      const fix = a.task === 'fix' ? this.state.qa.find((q) => q.devAgentId === a.id && q.status === 'fixing') : undefined;
      if (requeue.has(a) || !resumesAfterRestart(a, preparing.has(a), this.backend.demo)) {
        this.appendLog(a, [{ kind: 'system', text: '↺ The office server restarted. Starting over from the queue.' }]);
        const rec = a.task === 'qa' ? this.state.qa.find((q) => q.qaAgentId === a.id && q.status === 'testing') : undefined;
        if (rec) this.setQa(rec, { status: 'queued' });
        if (fix) this.setQa(fix, { status: 'failed' });
        this.clearTask(a);
        counts.requeued++;
        continue;
      }
      if (this.slotsFull()) continue; // stays 'stopped'; the manager can resume it later
      counts.resumed++;
      void this.message(a.id, resumeNote(a, fix)).catch((err) => console.warn(`could not resume ${a.name}`, err));
    }
  }

  /** One-off, on the first start with bigger PR budgets: PRs the manager got under the old ones go back to work. */
  protected catchUpPrs() {
    const back: string[] = [];
    for (const rec of this.state.qa) {
      const status = catchUp(rec);
      if (!status) continue;
      const repo = this.state.repos.find((r) => r.id === rec.repoId);
      this.setQa(rec, { status, mergeNote: null, pendingSince: null, mergeRetryAt: null, alerted: false });
      back.push(`#${rec.prNumber}${repo ? ` on ${repo.fullName}` : ''}`);
    }
    this.state.prLimits = PR_LIMITS_VERSION;
    if (back.length) this.postMessage('office', `↩️ Developers now get more tries at their PRs, so ${back.join(', ')} went back to them instead of waiting for you.`);
  }

  /** A message for an agent: sent into their running session, or a follow-up that resumes it. typed: the manager typed it at their CLI's prompt, where it's already running. */
  async message(id: string, text: string, typed = false) {
    const a = this.agent(id);
    if (a.role === 'ceo') return this.messageCeo(text);
    const repo = this.repo(a.repoId);
    if (!text.trim()) throw new HttpError(400, 'Empty message');
    const rt = this.agentRt.get(id)!;
    if (rt.session) {
      this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${text}` }]);
      if (!typed) rt.session.send(text);
      return;
    }
    if (a.status === 'preparing') throw new HttpError(409, `${a.name} is still setting up; try again in a moment`);
    if (!a.sessionId || !a.branch || a.task === 'qa') throw new HttpError(409, `${a.name} has no session to continue. Give them an issue or a PR to test instead.`);
    this.ensureSlot();
    this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${text}` }]);
    const cwd = this.deskOf(a, repo);
    a.lastError = null;
    a.startedAt = Date.now();
    if (a.task === null) a.task = 'issue';
    const fixing = a.task === 'fix' && a.prNumber ? { pr: a.prNumber, headRef: a.branch } : undefined;
    this.startAgentSession(a, repo, cwd, text, this.buildSystemAppend(a, repo, cwd, a.branch, fixing), a.sessionId, undefined, typed ? 'typed' : null);
  }

  updateSettings(patch: Partial<SwarmSettings>) {
    const s = this.state.settings;
    if (patch.sessionLimit !== undefined) s.sessionLimit = Math.max(0, Math.round(Number(patch.sessionLimit)) || 0);
    // The default model belongs to the default coding agent: a new agent starts on its own default.
    if (isCli(patch.defaultCli) && patch.defaultCli !== s.defaultCli) {
      s.defaultCli = patch.defaultCli;
      if (patch.defaultModel === undefined) s.defaultModel = s.defaultCli === 'claude' ? DEFAULT_MODEL : '';
    }
    if (patch.defaultModel !== undefined) s.defaultModel = String(patch.defaultModel).trim() || (s.defaultCli === 'claude' ? DEFAULT_MODEL : '');
    if (patch.defaultEffort !== undefined && EFFORTS.includes(patch.defaultEffort)) s.defaultEffort = patch.defaultEffort;
    if (patch.taskEffort !== undefined) s.taskEffort = taskEfforts(s.taskEffort, patch.taskEffort, EFFORTS);
    if (patch.runtime === 'terminal' || patch.runtime === 'sdk') s.runtime = patch.runtime;
    if (patch.scaling === 'approve' || patch.scaling === 'auto') s.scaling = patch.scaling;
    if (patch.maxAgents !== undefined) s.maxAgents = clampMaxAgents(patch.maxAgents);
    if (patch.ceoHeartbeatMin !== undefined) s.ceoHeartbeatMin = Math.max(0, Math.min(1440, Math.round(Number(patch.ceoHeartbeatMin)) || 0));
    if (patch.ceoFollowups !== undefined) s.ceoFollowups = followupSettings(s.ceoFollowups, patch.ceoFollowups);
    if (patch.ceoMandates !== undefined) s.ceoMandates = mandateList(patch.ceoMandates);
    if (typeof patch.managerName === 'string') s.managerName = patch.managerName.trim().slice(0, 40);
    if (typeof patch.companyName === 'string') s.companyName = patch.companyName.trim().slice(0, 60);
    if (typeof patch.dogName === 'string') s.dogName = patch.dogName.trim().slice(0, 24) || DEFAULT_DOG_NAME;
    if (typeof patch.projectsDir === 'string' && patch.projectsDir.trim()) s.projectsDir = path.resolve(patch.projectsDir.trim());
    if (typeof patch.setupDone === 'boolean') s.setupDone = patch.setupDone;
    if (patch.tutorialStep !== undefined) s.tutorialStep = Math.max(-1, Math.round(Number(patch.tutorialStep)) || 0);
    if (typeof patch.autoUpdate === 'boolean') s.autoUpdate = patch.autoUpdate;
    if (patch.pacingSessions !== undefined) s.pacingSessions = clampPacingSessions(patch.pacingSessions);
    if (patch.trimIdleDesksMin !== undefined) {
      s.trimIdleDesksMin = clampTrimIdleMin(patch.trimIdleDesksMin);
      setTimeout(() => void this.trimIdleDesks(), 1000);
    }
    if (patch.voice !== undefined) {
      const keepDays = s.voice.keepDays;
      s.voice = voiceSettings(s.voice, patch.voice);
      if (s.voice.keepDays !== keepDays) setTimeout(() => void this.voice.prune(), 500);
    }
    if (patch.themes !== undefined) {
      s.themes = themeSettings(s.themes, patch.themes);
      setTimeout(() => this.greet(), 1000);
    }
    if (patch.weather !== undefined) {
      s.weather = weatherSettings(s.weather, patch.weather);
      this.weather.settingsChanged();
    }
    if (patch.worldEvents !== undefined) s.worldEvents = worldEventSettings(s.worldEvents, patch.worldEvents);
    if (patch.listen !== undefined) s.listen = listenSettings(s.listen, patch.listen);
    if (patch.notify !== undefined) {
      const url = (patch.notify as { officeUrl?: unknown } | null)?.officeUrl;
      if (url !== undefined && officeUrl(url) === null) throw new HttpError(400, 'The office URL must be an http(s) address, e.g. https://office.your-tailnet.ts.net');
      s.notify = notifySettings(s.notify, patch.notify);
    }
    if (patch.cloud !== undefined) {
      const next: CloudSettings = cloudSettings(s.cloud, patch.cloud);
      if (next.machineKind === 'box' && !this.cloud.boxApi()) throw new HttpError(400, 'Save your Upstash Box API key first: cloud agents run in your Upstash account.');
      s.cloud = next;
    }
    this.save();
    this.broadcast({ type: 'settings', settings: s });
    this.emitCeo();
    setTimeout(() => this.schedule(), 200);
    return s;
  }

  /** The setup wizard: who you are, the company, and your CEO. */
  setup(x: { managerName?: string; companyName?: string; scaling?: string; ceoName?: string; ceoLook?: string; ceoColor?: string }) {
    this.updateSettings({
      managerName: x.managerName,
      companyName: x.companyName,
      ...(x.scaling === 'auto' || x.scaling === 'approve' ? { scaling: x.scaling } : {}),
    });
    const ceo = this.ceo();
    this.updateAgent(ceo.id, { name: x.ceoName, color: x.ceoColor });
    if (LOOKS.includes(x.ceoLook as AgentLook)) this.updateAgent(ceo.id, { look: x.ceoLook });
    return this.state.settings;
  }

  // ---------- the CEO ----------

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
    return { floor: repo.floor, fullName: repo.fullName, clone: this.backend.mainDir(repo.fullName), mission: repo.mission, backlog: this.repoRt.get(repo.id)?.issues.length ?? 0 };
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
    };
  }

  protected emitCeo() {
    this.broadcast({ type: 'ceo', ceo: this.ceoInfo() });
  }

  /** Queue a job for the CEO: one onboarding and one plan per floor, one review, and chat messages merge into one reply. */
  protected enqueueCeo(job: CeoJob) {
    const q = this.state.ceo.queue;
    const same = q.findIndex((j) => j.kind === job.kind && (job.kind === 'review' || job.kind === 'chat' || job.kind === 'followup' || (j.repoId === job.repoId && j.prNumber === job.prNumber)));
    if (same >= 0 && job.kind === 'followup') q[same] = { ...q[same], events: [...(q[same].events ?? []), ...(job.events ?? [])].slice(-20) };
    else if (same >= 0) q[same] = job.kind === 'chat' ? { ...q[same], text: `${q[same].text}\n${job.text}`, messageIds: [...(q[same].messageIds ?? []), ...(job.messageIds ?? [])] } : job;
    else q.push(job);
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 150);
  }

  /** Start the CEO's next job when they're free and a session slot is open. Replies to the manager go first. */
  protected startCeoWork(): void {
    const a = this.state.agents.find((x) => x.id === CEO_ID);
    const c = this.state.ceo;
    // A triage whose PR is no longer stuck (the manager stepped in, or it closed) has nothing left to do.
    const stale = c.queue.filter((j) => j.kind === 'triage' && !this.stuckRecord(j));
    if (stale.length) {
      c.queue = c.queue.filter((j) => !stale.includes(j));
      this.emitCeo();
      this.save();
    }
    if (!a || BUSY.includes(a.status) || c.job || c.queue.length === 0) return;
    if (this.slotsFull()) return;
    const rank: Record<CeoJob['kind'], number> = { chat: 0, triage: 0, onboard: 1, plan: 1, followup: 2, review: 2 };
    // A floor's jobs wait for its clone and first sync, so the CEO has something to read.
    const ready = (j: CeoJob) => {
      const rt = j.repoId ? this.repoRt.get(j.repoId) : undefined;
      return !rt || rt.cloneStatus === 'error' || (rt.cloneStatus === 'ready' && rt.lastSync != null);
    };
    const job = [...c.queue].sort((x, y) => rank[x.kind] - rank[y.kind]).find(ready);
    if (!job) return;
    c.queue.splice(c.queue.indexOf(job), 1);
    const rt = job.repoId ? this.repoRt.get(job.repoId) : undefined;
    if (job.repoId && (!rt || rt.cloneStatus === 'error')) {
      const repo = this.state.repos.find((r) => r.id === job.repoId);
      if (repo) this.postMessage('office', `⚠️ ${a.name} couldn't study floor ${repo.floor}: the repository clone failed (${rt?.cloneError ?? 'unknown error'}).`);
      this.emitCeo();
      this.save();
      return this.startCeoWork();
    }
    void this.runCeoJob(a, job);
  }

  protected ceoPromptInput(a: PersistedAgent): Parameters<typeof ceoSystemPrompt>[0] {
    const s = this.state.settings;
    return { name: a.name, company: s.companyName, manager: s.managerName, notesFile: path.join(CEO_DIR, 'NOTES.md'), sessionLimit: s.sessionLimit, maxAgents: s.maxAgents, scaling: s.scaling };
  }

  protected async runCeoJob(a: PersistedAgent, job: CeoJob) {
    const rt = this.agentRt.get(a.id)!;
    const floor = this.ceoFloor(job.repoId);
    const label = jobLabel(job, floor);
    this.state.ceo.job = job;
    Object.assign(a, { status: 'working' as AgentStatus, task: null, issueNumber: null, issueTitle: label, startedAt: Date.now(), endedAt: null, costUsd: 0, turns: 0, lastError: null });
    this.appendLog(a, [
      { kind: 'system', text: '' },
      { kind: 'system', text: `━━━ ${label} ━━━` },
    ]);
    if (job.kind === 'chat') {
      this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${job.text}` }]);
      if (job.messageIds?.length) this.markDelivery(job.messageIds, 'read');
    }
    if (job.kind === 'review') {
      this.state.ceo.lastReviewAt = Date.now();
      this.state.ceo.lastFingerprint = this.fingerprint();
    }
    this.ceoIssues = new IssueCap(MAX_ISSUES_PER_JOB);
    this.spend.ceoActs = 0;
    this.ceoAsked = askedFor(job);
    this.emitAgent(a);
    this.emitCeo();
    this.save();
    await fs.mkdir(CEO_DIR, { recursive: true }).catch(() => undefined);
    const triage = job.kind === 'triage' ? await this.triagePr(job) : null;
    if (a.status !== 'working') {
      // stopped before the session started
      this.state.ceo.job = null;
      if (job.kind === 'triage') this.endTriage(job);
      this.emitCeo();
      return;
    }
    // A chat carries on from the CEO's last session, so "why did you propose that?" has an answer.
    const how = this.sessionRuntime(a, job.kind === 'chat' ? (a.sessionId ?? undefined) : undefined);
    const kind: TaskKind = `ceo-${job.kind}`;
    const run = this.spend.start(a.id, { kind, effort: resolveEffort(a.effort, kind, this.state.settings.taskEffort, CEO_EFFORT), model: a.model || CEO_MODEL, startedAt: Date.now(), round: null });
    rt.session = this.backend.startSession(
      {
        cwd: CEO_DIR,
        prompt: ceoJobPrompt(job, floor, triage, liveMandates(this.state.settings.ceoMandates, Date.now())),
        systemAppend: ceoSystemPrompt(this.ceoPromptInput(a)),
        model: run.model,
        effort: run.effort,
        browserTesting: false,
        // The clones, and QA's screenshots for qa_report's paths.
        additionalDirectories: [...this.state.repos.filter((r) => this.repoRt.get(r.id)?.cloneStatus === 'ready').map((r) => this.backend.mainDir(r.fullName)), QA_SHOTS_DIR],
        role: 'ceo',
        office: this.officeTools(),
        tools: this.sessionToolsFor(a, 'claude'),
        ...how,
      },
      {
        log: (entries) => {
          this.appendLog(a, entries);
          this.ceoFiles.record(entries);
        },
        tool: (name) => {
          if (rt.currentTool === name) return;
          rt.currentTool = name;
          this.emitAgent(a);
        },
        sessionId: (id) => {
          a.sessionId = id;
          a.sessionCli = id ? 'claude' : null;
        },
        browserUrl: () => undefined,
        screenshot: () => undefined,
        // A follow-up that found nothing to do stays off the manager's phone.
        turn: (text) => {
          if (job.kind === 'followup' && quietReply(text)) return;
          this.postCeoReply(text);
          this.markDelivery('all', 'replied');
        },
        limited: (at) => this.pauseForLimit(at),
        usageWarning: (info) => this.paceForWarning(info),
        usage: (readings) => this.recordUsage(readings),
        finished: (result) => this.onCeoFinished(a, result),
      },
    );
  }

  protected onCeoFinished(a: PersistedAgent, result: SessionResult) {
    const rt = this.agentRt.get(a.id);
    if (!rt || this.officeUpdate.handedOver) return;
    rt.session = null;
    rt.currentTool = null;
    a.endedAt = Date.now();
    a.costUsd += result.costUsd;
    a.turns += result.turns;
    recordCost(this.state.ops, '', result.costUsd, a.endedAt);
    const job = this.state.ceo.job;
    this.state.ceo.job = null;
    if (job?.kind === 'triage') this.endTriage(job);
    if (this.ceoFiles.pending()) this.postCeoReply(''); // files attached after its last reply still reach the phone
    this.ceoFiles.endJob();
    if (result.interrupted) this.interrupted(a);
    const floorJob = job?.repoId && this.state.repos.some((r) => r.id === job.repoId) ? job.repoId : '';
    void this.spend.record({ ...a, issueNumber: null, prNumber: job?.prNumber ?? null }, floorJob, this.spend.take(a.id), 'ceo-chat', result, { stopped: a.status === 'stopped', ceoHint: result.ok ? (this.ceoIssues.total > 0 || this.spend.ceoActs > 0 ? 'ceo-acted' : 'ceo-idle') : undefined });
    if (a.status === 'stopped') {
      // the manager already logged the stop
    } else if (!result.ok) {
      a.status = 'error';
      a.lastError = result.errors.join('; ') || 'Session failed';
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      const what = job ? jobLabel(job, this.ceoFloor(job.repoId)).toLowerCase() : 'working';
      this.postMessage('office', `⚠️ ${a.name} hit a problem while ${what}: ${a.lastError.slice(0, 240)}`);
    } else {
      a.status = 'done';
      const filed = this.ceoIssues.total ? ` · ${this.ceoIssues.total} issue${this.ceoIssues.total === 1 ? '' : 's'} filed` : '';
      this.appendLog(a, [{ kind: 'done', text: `✔ Done in ${this.minutes(a)}m · ${a.turns} turns${filed}` }]);
    }
    for (const id of this.ceoIssues.repos) void this.syncRepo(id);
    this.emitAgent(a);
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 300);
  }

  /** The manager's phone (or Telegram) → the CEO, with a quote of the message it replies to and any files. Injected into a running session, otherwise the CEO picks it up next. */
  async messageCeo(text: string, replyTo?: number, via?: 'telegram', fileIds: readonly string[] = []) {
    const t = text.trim().slice(0, 4000);
    const attachments = this.ceoFiles.managerFiles(fileIds);
    if (!t && !attachments.length) throw new HttpError(400, 'Empty message');
    const a = this.ceo();
    const quoted = replyTo === undefined ? undefined : this.state.messages.find((m) => m.id === replyTo);
    const m = this.postMessage('manager', t, undefined, { ...(replyTo !== undefined && { replyTo }), delivery: 'sent', ...(via && { telegram: 'in' as const }), ...(attachments.length && { attachments }) });
    const forward = [forwardText(t, quoted), this.ceoFiles.forwardLines(attachments)].filter(Boolean).join('\n');
    const rt = this.agentRt.get(a.id)!;
    if (rt.session) {
      this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${forward}` }]);
      this.ceoIssues.managerMessage(); // a new request: the issue cap counts from here
      this.ceoAsked = true;
      rt.session.send(`Message from the manager (they read your reply on their phone, so keep it short):\n${forward}`);
      this.markDelivery([m.id], 'read');
      return { id: m.id };
    }
    this.enqueueCeo({ kind: 'chat', text: forward, messageIds: [m.id], at: Date.now() });
    return { id: m.id };
  }

  /** Moves the manager's messages along (shared/chat.ts nextDelivery) and tells the phones which ones moved. */
  protected markDelivery(ids: readonly number[] | 'all', ev: 'read' | 'replied') {
    const moved: number[] = [];
    let to: ServerDelivery | null = null;
    for (const m of this.state.messages) {
      if (m.from !== 'manager' || !m.delivery || (ids !== 'all' && !ids.includes(m.id))) continue;
      const next = nextDelivery(m.delivery, ev);
      if (next === m.delivery) continue;
      m.delivery = next as ServerDelivery;
      to = m.delivery;
      moved.push(m.id);
    }
    if (!to) return;
    this.broadcast({ type: 'delivery', ids: moved, delivery: to });
    this.save();
  }

  requestReview() {
    if (this.state.repos.length === 0) throw new HttpError(400, 'Connect a repo first: the CEO needs a floor to review.');
    this.enqueueCeo({ kind: 'review', at: Date.now() });
  }

  onboardFloor(repoId: string) {
    const repo = this.repo(repoId);
    this.enqueueCeo({ kind: 'onboard', repoId: repo.id, at: Date.now() });
  }

  /** The manager hands the CEO a brief for a floor; the CEO turns it into issues and a team. */
  planFloor(repoId: string, mission?: string) {
    const repo = this.repo(repoId);
    if (typeof mission === 'string') {
      repo.mission = mission.trim().slice(0, 4000);
      this.emitRepo(repo);
    }
    if (!repo.mission) throw new HttpError(400, 'Write a brief first: what should this floor build?');
    this.enqueueCeo({ kind: 'plan', repoId: repo.id, at: Date.now() });
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
  protected followup(ev: Omit<FollowupEvent, 'id' | 'at'>) {
    if (!addFollowup(this.state.ceo.followups, { ...ev, at: Date.now() }, this.state.settings.ceoFollowups)) return;
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 150);
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
    this.setQa(rec, { escalated: true });
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

  /** The stuck PR a triage tool names; refused unless it is on the current triage job's floor (see checkTriageTarget). */
  protected async triageTarget(x: { floor: number; pr: number }) {
    const job = this.state.ceo.job;
    const jobFloor = job?.kind === 'triage' ? (this.state.repos.find((r) => r.id === job.repoId)?.floor ?? null) : null;
    const repo = this.state.repos.find((r) => r.floor === x.floor);
    const pr = Number(x.pr);
    const listed = repo ? this.repoRt.get(repo.id)?.pulls.find((p) => p.number === pr) : undefined;
    // The last sync may be a minute old and doesn't list closed PRs: ask GitHub about this one.
    const pull = repo && x.floor === jobFloor ? await this.backend.prDetails(repo.fullName, pr).catch(() => listed) : listed;
    const rec = repo ? this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === pr) : undefined;
    checkTriageTarget({ jobFloor, floor: x.floor, pr, pull, status: rec?.status });
    return { repo: repo!, rec: rec!, listed };
  }

  protected async triageRetryQa(x: { floor: number; pr: number }) {
    const { repo, rec } = await this.triageTarget(x);
    await this.sendToQa(repo.id, rec.prNumber);
    return `PR #${rec.prNumber} is queued for QA round ${rec.round}.`;
  }

  protected async triageSendBack(x: { floor: number; pr: number; note: string }) {
    const { repo, rec } = await this.triageTarget(x);
    const note = String(x.note ?? '').trim();
    if (!note) throw new HttpError(400, 'Say what the developer should do: the note goes with the fix.');
    await this.sendBackToDev(repo.id, rec.prNumber, note, `${this.ceo().name}, the CEO`);
    return `PR #${rec.prNumber} goes back to a developer with QA's findings and your note.`;
  }

  protected async triageRerunChecks(x: { floor: number; pr: number }) {
    const { repo, rec, listed } = await this.triageTarget(x);
    const runIds = failedRunIds(listed?.failedChecks ?? []);
    if (!listed || !runIds.length) {
      const failed = listed?.failedChecks.map((c) => c.name) ?? [];
      throw new HttpError(409, `PR #${rec.prNumber} has no failed GitHub Actions runs to re-run${failed.length ? ` (${failed.join(', ')} can't be re-run from here)` : ''}.`);
    }
    await this.backend.rerunFailedJobs(repo.fullName, runIds);
    const runs = `${runIds.length} failed run${runIds.length === 1 ? '' : 's'}`;
    if (rec.passedSha && rec.passedSha === listed.headSha) {
      // QA signed off on this commit: the merge gate waits for the re-run and merges if it goes green.
      this.setQa(rec, { status: 'passed', rerunSha: listed.headSha, rerunAt: Date.now(), pendingSince: null, mergeNote: 're-running a failed check' });
      return `Re-running ${runs} on PR #${rec.prNumber}. QA passed this commit, so it merges if they go green.`;
    }
    await this.sendToQa(repo.id, rec.prNumber);
    return `Re-running ${runs} on PR #${rec.prNumber}, and it is queued for QA round ${rec.round}.`;
  }

  protected async triageClosePull(x: { floor: number; pr: number; comment: string }) {
    const { repo, rec, listed } = await this.triageTarget(x);
    const comment = String(x.comment ?? '').trim();
    if (!comment) throw new HttpError(400, 'Say why the pull request is closing: the comment is posted on it.');
    const issues = listed ? issuesResolvedBy(listed) : [];
    const ceo = this.ceo().name;
    await this.backend.commentPull(repo.fullName, rec.prNumber, `${comment}\n\n<sub>Closed by ${ceo}, the cubefarm CEO, after triage.${issues.length ? ' Its issue stays open, so it is built again.' : ''}</sub>`);
    // Closing deletes no branch and leaves the issue open, so the scheduler hands it out again.
    await this.backend.closePull(repo.fullName, rec.prNumber);
    this.postMessage('office', `🗂️ ${ceo} closed PR #${rec.prNumber} on floor ${repo.floor}: ${comment.split('\n')[0].slice(0, 200)}`);
    this.dropRecord(repo, rec.prNumber);
    this.learnPull(repo, { number: rec.prNumber, headRefName: listed?.headRefName ?? '', closesIssues: listed?.closesIssues ?? [] }, 'CLOSED', true); // built again
    void this.syncRepo(repo.id);
    return `Closed PR #${rec.prNumber}.${issues.length ? ` ${issues.map((n) => `#${n}`).join(', ')} stay${issues.length === 1 ? 's' : ''} open, so a developer builds it again.` : ''}`;
  }

  protected async triageEscalate(x: { floor: number; pr: number; reason: string }) {
    const { rec } = await this.triageTarget(x);
    const step = triageStep({ kind: 'escalate', reason: String(x.reason ?? '').split('\n')[0].slice(0, 300) });
    if (step.do === 'escalate') this.escalate(rec, step.note && `${this.ceo().name}: ${step.note}`);
    return `The manager has PR #${rec.prNumber} now, with your diagnosis.`;
  }

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

  // ---------- the phone ----------

  /** `changes`: the team changes a CEO message proposes (Telegram gets their buttons); `telegram: 'in'`: sent from there. */
  protected postMessage(from: PhoneMessage['from'], text: string, requestId?: string, opts: Pick<PhoneMessage, 'replyTo' | 'delivery' | 'telegram' | 'attachments' | 'used'> & { changes?: TeamChange[] } = {}) {
    const { changes, ...extra } = opts;
    // The CEO's suggestion boxes and artifacts come out of the text (shared/chatParts.ts).
    const parts = from === 'ceo' ? parseCeoMessage(text) : { text };
    const id = this.messageSeq++;
    const artifacts = makeArtifacts(id, parts.artifacts);
    const m: PhoneMessage = { id, from, text: parts.text.trim().slice(0, 6000), at: Date.now(), ...(requestId ? { requestId } : {}), ...extra, ...(parts.suggestions && { suggestions: parts.suggestions }), ...(artifacts && { artifacts }) };
    const v = this.state.settings.voice;
    if (v.provider !== 'off' && speaks(m, v)) m.voice = v.provider; // what the phone's ▶ replays it with
    if (from === 'ceo' && this.mirrorsToTelegram()) {
      m.telegram = 'out';
      void this.telegram.send(telegramChat(this.ceo().name, m.text), changes ? teamKeyboard(changes) : undefined).then((why) => {
        if (why) this.postMessage('office', `That message didn't reach Telegram: ${why}.`);
      });
    }
    this.state.messages.push(m);
    if (this.state.messages.length > KEEP_MESSAGES) this.state.messages.splice(0, this.state.messages.length - KEEP_MESSAGES);
    this.broadcast({ type: 'message', message: m });
    this.save();
    // Proposals are notified as such (proposeHire, proposeLetGo).
    if (from === 'ceo' && !requestId) {
      const said = m.text || `📎 ${[...(m.artifacts ?? []).map((a) => a.title), ...(m.attachments ?? []).map((f) => f.name)].join(', ')}`;
      this.notifier.notify('ceoMessage', this.ceo().name, plainText(said), `${this.ceo().name}: ${plainText(said, 100)}`);
    }
    return m;
  }

  /** A CEO reply on the phone, with the files it attached and what it used since its last one. */
  protected postCeoReply(text: string) {
    this.postMessage('ceo', text, undefined, this.ceoFiles.takeReply());
  }

  /** GET /api/ceo/picks: the "/" list, the manager's installed skills and apps plus the connectors the CEO has used lately. */
  async ceoPicks(): Promise<QuickPicks> {
    return quickPicks(await this.backend.quickPicks().catch(() => ({ skills: [], apps: [] })), this.state.messages);
  }

  /** CEO messages go to Telegram too: the manager's last message came from there, or Settings mirrors the whole chat. */
  protected mirrorsToTelegram(): boolean {
    if (!this.telegram.linked()) return false;
    if (this.state.settings.notify.telegramMirror) return true;
    return [...this.state.messages].reverse().find((m) => m.from === 'manager')?.telegram === 'in';
  }

  /** A team-change button pressed on Telegram: the same approve and decline as the lobby's. */
  protected decideFromTelegram(verdict: 'approve' | 'decline', id: string): string {
    const req = this.state.requests.find((r) => r.id === id);
    if (verdict === 'approve') this.approveRequest(id);
    else this.rejectRequest(id);
    return verdict === 'approve' ? `✅ Done: ${req?.kind === 'let-go' ? `${req.name} leaves` : `${req?.name ?? 'they'} joined`}.` : `✋ Declined${req ? `: ${req.name}` : ''}.`;
  }

  /** The CEO's send_telegram: to the manager's linked chat only. */
  protected async sendTelegram(a: { text: string }): Promise<string> {
    if (!this.telegram.linked()) throw new Error("Telegram isn't set up: the manager links their chat in Settings → Notifications → Telegram. Answer here instead.");
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
    this.notifier.notify('needsHuman', `PR #${rec.prNumber} needs you`, `${name}${title ? `: ${title}` : ''}. ${rec.stuckWhy ? `Stuck because ${rec.stuckWhy}.` : rec.summary ?? ''}`, `${name} #${rec.prNumber}${title ? ` ${title}` : ''}`);
  }

  protected notifyMerge(repo: PersistedRepo, n: number, title: string) {
    const name = repo.fullName.split('/')[1];
    this.notifier.notify('merge', `Merged PR #${n}`, `${name}${title ? `: ${title}` : ''}`, `${name} #${n}${title ? ` ${title}` : ''}`);
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
      this.notifier.notify('agentError', `${a.name} needs help`, `In an error for ${mins} minutes${repo ? ` on floor ${repo.floor}` : ''}: ${clip(a.lastError ?? 'their session failed', 200)}`, `${a.name}${repo ? ` (floor ${repo.floor})` : ''}`);
      if (a.role !== 'ceo') this.followup(followupEvents.agentError(a, key, mins, clip(scrub(a.lastError ?? 'their session failed', this.secrets()), 200), repo?.id, repo && this.floorName(repo)));
    }
    for (const key of this.toldStuck) if (!this.state.agents.some((a) => key === `${a.id}:${a.endedAt ?? 0}` && a.status === 'error')) this.toldStuck.delete(key);
  }

  markPhoneRead(at: number) {
    const t = Math.min(Number(at) || Date.now(), Date.now());
    if (t <= this.state.phoneReadAt) return;
    this.state.phoneReadAt = t;
    this.broadcast({ type: 'phoneRead', at: t });
    this.save();
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

  // ---------- team changes ----------

  protected addRequest(req: HireRequestView) {
    this.state.requests.push(req);
    const decided = this.state.requests.filter((r) => r.status !== 'pending');
    if (decided.length > KEEP_DECIDED_REQUESTS) {
      const drop = new Set(decided.slice(0, decided.length - KEEP_DECIDED_REQUESTS));
      this.state.requests = this.state.requests.filter((r) => !drop.has(r));
    }
    this.broadcast({ type: 'request', request: req });
    this.save();
  }

  protected decide(req: HireRequestView, patch: Pick<HireRequestView, 'status' | 'note' | 'decidedBy'>) {
    Object.assign(req, patch, { decidedAt: Date.now() });
    this.broadcast({ type: 'request', request: req });
    this.save();
  }

  /** "Codex · gpt-6 · high": what an agent runs, where it isn't the office default ('' when it all is). */
  protected setupLabel(x: { cli: AgentCli | ''; model: string; effort: EffortLevel | ''; host?: MachineHost | '' }) {
    return [x.cli ? cliLabel(x.cli) : '', x.model, x.effort ? `${x.effort} effort` : '', x.host === 'box' ? 'in the cloud' : ''].filter(Boolean).join(' · ');
  }

  /** A team change goes through: the new agent joins as set up here (the manager's changes win), or an agent leaves. */
  approveRequest(id: string, overrides: { name?: string; cli?: string; model?: string; effort?: string; host?: string; note?: string } = {}, by: 'manager' | 'auto' = 'manager') {
    const req = this.state.requests.find((r) => r.id === id);
    if (!req) throw new HttpError(404, 'That team change no longer exists');
    if (req.status !== 'pending') throw new HttpError(409, `That team change was already ${req.status}`);
    const repo = this.repo(req.repoId);
    // The manager's note (from the lobby card) reaches the CEO as managerNote, as a decline's does.
    const note = (overrides.note ?? '').trim().slice(0, 400);
    const quoted = note ? ` Your note: "${note}"` : '';
    if (req.kind === 'hire') {
      const name = overrides.name?.trim() || req.name;
      const agent = this.hireAgent(repo.id, {
        name,
        cli: overrides.cli ?? req.cli,
        host: overrides.host ?? req.host ?? '',
        strict: true,
        model: overrides.model ?? req.model,
        effort: overrides.effort ?? req.effort,
        look: name === req.name ? req.look : undefined,
        appearance: { color: req.color, hair: req.hair, skin: req.skin },
        // the request's id: the candidate waiting in the lobby was drawn from it, so they look the same at their desk
        id: req.id,
      });
      Object.assign(req, { agentId: agent.id, name: agent.name, cli: agent.cli, host: agent.host ?? 'local', model: agent.model, effort: agent.effort });
      this.decide(req, { status: 'approved', note, decidedBy: by });
      const setup = this.setupLabel(req);
      this.postMessage('office', by === 'auto' ? `🤖 ${agent.name} joined floor ${repo.floor}${setup ? ` (${setup})` : ''}.` : `✅ You hired ${agent.name} for floor ${repo.floor}${setup ? ` (${setup})` : ''}.${quoted}`, req.id);
      this.toast('success', `${agent.name} joined floor ${repo.floor}`);
      return;
    }
    const a = req.agentId ? this.state.agents.find((x) => x.id === req.agentId) : undefined;
    this.decide(req, { status: 'approved', note: a ? note : 'They had already left.', decidedBy: by });
    if (a) {
      try {
        this.fireAgent(a.id);
      } catch (err) {
        this.decide(req, { status: 'pending', note: '', decidedBy: null });
        throw err;
      }
    }
    this.postMessage('office', `👋 ${req.name} left floor ${repo.floor}${by === 'auto' ? '' : ' (you agreed)'}.${a ? quoted : ''}`, req.id);
  }

  rejectRequest(id: string, note = '') {
    const req = this.state.requests.find((r) => r.id === id);
    if (!req) throw new HttpError(404, 'That team change no longer exists');
    if (req.status !== 'pending') throw new HttpError(409, `That team change was already ${req.status}`);
    this.decide(req, { status: 'rejected', note: note.trim().slice(0, 400), decidedBy: 'manager' });
    const floor = this.state.repos.find((r) => r.id === req.repoId)?.floor;
    const what = req.kind === 'hire' ? `adding ${req.name} to floor ${floor ?? '?'}` : `letting ${req.name} go`;
    this.postMessage('office', `✋ You declined ${what}${req.note ? `: "${req.note}"` : '.'}`, req.id);
  }

  /**
   * With team changes applied straight away: new agents waiting in the lobby join (a floor that's full keeps them
   * waiting), and agents let go leave as soon as they aren't preparing or working. A floor's last agent never leaves.
   */
  protected applyTeamChanges() {
    if (this.state.settings.scaling !== 'auto') return;
    for (const req of this.state.requests.filter((r) => r.status === 'pending')) {
      const a = req.agentId ? this.state.agents.find((x) => x.id === req.agentId) : undefined;
      if (req.kind === 'let-go' && a && BUSY.includes(a.status)) continue;
      if (req.kind === 'let-go' && a && this.state.agents.filter((x) => x.repoId === a.repoId).length <= 1) {
        this.decide(req, { status: 'rejected', note: `${a.name} is the floor's last agent.`, decidedBy: 'auto' });
        continue;
      }
      try {
        this.approveRequest(req.id, {}, 'auto');
      } catch (err) {
        console.warn(`team change for ${req.name} waits: ${oneLine(err)}`);
      }
    }
  }

  /** A floor's team as scale_team sees it: who's there, and the team changes waiting for the manager. */
  protected teamNow(repo: PersistedRepo): TeamNow {
    const pending = this.state.requests.filter((q) => q.repoId === repo.id && q.status === 'pending');
    return {
      agents: this.state.agents.filter((a) => a.repoId === repo.id).map((a) => ({ id: a.id, desk: a.desk, free: this.isFree(a) })),
      pendingHires: pending.filter((q) => q.kind === 'hire').sort((x, y) => x.createdAt - y.createdAt).map((q) => q.id),
      pendingLetGos: pending.filter((q) => q.kind === 'let-go' && q.agentId).map((q) => ({ id: q.id, agentId: q.agentId! })),
    };
  }

  protected newHire(repo: PersistedRepo, reason: string, setup: Pick<HireRequestView, 'cli' | 'model' | 'effort'>): HireRequestView {
    const name = this.freeName();
    const req: HireRequestView = {
      id: crypto.randomUUID(),
      kind: 'hire',
      repoId: repo.id,
      agentId: null,
      name,
      reason,
      ...setup,
      look: lookFor(name),
      color: pick(SHIRTS),
      hair: pick(HAIR),
      skin: pick(SKIN),
      status: 'pending',
      note: '',
      createdAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
    };
    this.addRequest(req);
    return req;
  }

  protected newLetGo(a: PersistedAgent, reason: string): HireRequestView {
    const req: HireRequestView = {
      id: crypto.randomUUID(),
      kind: 'let-go',
      repoId: a.repoId,
      agentId: a.id,
      name: a.name,
      reason,
      cli: a.cli,
      model: a.model,
      effort: a.effort,
      look: a.look,
      color: a.color,
      hair: a.hair,
      skin: a.skin,
      status: 'pending',
      note: '',
      createdAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
    };
    this.addRequest(req);
    return req;
  }

  /**
   * The CEO's scale_team (scalePlan does the arithmetic). With scaling on approve, new agents wait in the lobby and
   * let-gos are envelopes on desks until the manager decides; on auto, they go through at once, bar busy agents, who
   * leave when their task is over (leaveIfDue).
   */
  protected scaleTeam(x: { floor: number; size: number; reason: string; cli?: string; model?: string; effort?: string }) {
    const repo = this.floorRepo(x.floor);
    const reason = String(x.reason ?? '').trim().slice(0, 600);
    if (!reason) throw new Error('Say why: the manager reads the reason.');
    const cli: AgentCli | '' = isCli(x.cli) ? x.cli : '';
    if (cli && !this.cliReady(cli)) throw new Error(`${cliLabel(cli)} isn't installed here. Installed: ${this.clis.filter((c) => c.installed).map((c) => c.id).join(', ') || 'none'}.`);
    const max = this.state.settings.maxAgents;
    const team = this.teamNow(repo);
    const before = plannedSize(team);
    const plan = scalePlan(team, Number(x.size), max);
    const counting = team.pendingHires.length + team.pendingLetGos.length ? ', counting the team changes waiting for the manager' : '';
    if (plan.size === before) return `Floor ${repo.floor} already has ${before} agent${before === 1 ? '' : 's'}${counting}${Number(x.size) > max ? ` (its most: ${max})` : ''}. Nothing changed.`;
    for (const id of [...plan.cancelHires, ...plan.cancelLetGos]) {
      const req = this.state.requests.find((r) => r.id === id);
      if (req) this.decide(req, { status: 'rejected', note: `${this.ceo().name} changed the plan.`, decidedBy: 'auto' });
    }
    const setup = { cli, model: String(x.model ?? '').trim(), effort: EFFORTS.includes(x.effort as EffortLevel) ? (x.effort as EffortLevel) : ('' as const) };
    const made = [...Array.from({ length: plan.hire }, () => this.newHire(repo, reason, setup)), ...plan.letGo.map((id) => this.newLetGo(this.agent(id), reason))];
    const capped = Number(x.size) > max ? ` (you asked for ${x.size}; its most is ${max})` : '';
    const names = (reqs: HireRequestView[]) => nameList(reqs.map((r) => r.name));
    if (this.state.settings.scaling === 'auto') {
      const now = made.filter((r) => r.kind === 'hire' || !BUSY.includes(this.agent(r.agentId!).status));
      this.applyTeamChanges();
      const joined = now.filter((r) => r.kind === 'hire');
      const left = now.filter((r) => r.kind === 'let-go');
      const later = made.filter((r) => !now.includes(r));
      const parts = [joined.length ? `${names(joined)} joined` : '', left.length ? `${names(left)} left` : '', later.length ? `${names(later)} will leave after their current task` : ''].filter(Boolean);
      return `Floor ${repo.floor} goes from ${before} to ${plan.size} agents${capped}: ${parts.join('; ') || 'withdrew the waiting changes'}.`;
    }
    const hires = made.filter((r) => r.kind === 'hire');
    const leaves = made.filter((r) => r.kind === 'let-go');
    const asks = [hires.length ? `add ${names(hires)}` : '', leaves.length ? `let ${names(leaves)} go` : ''].filter(Boolean).join(' and ');
    if (made.length) {
      const text = `📈 Floor ${repo.floor}: from ${before} to ${plan.size} agents? I'd ${asks}. ${reason}`;
      const changes = made.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
      this.postMessage('ceo', hires.length ? `${text} ${hires.length === 1 ? `${hires[0].name} waits` : 'They wait'} in the lobby, where you can set them up before hiring.` : text, made.length === 1 ? made[0].id : undefined, { changes });
      this.notifier.notify('hire', `Floor ${repo.floor}: ${before} → ${plan.size} agents?`, `${this.ceo().name} would ${asks}. ${plainText(reason)}`, `floor ${repo.floor} team change`, changes);
    }
    return `Floor ${repo.floor} goes from ${before} to ${plan.size} agents${capped} once the manager agrees: ${asks || 'withdrew the waiting changes'}.`;
  }

  /**
   * Demo only: the CEO grows or shrinks a floor by one right now (the demo office's Team tab on the phone and
   * __swarmHiring). It goes through scale_team: same checks, phone message and auto mode.
   */
  demoPropose(kind: unknown, floor?: unknown) {
    if (!this.backend.demo) throw new HttpError(404, 'Only the demo office makes up team changes');
    if (kind !== 'hire' && kind !== 'let-go') throw new HttpError(400, 'kind must be "hire" or "let-go"');
    const floors = [...this.state.repos].sort((x, y) => x.floor - y.floor).filter((r) => floor === undefined || floor === null || r.floor === Number(floor));
    if (!floors.length) throw new HttpError(404, floor === undefined || floor === null ? 'There are no floors yet' : `There is no floor ${floor}`);
    for (const r of floors) {
      const size = plannedSize(this.teamNow(r));
      const ready = this.repoRt.get(r.id)?.lastSync ? this.readyIssues(r).length : 0;
      if (kind === 'hire' ? size >= this.state.settings.maxAgents : size <= 1 || !this.available(r).length) continue;
      const reason =
        kind === 'hire'
          ? `${ready} issue${ready === 1 ? '' : 's'} could start, and ${this.available(r).length} of ${size} agents are free.`
          : `${this.available(r).length} of ${size} agents have nothing to do, and ${ready} issue${ready === 1 ? '' : 's'} could start.`;
      try {
        return { text: this.scaleTeam({ floor: r.floor, size: kind === 'hire' ? size + 1 : size - 1, reason }) };
      } catch (err) {
        throw new HttpError(409, (err as Error).message);
      }
    }
    throw new HttpError(409, kind === 'hire' ? 'Every floor already has its most agents' : 'No floor has an idle agent to let go');
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
