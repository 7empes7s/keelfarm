// `Swarm`, the orchestrator: the façade index.ts, ceo.ts and the tests use. Its parts are layers under server/swarm/,
// each extending the one before (CLAUDE.md, "Where things live"); this file is the top one.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BoxCliRecord } from './boxCli.ts';
import type { ReconnectedCli } from './cliRunner.ts';
import { DESK_SWEEP_INTERVAL_MS, SCHEDULER_INTERVAL_MS, STATE_FILE, SYNC_INTERVAL_MS } from './config.ts';
import { HttpError } from './httpError.ts';
import { settleMinutes } from './officeUpdate.ts';
import { orphanedQa } from './qaOrphans.ts';
import { catchUp, PR_LIMITS_VERSION } from './prOwnership.ts';
import { followKeptCli, resumeNote, resumesAfterRestart } from './restartRecovery.ts';
import { DEFAULT_MEMORY, memorySettings, sessionKind } from './health.ts';
import { DEFAULT_TEST_LAB, testLabSettings } from '../shared/testLab.ts';
import { reconcileStep, restartMessage, workState, type ReconcileStep, type RestartCounts } from './reconcile.ts';
import { keptWaiver, loadUsageWatch, mergeReadings } from '../shared/usage.ts';
import { loadDiskAlert } from '../shared/disk.ts';
import { loadItDesk } from '../shared/itDesk.ts';
import { loadHistory } from './metrics.ts';
import { clampTrimIdleMin, TRIM_SWEEP_MS } from './deskTrim.ts';
import { clampStuckRecheckMin } from './stuckRecheck.ts';
import { builderCli, isCli } from './clis.ts';
import { machineName } from './machines.ts';
import { taskEfforts } from './costLedger.ts';
import { loadLab } from './experiments.ts';
import { apply as applyLedger, backfillWork, loadLedger } from './ledger.ts';
import { DEFAULT_LISTEN, DEFAULT_VOICE, listenSettings, voiceSettings } from './voice.ts';
import { DEFAULT_NOTIFY, notifySettings, officeUrl } from '../shared/notify.ts';
import { keepNotices, markRead, NOTICES_KEEP } from '../shared/notices.ts';
import { cloudSettings, DEFAULT_CLOUD } from '../shared/cloud.ts';
import { cleanSwitches, DEFAULT_TOOL_SETTINGS, toolSettings } from '../shared/tooling.ts';
import { describePractices, emptyEveryProject, everyProjectSettings } from '../shared/practices.ts';
import { legacyAgent, legacyRequest } from '../shared/journal.ts';
import { DEFAULT_FOLLOWUPS, followupSettings, loadFollowups, mandateList } from '../shared/followups.ts';
import { conversationsView, currentConversation, editConversation, loadChats, openConversation, projectLine, searchConversations, startConversation, unfilled } from '../shared/conversations.ts';
import { loadMemory, removeNote, saveNote, type MemoryNote } from '../shared/ceoMemory.ts';
import { finishedLog, stopReply } from '../shared/ceoStream.ts';
import { forwardText, hideHarness } from '../shared/chat.ts';
import { messageGoesIn } from './ceoLane.ts';
import type { CeoJob } from './ceo.ts';
import { CeoChat } from './ceoChat.ts';
import { latestPage } from '../shared/chatPage.ts';
import { editDelivery, editNote } from '../shared/messageEdits.ts';
import { ceoAwakeSettings } from '../shared/ceoAwake.ts';
import { loadTaskAccounts, rotationSettings } from '../shared/accountRotation.ts';
import { cleanStyle } from '../shared/looks.ts';
import { loadRecord } from '../shared/charter.ts';
import { clampResearchMin, pastResearch } from './research.ts';
import { DEFAULT_WEATHER, DEFAULT_WORLD_EVENTS, weatherSettings, worldEventSettings } from '../shared/outside.ts';
import { DEFAULT_THEME_SETTINGS, themeSettings } from '../shared/themes.ts';
import { CEO_ID, DEFAULT_DOG_NAME, DEFAULT_MAX_AGENTS, DEFAULT_OFFICE_PLAYBOOK, FLOOR_SEATS, OFFICE_PLAYBOOK_MAX } from '../shared/types.ts';
import { SWEEP_MS } from '../shared/files.ts';
import { clampHistoryDays } from '../shared/history.ts';
import { readingsLabel } from '../shared/usage.ts';
import type { AgentLook, CloudSettings, CeoChatView, HireRequestView, PhoneMessage, SwarmSettings } from '../shared/types.ts';
import {
  type PersistedAgent,
  type Persisted,
  type PersistedRepo,
  type Restart,
  DEFAULT_MODEL,
  EFFORTS,
  BUSY,
  OPS_TICK_MS,
  WATCHDOG_MS,
  CEO_DIR,
  CONVERSATIONS_DIR,
  TERMINAL_SAVE_MS,
  clampMaxAgents,
} from './swarm/model.ts';
import { FLOOR_THEMES, lookFor, LOOKS, upgradeFloorTheme } from './swarm/flavour.ts';
import { loadScreen } from './swarm/screens.ts';
import { SwarmProblems } from './swarm/problems.ts';
import { loadDecisions } from '../shared/decisions.ts';

export { HttpError };

// A Stop waits this long for the office tools the CEO had called to finish, so its reply can say what they did.
const STOP_SETTLE_MS = 15_000;

export class Swarm extends SwarmProblems {
  protected ceoChat = new CeoChat(CONVERSATIONS_DIR, path.join(CEO_DIR, 'NOTES.md'), (live) => this.broadcast({ type: 'ceoChat', live }), (n) => this.state.repos.find((r) => r.floor === n)?.id ?? null, (ref) => this.state.agents.find((a) => a.id === ref || a.name.toLowerCase() === ref.trim().toLowerCase())?.id ?? null, (id) => this.state.agents.find((a) => a.id === id || a.name.toLowerCase() === id.toLowerCase())?.name ?? null, this.ceoTalk);

  // ---------- lifecycle ----------

  async init() {
    await this.files.load().catch((err) => console.warn('files: could not load the store', err));
    void this.files.sweep();
    try {
      const raw = await fs.readFile(STATE_FILE, 'utf8');
      const loaded = JSON.parse(raw) as Partial<Persisted>;
      this.state = {
        settings: { ...this.state.settings, ...loaded.settings, ...this.previewIdleUpgrade(loaded.settings) },
        repos: (loaded.repos ?? []).map((r) => ({
          ...r,
          autoMerge: r.autoMerge ?? true,
          links: r.links ?? [],
          mission: r.mission ?? '',
          summary: r.summary ?? '',
          qaBrief: r.qaBrief ?? '',
          playbook: r.playbook ?? '',
          localPath: r.localPath ?? null,
          preview: { command: r.preview?.command ?? null, env: { ...r.preview?.env } }, ...upgradeFloorTheme(r), // before #528 a use case didn't pick the theme
          charter: loadRecord(r.charter), // before #48 there's none: the brief above stays the mission, as it was
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
          labRetryRound: q.labRetryRound ?? null,
          escalated: q.escalated ?? q.status === 'needs-human', // stuck before triage existed: the manager was told
          mergeNote: null,
        })),
        requests: (loaded.requests ?? []).map((raw) => legacyRequest<HireRequestView>(raw)),
        ceo: { ...this.state.ceo, ...loaded.ceo, followups: loadFollowups(loaded.ceo?.followups), chats: loadChats(loaded.ceo?.chats, loaded.messages ?? [], Date.now()), remember: loadMemory(loaded.ceo?.remember) },
        messages: hideHarness(loaded.messages ?? []),
        phoneReadAt: loaded.phoneReadAt ?? 0,
        notices: keepNotices(loaded.notices, Date.now()),
        prLimits: loaded.prLimits ?? 1,
        outageReleased: loaded.outageReleased ?? false,
        stuckReleased: loaded.stuckReleased ?? false,
        ops: loadHistory(loaded.ops, Date.now()),
        held: loaded.held ?? [],
        questions: Array.isArray(loaded.questions) ? loaded.questions : [],
        decisions: loadDecisions(loaded.decisions),
        progress: loadLedger(loaded.progress),
        pong: loaded.pong && typeof loaded.pong === 'object' ? loaded.pong : {},
        officeId: typeof loaded.officeId === 'string' && /^[a-z0-9]{6}$/.test(loaded.officeId) ? loaded.officeId : this.state.officeId,
        claudeUsage: Array.isArray(loaded.claudeUsage) ? mergeReadings([], loaded.claudeUsage.filter((r) => r && typeof r.type === 'string' && Number.isFinite(r.pct) && Number.isFinite(r.at))) : [],
        diskAlert: loadDiskAlert(loaded.diskAlert),
        itDesk: loadItDesk(loaded.itDesk), it: this.loadItState(loaded.it), itTickets: this.loadTickets(loaded.itTickets), problems: this.loadProblemsState(loaded.problems), itWatch: this.loadItWatchState(loaded.itWatch),
        usageWatch: loadUsageWatch(loaded.usageWatch), usageWaiver: keptWaiver(loaded.usageWaiver, loaded.settings?.usageWarnings, Date.now()),
        experiments: loadLab(loaded.experiments, Date.now()), taskAccounts: loadTaskAccounts(loaded.taskAccounts),
      };
      for (const m of [...this.state.messages, ...this.state.it.messages]) this.messageSeq = Math.max(this.messageSeq, m.id + 1);
      void this.ceoChat.backfill(this.state.ceo.chats, unfilled(loaded.ceo?.chats)).then((n) => n && this.broadcast({ type: 'ceoChat', conversations: conversationsView(this.state.ceo.chats) })); // threads from before #132
      if (!EFFORTS.includes(this.state.settings.defaultEffort)) this.state.settings.defaultEffort = 'medium';
      if (this.state.settings.runtime !== 'sdk') this.state.settings.runtime = 'terminal';
      if (!isCli(this.state.settings.defaultCli) || !builderCli(this.state.settings.defaultCli)) this.state.settings.defaultCli = 'claude';
      this.state.settings.trimIdleDesksMin = clampTrimIdleMin(this.state.settings.trimIdleDesksMin);
      this.state.settings.stuckRecheckMin = clampStuckRecheckMin(this.state.settings.stuckRecheckMin);
      this.state.settings.historyDays = clampHistoryDays(this.state.settings.historyDays);
      if (typeof this.state.settings.dailyLogDir !== 'string') this.state.settings.dailyLogDir = '';
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
      this.state.settings.memory = memorySettings(DEFAULT_MEMORY, loaded.settings?.memory);
      this.state.settings.testLab = testLabSettings(DEFAULT_TEST_LAB, loaded.settings?.testLab);
      this.state.settings.cloud = cloudSettings(DEFAULT_CLOUD, loaded.settings?.cloud);
      this.state.settings.ceoFollowups = followupSettings(DEFAULT_FOLLOWUPS, loaded.settings?.ceoFollowups);
      this.state.settings.ceoMandates = mandateList(loaded.settings?.ceoMandates);
      this.state.settings.ceoAwake = ceoAwakeSettings(undefined, loaded.settings?.ceoAwake);
      this.state.settings.tools = toolSettings(DEFAULT_TOOL_SETTINGS, loaded.settings?.tools);
      try {
        this.state.settings.everyProject = everyProjectSettings(undefined, loaded.settings?.everyProject);
      } catch {
        this.state.settings.everyProject = emptyEveryProject();
      }
      this.state.settings.officePlaybook = typeof loaded.settings?.officePlaybook === 'string' ? loaded.settings.officePlaybook.slice(0, OFFICE_PLAYBOOK_MAX) : DEFAULT_OFFICE_PLAYBOOK;
      // Offices that were set up before the setup wizard existed skip it.
      if (loaded.settings && loaded.settings.setupDone === undefined && this.state.repos.length > 0) {
        Object.assign(this.state.settings, { setupDone: true, tutorialStep: -1 });
      }
    } catch {
      // first run
    }
    if (this.backend.demoNoTour) Object.assign(this.state.settings, { setupDone: true, tutorialStep: -1 });
    if (this.state.settings.testLab.enabled) void Promise.resolve().then(() => this.backend.testLab.warm()).catch(() => false); // never takes start-up down
    await this.voice.init();
    await this.weather.init();
    await this.notifier.init();
    await this.telegram.init();
    await Promise.all([this.cloud.init(), this.accounts.init(), this.initProviders(), this.startUsage()]);
    if (this.state.settings.cloud.machineKind !== 'local' && !this.cloud.boxApi()) this.state.settings.cloud.machineKind = 'local';
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

    const seeded = this.backend.demo && this.state.repos.length === 0;
    if (seeded) {
      // The demo opens on a busy office; the tutorial still runs so it can be tried.
      Object.assign(this.state.settings, { setupDone: true, managerName: 'Demo Manager', companyName: 'Demo Co.' });
      for (const r of (await this.backend.listMyRepos()).filter((x) => !this.backend.demoSetup?.().spare.includes(x.nameWithOwner))) { // the spare one waits to be moved in by hand (#366)
        const repo = await this.connectRepo(r.nameWithOwner);
        const size = Math.min(this.backend.demoTeam?.(repo.floor) ?? 4, FLOOR_SEATS);
        if (size > this.state.settings.maxAgents) this.state.settings.maxAgents = size; // the big-company demo fills its floors
        for (let i = 1; i < size; i++) this.hireAgent(repo.id, repo.floor === 1 && i >= size - 2 ? { cli: i === size - 1 ? 'gemini' : 'codex' } : {}); // connecting hired the first; floor 1's last runs Gemini CLI (#365), the one before Codex on a long task (#409)
        this.updateRepo(repo.id, { autoAssign: true, theme: FLOOR_THEMES[repo.floor - 1], ...(repo.floor === 1 ? { practices: { busyFiles: true, liveLeases: true } } : {}) }); // floor 1 shows conflict-aware scheduling (#256) and live leases (#398); floor N the Nth floor theme (#370, #371)
        const charter = this.backend.demoCharter?.(repo.fullName).charter;
        if (charter) this.setCharter(repo.id, charter);
      }
      // Mission control opens on a week that already happened.
      this.state.ops = this.backend.seedOps?.(this.state.repos.map((r) => r.id), Date.now()) ?? this.state.ops;
      const base = this.messageSeq - 1; // edits of every kind (#125), reactions and quoted replies (#118)
      for (const m of this.backend.seedChat?.(Date.now(), this.sampleCardFloor()) ?? []) this.state.messages.push({ ...m, id: m.id + base, ...(m.replyTo && { replyTo: m.replyTo + base }) });
      this.messageSeq = Math.max(this.messageSeq, ...this.state.messages.map((m) => m.id + 1));
      if (this.backend.seedThreads) this.messageSeq = await this.ceoChat.seed(this.state.ceo.chats, this.state.messages, this.backend.seedThreads(this.state.repos, Date.now()), this.files, this.messageSeq); // threads across floors (#132)
    }
    for (const r of this.state.repos) this.ensureAgent(r);
    this.ensureCeo(interrupted);
    // A fresh demo office has a charter change from the CEO waiting, through the real tool.
    for (const r of seeded ? this.state.repos : []) {
      const p = this.backend.demoCharter?.(r.fullName).proposal;
      if (p) void this.officeTools().call('propose_charter', { floor: r.floor, ...p });
    }
    if (seeded) this.seedDemoDecisions(); // and a question and a team change still waiting on the manager (#114)
    // Agents from before the ledger start their careers now.
    for (const a of this.state.agents) if (a.role !== 'ceo') applyLedger(this.state.progress, { kind: 'hired', agentId: a.id, at: Date.now() });
    // A fresh demo office's agents come with records of all kinds (#117).
    if (seeded && this.backend.seedCareers) Object.assign(this.state.progress.careers, this.backend.seedCareers(this.state.agents.filter((a) => a.role !== 'ceo').map((a) => a.id), Date.now()));

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
      this.previews.clearOrphans(this.state.repos).then(() => this.sweepOrphans(true)),
    ]);
    for (const r of this.state.repos) void this.previews.refreshDefault(r);
    // A fresh demo office opens with floor 1's app running; the others' stay stopped until started (#129).
    if (seeded && this.state.repos[0]) void this.startPreview(this.state.repos[0].id).catch(() => undefined);
    for (const p of seeded ? (this.backend.demoParked?.() ?? []) : []) await this.seedParked(p.fullName, p.prNumber, p.stuck); // a CI outage's banner (#191)
    void this.cleanPreviews();
    await this.health.tick(); // resumed sessions are admitted against real memory
    this.finishRestart(restart);
    // A PR the restart left in "testing" with nobody on it: test it again (the result, if any, was lost).
    for (const rec of orphanedQa(this.state.qa, this.state.agents, BUSY)) this.setQa(rec, { status: 'queued', qaAgentId: null });
    if (this.state.prLimits < PR_LIMITS_VERSION) this.catchUpPrs();
    if (!this.state.outageReleased) this.releaseOutageStuck();
    if (!this.state.stuckReleased) this.releaseStuck();
    this.officeHead = await this.backend.office.head();
    const updated = await this.backend.office.takeLastUpdate().catch(() => null);
    if (updated) await this.reportUpdate(updated);
    const held = seeded ? this.backend.demoHeldUpdate?.() : undefined;
    if (held) this.postUpdateNotice(held, null);
    setInterval(() => this.state.repos.forEach((r, i) => setTimeout(() => void this.syncRepo(r.id), i * 1500)), SYNC_INTERVAL_MS);
    setInterval(() => (this.schedule(), this.hybridTick()), SCHEDULER_INTERVAL_MS);
    setInterval(() => this.sweepPreviews(), 5_000);
    setInterval(() => void this.saveTerminals(), TERMINAL_SAVE_MS);
    // Every minute in the demo, so a short idle time shows its phone message soon.
    setInterval(() => {
      void this.trimIdleDesks();
      void this.cleanPreviews();
      void this.voice.prune();
      void this.journal.prune().catch((err) => console.warn('could not prune the journal', err));
      void this.spend.ledger.prune();
      void this.sweepHistory();
      void this.lab.checkSurvival((id) => this.state.repos.find((r) => r.id === id)?.fullName ?? null, (name, since) => this.backend.survivalSignals(name, since));
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
    setInterval(() => (this.notifyStuck(), this.watchDefaults()), 60_000); // watchDefaults: a default back from its limit (#390)
    setInterval(() => this.syncDecisions(), 60_000); // issues closing, agents leaving, old ones archived, the digest
    setInterval(() => (this.watchdogTick(), void this.sweepOrphans()), WATCHDOG_MS);
    setInterval(() => void this.health.tick(), 10_000);
    this.recheckClis();
    void Promise.all([this.refreshTooling(), this.startModels()]); // Tools & skills, and the model catalog (#198)
    await this.journal.start();
    await this.spend.ledger.load().then(() => backfillWork(this.state.progress, this.spend.ledger.all(), this.state.agents)); // careers from before #205
    await this.history.load();
    this.state.ceo.researchedAt ??= pastResearch({ history: this.history.all(), jobs: this.state.ceo.jobs ?? [], messages: this.state.messages }); // research from before #496
    void this.sweepHistory();
    // A fresh demo office has a month of spending to look at (the first sync may have written its merges already).
    if (this.backend.demo && !this.spend.ledger.all().some((r) => r.type === 'session') && this.backend.seedCosts) {
      void this.seedCareerPast(this.backend.seedCosts(this.state.repos, this.state.agents, Date.now())); // and the careers' past (#205)
      for (const r of this.state.repos) this.seedCharterLog(r); // and the Charter tab's numbers over it
    }
    if (this.backend.demo && !this.state.experiments.assignments.length && this.backend.seedLab) this.state.experiments = this.backend.seedLab(this.state.repos, Date.now()); // and an experiment with results
    if (this.backend.demo && !this.state.notices.length && this.backend.seedNotices) this.state.notices = this.backend.seedNotices(this.state.repos, this.state.agents, Date.now()); // and a day of notifications
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
  protected recover(agents: PersistedAgent[], preparing: Set<PersistedAgent>, requeue = new Set<PersistedAgent>(), counts: RestartCounts = { cleared: 0, reattached: 0, resumed: 0, requeued: 0 }, why = 'The office server restarted') {
    for (const a of agents) {
      if (!a.task) continue; // its issue or PR closed while the office was down: the startup sync cleared the desk
      const fix = a.task === 'fix' ? this.state.qa.find((q) => q.devAgentId === a.id && q.status === 'fixing') : undefined;
      if (requeue.has(a) || !resumesAfterRestart(a, preparing.has(a), this.backend.demo)) {
        this.appendLog(a, [{ kind: 'system', text: `↺ ${why}. Starting over from the queue.` }]);
        const rec = a.task === 'qa' ? this.state.qa.find((q) => q.qaAgentId === a.id && q.status === 'testing') : undefined;
        if (rec) this.setQa(rec, { status: 'queued' });
        if (fix) this.setQa(fix, { status: 'failed' });
        this.clearTask(a);
        counts.requeued++;
        continue;
      }
      if (this.slotsFull()) continue; // stays 'stopped'; the manager can resume it later
      if (this.health.later(a.id, sessionKind(a), why)) continue; // stays 'stopped' until memory is back
      counts.resumed++;
      void this.message(a.id, resumeNote(a, fix, why)).catch((err) => console.warn(`could not resume ${a.name}`, err));
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
  async message(id: string, text: string, typed = false, who = 'Manager') {
    const a = this.agent(id);
    if (a.role === 'ceo') return this.messageCeo(text);
    const repo = this.repo(a.repoId);
    if (!text.trim()) throw new HttpError(400, 'Empty message');
    const rt = this.agentRt.get(id)!;
    if (rt.session) {
      this.appendLog(a, [{ kind: 'manager', text: `▶ ${who}: ${text}` }]);
      this.chatSay(a, text, who);
      if (!typed) rt.session.send(text);
      return;
    }
    if (a.status === 'preparing') throw new HttpError(409, `${a.name} is still setting up; try again in a moment`);
    if (!a.sessionId || !a.branch || a.task === 'qa') throw new HttpError(409, `${a.name} has no session to continue. Give them an issue or a PR to test instead.`);
    this.ensureSlot(sessionKind(a), a);
    this.appendLog(a, [{ kind: 'manager', text: `▶ ${who}: ${text}` }]);
    this.chatSay(a, text, who);
    const cwd = this.deskOf(a, repo);
    a.lastError = null;
    a.startedAt = Date.now();
    if (a.task === null) a.task = 'issue';
    const fixing = a.task === 'fix' && a.prNumber ? { pr: a.prNumber, headRef: a.branch } : undefined;
    this.startAgentSession(a, repo, cwd, text, this.buildSystemAppend(a, repo, cwd, a.branch, fixing), a.sessionId, undefined, typed ? 'typed' : null);
  }

  /** POST /api/notices/read: these notices (no ids: all of them) are read, in every tab. */
  readNotices(ids: unknown) {
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > NOTICES_KEEP || ids.some((x) => typeof x !== 'string'))) throw new HttpError(400, 'ids must be a list of notice ids');
    const before = this.state.notices;
    this.state.notices = markRead(before, (ids as string[] | undefined) ?? null);
    const read = this.state.notices.filter((n, i) => n !== before[i]).map((n) => n.id);
    if (!read.length) return;
    this.broadcast({ type: 'noticesRead', ids: read });
    this.save();
  }

  // ---------- the CEO chat (#51) ----------

  /** The chat's live reply, conversations and the manager's notes, for the snapshot. */
  protected chatView(): CeoChatView {
    return { live: this.ceoChat.live, current: this.state.ceo.chats.current, conversations: conversationsView(this.state.ceo.chats), memory: this.state.ceo.remember };
  }

  private lastManagerMessage() {
    return [...this.state.messages].reverse().find((m) => m.from === 'manager');
  }

  /** A manager's message as the CEO gets it: with the message it replies to, and its files. */
  private forwardOf(m: PhoneMessage) {
    const quoted = m.replyTo === undefined ? undefined : this.state.messages.find((x) => x.id === m.replyTo);
    return [projectLine(this.state.ceo.chats, this.state.messages, m, this.state.repos), forwardText(m.text, quoted), this.ceoFiles.forwardLines(m.attachments ?? [])].filter(Boolean).join('\n');
  }

  /** POST /api/ceo/stop: ends the CEO's job. Tools it called stay done (the office finishes them); its reply says what they did. */
  async stopCeo() {
    const a = this.ceo();
    if (!BUSY.includes(a.status)) throw new HttpError(409, `${a.name} isn't working on anything right now.`);
    const log = finishedLog(this.ceoChat.live, Date.now());
    this.stopAgent(a.id);
    this.ceoChat.endJob();
    const calls = await this.ceoChat.settled(STOP_SETTLE_MS);
    const actions = this.ceoChat.turnActions(calls);
    this.postMessage('ceo', stopReply(calls), undefined, { ...(log && { log }), ...(actions.length && { actions }) });
    this.markDelivery('all', 'replied');
  }

  /**
   * POST /api/ceo/messages/:id/edit: any of the manager's messages, its text replaced (#125). Still queued, the job takes
   * the new text; their last one is asked again (an answer to the old version stops); an earlier one comes as a note.
   */
  editMessage(id: number, text: string) {
    const t = text.trim().slice(0, 4000);
    if (!t) throw new HttpError(400, 'Write the message first.');
    const m = this.state.messages.find((x) => x.id === id && x.from === 'manager');
    if (!m) throw new HttpError(404, 'That message is no longer in this conversation.');
    if (m.text === t) return;
    const [before, forward] = [m.text, this.forwardOf(m)];
    const c = this.state.ceo;
    const queued = c.queue.find((j) => j.kind === 'chat' && j.messageIds?.includes(id));
    const how = editDelivery({ queued: !!queued, last: this.lastManagerMessage()?.id === id });
    if (!queued) m.delivery = 'sent';
    this.replaceText(m, t);
    if (queued) return void (queued.text = queued.text?.includes(forward) ? queued.text.replace(forward, () => this.forwardOf(m)) : this.forwardOf(m));
    const say = how === 'reask' ? `The manager edited their last message. Answer this version instead:\n${this.forwardOf(m)}` : editNote(id, before, t);
    const rt = this.agentRt.get(CEO_ID);
    if (how === 'reask' && c.job?.messageIds?.includes(id)) this.stopAgent(CEO_ID);
    else if (rt?.session && messageGoesIn({ now: Date.now(), pausedUntil: this.pausedUntil, job: c.job?.kind ?? null, session: true })) return rt.session.send(say); // like messageCeo: a background job is preempted instead
    this.enqueueCeo({ kind: 'chat', text: say, messageIds: [id], at: Date.now() });
  }

  /** POST /api/ceo/retry: the CEO answers the manager's last message afresh (its answer failed, or missed). */
  retryCeo() {
    const c = this.state.ceo;
    if (c.job?.kind === 'chat' || c.queue.some((j) => j.kind === 'chat')) throw new HttpError(409, `${this.ceo().name} is already on your message: wait for the reply, or stop it first.`);
    const m = this.lastManagerMessage();
    if (!m) throw new HttpError(409, 'Nothing to retry yet: send a message first.');
    this.enqueueCeo({ kind: 'chat', text: `The manager asked you to try again: answer their last message afresh.\n${this.forwardOf(m)}`, messageIds: [m.id], at: Date.now() });
  }

  /** Switching conversations waits for a reply on its way: it belongs to the one it was asked in. Background jobs don't hold it. */
  private chatFree() {
    const c = this.state.ceo;
    const replying = (j: CeoJob | null) => j?.kind === 'chat' || j?.kind === 'research';
    if (replying(c.job) || c.queue.some(replying)) throw new HttpError(409, `${this.ceo().name} is still answering you: wait for the reply, or stop it, before switching conversations.`);
  }

  /** The phone shows another conversation's thread, and the CEO carries on that conversation's session (null: a fresh one). */
  private switchThread(messages: PhoneMessage[], sessionId: string | null) {
    this.state.messages = messages;
    Object.assign(this.ceo(), { sessionId, sessionCli: sessionId ? 'claude' : null, sessionAccount: undefined });
    this.state.ceo.kept = { turns: 0, costUsd: 0, startedAt: null, lastEndedAt: null }; // the kept session's count starts over (#65)
    this.broadcast({ type: 'ceoChat', ...latestPage(messages), ...this.chatView() });
    this.save();
  }

  /** POST /api/ceo/conversations: a new conversation, with a fresh CEO session, in a floor's project (`repoId`) or the Company's; the CEO's notes carry over. */
  async newConversation(repoId: unknown = null) {
    this.chatFree();
    const s = this.state.ceo.chats, project = typeof repoId === 'string' ? repoId : null;
    if (project && !this.state.repos.some((r) => r.id === project)) throw new HttpError(400, 'That floor is no longer in the office.');
    if (this.state.messages.length) {
      await this.ceoChat.saveThread(s.current, this.state.messages);
      void this.ceoChat.dropThreads(startConversation(s, this.ceo().sessionId, Date.now(), project));
    } else editConversation(s, currentConversation(s).id, { repoId: project });
    this.switchThread([], null);
    return { id: s.current };
  }

  /** POST /api/ceo/conversations/:id/open: carries on an earlier conversation. */
  async openConversation(id: string) {
    const s = this.state.ceo.chats;
    if (id === s.current) return;
    this.chatFree();
    if (!s.list.some((c) => c.id === id)) throw new HttpError(404, 'That conversation is no longer saved.');
    const thread = await this.ceoChat.loadThread(id);
    await this.ceoChat.saveThread(s.current, this.state.messages);
    this.switchThread(thread, openConversation(s, id, this.ceo().sessionId));
  }

  /** GET /api/ceo/conversations/search?q=: conversations whose title or messages match, with a snippet each. */
  async searchConversations(q: string) {
    const s = this.state.ceo.chats;
    const threads = new Map<string, PhoneMessage[]>();
    await Promise.all(s.list.map(async (c) => threads.set(c.id, c.id === s.current ? this.state.messages : await this.ceoChat.loadThread(c.id))));
    return { hits: searchConversations(conversationsView(s), threads, q.slice(0, 200)) };
  }

  /** GET /api/ceo/notes: the CEO's NOTES.md, for "What the CEO remembers" (read-only). */
  ceoNotes() {
    return this.ceoChat.notes();
  }

  /** The manager's pinned notes, saved through `change` (shared/ceoMemory.ts), which throws what to fix. */
  private changeMemory(change: (notes: MemoryNote[]) => MemoryNote[]) {
    try {
      this.state.ceo.remember = change(this.state.ceo.remember);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    this.broadcast({ type: 'ceoChat', memory: this.state.ceo.remember });
    this.save();
  }

  addMemory(text: string) {
    this.changeMemory((n) => saveNote(n, text, Date.now()));
  }

  editMemory(id: string, text: string) {
    this.changeMemory((n) => saveNote(n, text, Date.now(), id));
  }

  deleteMemory(id: string) {
    this.changeMemory((n) => removeNote(n, id));
  }

  updateSettings(patch: Partial<SwarmSettings>) {
    const s = this.state.settings;
    if (patch.sessionLimit !== undefined) s.sessionLimit = Math.max(0, Math.round(Number(patch.sessionLimit)) || 0);
    if (patch.memory !== undefined) s.memory = memorySettings(s.memory, patch.memory);
    if (patch.testLab !== undefined) s.testLab = testLabSettings(s.testLab, patch.testLab);
    // The default model belongs to the default coding agent: a new agent starts on its own default.
    if (isCli(patch.defaultCli) && builderCli(patch.defaultCli) && patch.defaultCli !== s.defaultCli) { // Gemini CLI isn't a builder (#365)
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
    if (patch.researchMin !== undefined) s.researchMin = clampResearchMin(patch.researchMin);
    if (patch.ceoFollowups !== undefined) s.ceoFollowups = followupSettings(s.ceoFollowups, patch.ceoFollowups);
    if (patch.ceoMandates !== undefined) s.ceoMandates = mandateList(patch.ceoMandates);
    if (patch.ceoAwake !== undefined) s.ceoAwake = ceoAwakeSettings(s.ceoAwake, patch.ceoAwake);
    if (patch.rotation !== undefined) s.rotation = rotationSettings(s.rotation, patch.rotation);
    if (typeof patch.managerName === 'string') s.managerName = patch.managerName.trim().slice(0, 40);
    if (typeof patch.companyName === 'string') s.companyName = patch.companyName.trim().slice(0, 60);
    if (typeof patch.dogName === 'string') s.dogName = patch.dogName.trim().slice(0, 24) || DEFAULT_DOG_NAME;
    if (typeof patch.projectsDir === 'string' && patch.projectsDir.trim()) s.projectsDir = path.resolve(patch.projectsDir.trim());
    if (typeof patch.setupDone === 'boolean') s.setupDone = patch.setupDone;
    if (patch.tutorialStep !== undefined) s.tutorialStep = Math.max(-1, Math.round(Number(patch.tutorialStep)) || 0);
    for (const k of ['autoUpdate', 'statusReactions', 'itDesk'] as const) if (typeof patch[k] === 'boolean') s[k] = patch[k];
    if (patch.updateSettleMin !== undefined) s.updateSettleMin = settleMinutes(patch.updateSettleMin);
    this.pacingSettings(patch);
    this.itSettings(patch);
    if (patch.stuckRecheckMin !== undefined) s.stuckRecheckMin = clampStuckRecheckMin(patch.stuckRecheckMin);
    if (patch.trimIdleDesksMin !== undefined) {
      s.trimIdleDesksMin = clampTrimIdleMin(patch.trimIdleDesksMin);
      setTimeout(() => void this.trimIdleDesks(), 1000);
    }
    this.previewSettings(patch);
    if (typeof patch.dailyLogDir === 'string') s.dailyLogDir = patch.dailyLogDir.trim() ? path.resolve(patch.dailyLogDir.trim()) : '';
    if (patch.historyDays !== undefined) {
      s.historyDays = clampHistoryDays(patch.historyDays);
      setTimeout(() => void this.sweepHistory(), 500);
    }
    if (patch.voice !== undefined) {
      const was = s.voice;
      s.voice = voiceSettings(was, patch.voice);
      this.voiceSettingsChanged(was);
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
      this.telegram.refresh(); // the switch: Off stops reading the bot at once, On resumes it
    }
    if (patch.everyProject !== undefined) {
      try {
        s.everyProject = everyProjectSettings(s.everyProject, patch.everyProject);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
      for (const r of this.state.repos) if (this.repoRt.has(r.id)) this.emitRepo(r); // what each floor runs with changed
    }
    if (patch.tools !== undefined) s.tools = toolSettings(s.tools, patch.tools);
    if (patch.officePlaybook !== undefined) this.setOfficePlaybook(patch.officePlaybook);
    if (patch.cloud !== undefined) {
      const next: CloudSettings = cloudSettings(s.cloud, patch.cloud);
      if (next.machineKind !== 'local' && !this.cloud.boxApi()) throw new HttpError(400, 'Save your Upstash Box API key first: cloud agents run in your Upstash account.');
      s.cloud = next;
    }
    this.save();
    this.broadcast({ type: 'settings', settings: s });
    this.emitCeo();
    setTimeout(() => this.schedule(), 200);
    return s;
  }

  /**
   * The manager's one tap in an experiment's results (#24): a variant's practice switches become every project's
   * default (Settings → Every project). Only the manager does this; the CEO can suggest it.
   */
  adoptPractices(id: unknown, variant: unknown) {
    const { experiment, variant: v, summary } = this.lab.variant(id, variant);
    this.updateSettings({ everyProject: { ...this.state.settings.everyProject, practices: { ...this.state.settings.everyProject.practices, ...v.settings.practices } } });
    this.postMessage('office', `📌 Every project now runs with ${describePractices(v.settings.practices!)}, from "${experiment.name}" (${v.name}). The evidence: ${summary}.`);
    return this.state.settings;
  }

  /** The demo's objective log over its made-up ledger (#105), next to what its syncs logged already. */
  private seedCharterLog(r: PersistedRepo) {
    const log = r.charter.log;
    const sample = this.backend.seedCharterLog?.(r.charter, this.spend.ledger.all().filter((x) => x.repoId === r.id), Date.now());
    if (!sample) return;
    log.tags = { ...sample.tags, ...log.tags };
    log.merged = [...log.merged, ...sample.merged.filter((m) => !log.merged.some((x) => x.pr === m.pr))].sort((a, b) => b.at - a.at);
    log.checks = [...log.checks, ...sample.checks].sort((a, b) => b.at - a.at);
    this.refreshInsights(r);
    this.emitRepo(r);
  }

  /** The history's sweep (#49): past the retention goes, and finished days get their totals in the daily log. */
  private sweepHistory() {
    return this.history.sweep(this.state.settings.historyDays, readingsLabel(this.state.claudeUsage, Date.now(), this.usageCheck)).catch((err) => console.warn('could not sweep the session history', err));
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
}
