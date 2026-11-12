// The office's state and its plumbing: the persisted state and runtimes, views and the snapshot, the tabs on /ws, the state file, lookups.
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { WebSocket } from 'ws';
import type { Backend } from '../backend.ts';
import type { LogEntry } from '../agentRunner.ts';
import { BoxMachines } from '../boxMachines.ts';
import { Cloud, officeId } from '../cloud.ts';
import { DEFAULT_PROJECTS_DIR, HOME_DIR, LOG_BUFFER, PUBLIC_DEMO, PR_PREVIEW_IDLE_MIN, PUBLIC_DEMO_RESET_H, STATE_FILE, VERSION } from '../config.ts';
import { IssueCap } from '../ceo.ts';
import { DEFAULT_RESEARCH_MIN, ResearchGuard } from '../research.ts';
import type { PrepStrikes } from '../handOut.ts';
import { HttpError } from '../httpError.ts';
import { IssueAges } from '../issueAges.ts';
import { PR_LIMITS_VERSION } from '../prOwnership.ts';
import { Previews } from '../previews.ts';
import { addFreed, mainKey, previewSettings, prKey } from '../prTheatre.ts';
import { DEFAULT_PACING_SESSIONS } from '../pacing.ts';
import { emptyHistory } from '../metrics.ts';
import { DEFAULT_TRIM_IDLE_MIN } from '../deskTrim.ts';
import { boxVersions } from '../clis.ts';
import { machineName, type MachineProvider } from '../machines.ts';
import { MACHINES_DIR } from '../workspace.ts';
import { envSecrets, Journal } from '../journal.ts';
import { CostLedger, SessionCosts, type CostRun } from '../costLedger.ts';
import { dailyLogDir, MACHINE_DAILY_DIR, SessionHistory } from '../history.ts';
import { stuckSince } from '../../shared/approvals.ts';
import { DEFAULT_HISTORY_DAYS, historyId, type HistoryEntry } from '../../shared/history.ts';
import type { CostSession } from '../../shared/costs.ts';
import { Lab, loadLab } from '../experiments.ts';
import { FloorPractice } from '../practiceState.ts';
import { effectivePractices, emptyEveryProject, floorLeases, predictFiles, type Lease } from '../../shared/practices.ts';
import { sampleDay, seeded } from '../journalSample.ts';
import { emptyLedger, packCareers, pastCareers } from '../ledger.ts';
import { DEFAULT_MEMORY, memorySettings, OfficeHealth, sessionKind } from '../health.ts';
import { DEFAULT_TEST_LAB, testLabSettings } from '../../shared/testLab.ts';
import { Ticker } from '../ticker.ts';
import { isResync, Outbox, snapshotAgent } from '../outbox.ts';
import { DEFAULT_LISTEN, DEFAULT_VOICE, Voice } from '../voice.ts';
import { Notifier } from '../notifier.ts';
import { TelegramBot } from '../telegramBot.ts';
import { DEFAULT_NOTIFY, notifySettings } from '../../shared/notify.ts';
import { addNotice, makeNotice, type NoticeInput } from '../../shared/notices.ts';
import { DEFAULT_CLOUD } from '../../shared/cloud.ts';
import { DEFAULT_TOOL_SETTINGS, EMPTY_INVENTORY, officeItems, type ToolInventory } from '../../shared/tooling.ts';
import { agentActivity, lineActivity, sameActivity, stuckSign, type SeenActivity } from '../../shared/activity.ts';
import { WeatherService } from '../weather.ts';
import { dayKey, journalFrame, redact } from '../../shared/journal.ts';
import { DEFAULT_FOLLOWUPS, emptyFollowups, followupSettings } from '../../shared/followups.ts';
import { emptyChanges } from '../../shared/managerChanges.ts';
import { DEFAULT_WEATHER, DEFAULT_WORLD_EVENTS } from '../../shared/outside.ts';
import { DEFAULT_THEME_SETTINGS } from '../../shared/themes.ts';
import { DEFAULT_DOG_NAME, DEFAULT_MAX_AGENTS, DEFAULT_OFFICE_PLAYBOOK } from '../../shared/types.ts';
import { latestPage } from '../../shared/chatPage.ts';
import { CeoFiles } from '../ceoFiles.ts';
import { consultSessions, type Consult } from '../consult.ts';
import { DEFAULT_CEO_AWAKE } from '../../shared/ceoAwake.ts';
import { IT_DEPT_DEFAULTS, loadIt } from '../../shared/itDept.ts';
import { FileStore } from '../files.ts';
import type {
  AgentActivity,
  AgentView,
  CliView,
  ModelCatalogView,
  LogLine,
  MachineHost,
  NotifyEvent,
  PreviewStatsView,
  QaView,
  RepoView,
  ServerEvent,
  UsageCheckError,
  WorldSnapshot,
} from '../../shared/types.ts';
import {
  type PersistedRepo,
  type PersistedAgent,
  type QaRecord,
  type Persisted,
  type AgentRuntime,
  type RepoRuntime,
  DEFAULT_MODEL,
  CEO_DIR,
  FILES_DIR,
  MAX_ISSUES_PER_JOB,
  BUSY,
  OPS_EVENTS,
  oneLine,
  type SignIn,
} from './model.ts';
import { charterView } from '../../shared/charter.ts';
import { charterInsights } from '../../shared/charterStats.ts';
import { cleanTerminalText } from '../../shared/terminalText.ts';
import { slugify } from './flavour.ts';
import { SwarmContract } from './contract.ts';

export abstract class SwarmCore extends SwarmContract {
  protected state: Persisted = {
    settings: {
      sessionLimit: 0,
      memory: memorySettings(DEFAULT_MEMORY, {}),
      testLab: testLabSettings(DEFAULT_TEST_LAB, {}),
      defaultModel: DEFAULT_MODEL,
      defaultEffort: 'medium',
      taskEffort: {},
      runtime: 'terminal',
      defaultCli: 'claude',
      scaling: 'approve',
      maxAgents: DEFAULT_MAX_AGENTS,
      ceoHeartbeatMin: 60,
      researchMin: DEFAULT_RESEARCH_MIN,
      ceoFollowups: followupSettings(DEFAULT_FOLLOWUPS, {}),
      ceoMandates: [],
      ceoAwake: { ...DEFAULT_CEO_AWAKE },
      itDept: { ...IT_DEPT_DEFAULTS },
      managerName: '',
      companyName: '',
      dogName: DEFAULT_DOG_NAME,
      projectsDir: DEFAULT_PROJECTS_DIR,
      setupDone: false,
      tutorialStep: 0,
      autoUpdate: true,
      pacingSessions: DEFAULT_PACING_SESSIONS,
      trimIdleDesksMin: DEFAULT_TRIM_IDLE_MIN,
      ...previewSettings({}, {}, PR_PREVIEW_IDLE_MIN), // the chip window, idle stops and max lifetime (#204, #252)
      dailyLogDir: '',
      historyDays: DEFAULT_HISTORY_DAYS,
      voice: { ...DEFAULT_VOICE },
      themes: DEFAULT_THEME_SETTINGS,
      weather: { ...DEFAULT_WEATHER },
      worldEvents: { ...DEFAULT_WORLD_EVENTS },
      listen: { ...DEFAULT_LISTEN },
      notify: notifySettings(DEFAULT_NOTIFY, {}),
      cloud: { ...DEFAULT_CLOUD },
      tools: DEFAULT_TOOL_SETTINGS,
      everyProject: emptyEveryProject(),
      statusReactions: false,
      officePlaybook: DEFAULT_OFFICE_PLAYBOOK,
    },
    repos: [],
    agents: [],
    qa: [],
    requests: [],
    ceo: { queue: [], job: null, lastReviewAt: null, lastFingerprint: null, followups: emptyFollowups(), changes: emptyChanges(), kept: { turns: 0, costUsd: 0, startedAt: null, lastEndedAt: null }, chats: { current: '', list: [] }, remember: [] }, // chats: the first conversation starts on first use
    messages: [],
    phoneReadAt: 0,
    notices: [],
    prLimits: PR_LIMITS_VERSION,
    outageReleased: true,
    ops: emptyHistory(),
    held: [],
    progress: emptyLedger(),
    pong: {},
    officeId: officeId(),
    claudeUsage: [],
    questions: [], decisions: { list: [], digestAt: 0 }, taskAccounts: {}, itDesk: { waiting: [], log: [] }, it: loadIt(undefined), itTickets: { seq: 0, list: [] },
    experiments: loadLab(undefined, Date.now()),
  };
  /** The chat's files store; every change goes out to the tabs as a `files` event. */
  readonly files = new FileStore(FILES_DIR, () => this.broadcast({ type: 'files', files: this.files.list() }));
  protected ceoFiles = new CeoFiles(this.files, CEO_DIR);

  protected ceoIssues = new IssueCap(MAX_ISSUES_PER_JOB); // issues filed during the current CEO job
  protected ceoAsked = false; // the manager asked for work in the current CEO job (a plan, or a message): only then are issues filed
  protected researchGuard = new ResearchGuard(); // the running research job's time budget
  protected consults: Consult[] = []; // the CEO's consults (#28), queued and running, oldest first
  protected messageSeq = 1;
  protected usageCheck: UsageCheckError | null = null; // the office's last idle check of Claude's usage failed (#89)
  protected agentRt = new Map<string, AgentRuntime>();
  protected seenActivity = new Map<string, SeenActivity>(); // agent id -> their latest action in the log
  protected shownActivity = new Map<string, AgentActivity | null>(); // agent id -> the activity clients last heard
  protected ticker = new Ticker({
    name: (id) => this.state.agents.find((a) => a.id === id)?.name ?? null,
    author: (repoId, pr) => this.state.agents.find((a) => a.repoId === repoId && a.role !== 'ceo' && a.task !== 'qa' && a.prNumber === pr)?.name ?? null,
  });
  protected repoRt = new Map<string, RepoRuntime>();
  protected issueAges = new IssueAges(); // when the issues behind recent merges were filed, for the whiteboard
  protected deskAlerts = new Map<string, string>(); // agent id -> the desk setup error the manager was last told about
  protected prepStrikes = new Map<string, PrepStrikes>(); // `${repoId}#${pr}:${task}` -> its desks that couldn't be set up
  protected dropping = new Map<string, string>(); // agent id -> why their task's issue or PR closed: the desk clears once the session ends
  // Everything sent to the tabs on /ws: agent and floor changes batched as patches, terminal lines only where shown.
  protected outbox = new Outbox({
    agents: () => this.state.agents.map((a) => ({ id: a.id, floor: this.floorOf(a) })),
    log: (id) => this.agentRt.get(id)?.log ?? [],
    chat: (id) => this.agentRt.get(id)?.chat?.items ?? [],
    beforeFlush: (ids) => this.updateSigns(ids),
  });
  protected user: string | null = null;
  protected ghError: string | undefined;
  protected saveTimer: NodeJS.Timeout | null = null;
  protected writing: Promise<void> = Promise.resolve(); // state file writes, one at a time: they share its temp file
  protected logSeq = 1;
  private noticeSeq = 0;
  protected previews: Previews;
  protected officeHead: string | null = null; // the commit the office runs (null: not a git checkout, so no self-update)
  protected officeUpdate = {
    behind: 0,
    requested: false,
    postponedUntil: null as number | null,
    postponedBehind: 0,
    failed: null as string | null,
    failedBehind: null as number | null,
    drainingSince: null as number | null,
    sent: false,
    cutOff: new Set<string>(), // agents whose sessions the hand-over stopped: recovered like after a restart
  };
  protected lastOfficeView = '';
  protected clis: CliView[] = []; // coding-agent CLIs found on this machine (detected at startup)
  protected models: ModelCatalogView = { entries: [], checkedAt: 0 }; // their models (#198): the cache at startup, then read
  protected tooling: ToolInventory = { ...EMPTY_INVENTORY, items: officeItems() }; // Tools & skills (scanned at startup and on demand)
  /** Phone messages read aloud. The demo keeps its own key and clips, so it never touches the real ones. */
  readonly voice: Voice;
  /** The real local weather (Settings → Weather), read by the server so it's cached and survives a restart. */
  readonly weather: WeatherService;
  /** What the office looked like over the last week, for the time-lapse replay. The demo keeps its own. */
  readonly journal: Journal;
  protected readonly envSecrets = envSecrets(process.env);
  /** Notifications to the manager's devices and chat apps (docs/pocket.md). The demo's only log what they'd send. */
  readonly notifier: Notifier;
  /** The manager's own Telegram bot: notifications, the CEO chat both ways, team-change buttons. The demo's is fake. */
  readonly telegram: TelegramBot;
  /** Settings → Cloud agents: the Upstash account and what cloud agents sign in with (docs/cloud.md). The demo's is fake. */
  readonly cloud: Cloud;
  /** Cloud agents' machines: an Upstash Box each. */
  protected boxMachines: BoxMachines;
  /** Cloud agents waiting for a sign-in in their terminal (holdForSignIn), by agent id. */
  protected signIns = new Map<string, SignIn>();
  protected toldStuck = new Set<string>(); // `${agentId}:${endedAt}`: agents in an error the manager was notified about
  readonly health = new OfficeHealth({
    probe: () => this.backend.resources,
    settings: () => this.state.settings.memory,
    sessions: () => [...this.state.agents.filter((a) => BUSY.includes(a.status) && a.host !== 'box').map((a) => ({ id: a.id, kind: sessionKind(a), startedAt: a.startedAt ?? 0, dir: a.role === 'ceo' ? CEO_DIR : a.machine ? this.deskOf(a, this.repo(a.repoId)) : null })), ...consultSessions(this.consults), ...this.labSessions()],
    log: (id, text) => this.state.agents.filter((a) => a.id === id).forEach((a) => this.appendLog(a, [{ kind: 'error', text }])),
    alert: (title, body) => this.notifier.notify('memory', title, body),
    emit: (health) => this.broadcast({ type: 'health', health }),
    save: () => this.save(),
    retry: (id, why, requeue) => this.state.agents.filter((a) => a.id === id && a.status === 'stopped' && a.task).forEach((a) => this.recover([a], new Set(), new Set(requeue ? [a] : []), undefined, why)),
    schedule: () => this.schedule(),
    previews: () => this.previews.running(),
    stopPreview: (key) => this.previews.stopIdle(key),
    previewMem: (memMb) => this.setPreviewStats({ memMb }),
  });
  /** Where the Claude plan goes (#18): a line per finished session and merged PR. Never in the state file. */
  protected spend: SessionCosts;
  /** The daily work log and session history (#49): an entry per finished session and merge, transcripts kept. */
  readonly history: SessionHistory;
  /** The experiments (#23): the variant each new issue in one gets, and what came of it. */
  readonly lab = new Lab(() => this.state.experiments, { save: () => this.save(), emit: (experiments) => this.broadcast({ type: 'experiments', experiments }), floorOk: (id) => this.state.repos.some((r) => r.id === id) });

  constructor(protected backend: Backend) {
    super();
    this.weather = new WeatherService({
      api: backend.weather,
      file: path.join(HOME_DIR, backend.demo ? 'demo-weather.json' : 'weather.json'),
      settings: () => this.state.settings.weather,
      changed: (weather) => this.broadcast({ type: 'weather', weather }),
      log: (line) => console.log(line),
    });
    this.voice = new Voice({
      api: backend.voice,
      secretsFile: path.join(HOME_DIR, backend.demo ? 'demo-secrets.json' : 'secrets.json'),
      cacheDir: path.join(HOME_DIR, backend.demo ? 'demo-voice' : 'voice'),
      settings: () => this.state.settings.voice,
      listen: () => this.state.settings.listen,
      messages: () => this.state.messages,
      officeNote: (text) => this.postMessage('office', text),
      keyChanged: (view) => this.voiceKeyChanged(view),
      cacheChanged: (voiceCache) => this.broadcast({ type: 'voiceCache', voiceCache }),
      log: (line) => console.log(line),
    });
    this.spend = new SessionCosts(new CostLedger(path.join(HOME_DIR, backend.demo ? 'demo-costs.jsonl' : 'costs.jsonl')), () => this.limited(), (line, run) => { this.lab.session(line); this.logSession(line, run); this.careerWork(line); this.usageSharesSoon(); });
    // The machine's daily log folder only for the real office: never from the demo or the tests.
    const machineDir = !backend.demo && !process.env.VITEST && existsSync(MACHINE_DAILY_DIR) ? MACHINE_DAILY_DIR : null;
    this.history = new SessionHistory({
      dir: path.join(HOME_DIR, backend.demo ? 'demo-history' : 'history'),
      dailyDir: () => dailyLogDir(this.state.settings.dailyLogDir, { demo: backend.demo, home: HOME_DIR, machineDir }),
      secrets: () => this.secrets(),
    });
    this.journal = new Journal({
      dir: path.join(HOME_DIR, backend.demo ? 'demo-journal' : 'journal'),
      frame: () => journalFrame(this.snapshot(), this.secrets()),
      secrets: () => this.secrets(),
    });
    this.telegram = new TelegramBot({
      api: backend.telegram,
      // As the demo's cloud: a file of its own, as its tests run beside the notifier's, which share demo-secrets.json.
      secretsFile: path.join(HOME_DIR, backend.demo ? 'demo-telegram-secrets.json' : 'secrets.json'),
      on: () => this.state.settings.notify.channels.telegram,
      message: async (text, id) => void (await this.messageCeo(text, undefined, 'telegram', [], id)),
      decide: (verdict, id) => this.decideFromTelegram(verdict, id),
      changed: () => this.notifier.refresh(),
      log: (line) => console.warn(line),
    });
    this.notifier = new Notifier({
      transport: backend.notify,
      secretsFile: path.join(HOME_DIR, backend.demo ? 'demo-secrets.json' : 'secrets.json'),
      pushFile: path.join(HOME_DIR, backend.demo ? 'demo-push.json' : 'push.json'),
      settings: () => this.state.settings.notify,
      broadcast: (note) => this.broadcast({ type: 'notify', note }),
      channelsChanged: (notifyChannels) => this.broadcast({ type: 'notifyChannels', notifyChannels }),
      log: (line) => console.warn(line),
      telegram: {
        linked: () => this.telegram.linked(),
        mirrors: () => this.mirrorsToTelegram(),
        send: (text, keyboard) => this.telegram.send(text, keyboard),
        view: () => this.telegram.view(),
      },
      quiet: (messageIds) => this.markQuiet(messageIds),
      cleared: (events) => this.broadcast({ type: 'notifyClear', events }),
    });
    this.cloud = new Cloud({
      // The demo's fake cloud keeps a file of its own: its tests run beside the notifier's, which share demo-secrets.json.
      secretsFile: path.join(HOME_DIR, backend.demo ? 'demo-cloud-secrets.json' : 'secrets.json'),
      env: backend.cloud.env(),
      boxes: (key) => backend.cloud.boxes(key),
      ghToken: () => backend.cloud.ghToken(),
      office: () => this.state.officeId,
      machines: () => new Set(this.state.agents.filter((a) => a.host === 'box' && a.machine).map((a) => a.machine!)),
      changed: (cloud) => this.broadcast({ type: 'cloud', cloud }),
      log: (line) => console.warn(line),
    });
    this.boxMachines = new BoxMachines({
      api: () => this.cloud.boxApi(),
      office: () => this.state.officeId,
      size: () => this.state.settings.cloud.boxSize,
      versions: boxVersions(),
      git: () => backend.cloud.gitIdentity(this.user),
      githubEnv: () => this.cloud.githubEnv(),
      state: (machine) => this.boxState(machine),
      secrets: () => this.secrets(),
      log: (line) => console.warn(line),
    });
    this.previews = new Previews(backend, {
      emit: (id) => {
        const r = this.state.repos.find((x) => x.id === id);
        if (r && this.repoRt.has(id)) this.emitRepo(r);
      },
      pulls: (id) => this.repoRt.get(id)?.pulls ?? [],
      emitPr: (preview) => this.broadcast({ type: 'prPreview', preview }),
      prRemoved: (repoId, pr) => this.broadcast({ type: 'prPreviewRemoved', repoId, pr }),
      note: (text) => this.toast('info', text),
      holder: (repoId, pr) => this.previewHolder(repoId, pr),
      rules: (kind) => ({ idleMs: (kind === 'pr' ? this.state.settings.prPreviewIdleMin : this.state.settings.mainPreviewIdleMin) * 60_000, maxLifeMs: this.state.settings.previewMaxLifeHours * 3_600_000 }),
      stopped: (key) => this.setPreviewStats({ freed: addFreed(this.previewStats.freed, this.health.previewMb(key)) }),
      floors: () => this.state.repos,
    });
  }

  // ---------- previews in use (#204) ----------

  /** Preview key (prTheatre's prKey / mainKey) → the agent whose QA lab or fix session asked for it. */
  protected previewHolds = new Map<string, { agentId: string; repoId: string; pr: number | null }>();
  protected previewStats: PreviewStatsView = { diskBytes: null, memMb: null, cleanedAt: null };

  /** The agent using a preview now: one whose lab asked for it, still on a QA or fix session on that floor. */
  protected previewHolder(repoId: string, pr: number | null): string | null {
    const id = this.previewHolds.get(pr ? prKey(repoId, pr) : mainKey(repoId))?.agentId;
    const a = id ? this.state.agents.find((x) => x.id === id) : undefined;
    return a && a.repoId === repoId && BUSY.includes(a.status) && (a.task === 'qa' || a.task === 'fix') ? a.name : null;
  }

  protected setPreviewStats(patch: Partial<PreviewStatsView>) {
    const next = { ...this.previewStats, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.previewStats)) return;
    this.previewStats = next;
    this.broadcast({ type: 'previewStats', stats: next });
  }

  // ---------- views ----------

  protected repoView(r: PersistedRepo): RepoView {
    const rt = this.repoRt.get(r.id)!;
    return {
      id: r.id,
      fullName: r.fullName,
      description: r.description,
      url: r.url,
      defaultBranch: r.defaultBranch,
      floor: r.floor,
      color: r.color, theme: r.theme ?? 'office', // only a known theme is ever saved (updateRepo)
      autoAssign: r.autoAssign,
      autoMerge: r.autoMerge,
      folderSync: rt.folderSync,
      browserTesting: r.browserTesting,
      links: r.links,
      mission: r.mission,
      summary: r.summary,
      qaBrief: r.qaBrief,
      playbook: r.playbook,
      trustedAuthors: r.trustedAuthors ?? [],
      localPath: r.localPath,
      checkoutPath: this.backend.mainDir(r.fullName),
      cloneStatus: rt.cloneStatus,
      cloneError: rt.cloneError,
      issues: rt.issues,
      pulls: rt.pulls,
      held: this.state.held.filter((h) => h.repoId === r.id).map((h) => ({ issue: h.issue, pr: h.pr })),
      lastSync: rt.lastSync,
      syncError: rt.syncError,
      previewConfig: r.preview,
      preview: this.previews.view(r),
      charter: charterView(r.charter, Date.now(), rt.insights ?? null),
      ciOutage: r.ciOutage ? { reason: r.ciOutage.reason, since: r.ciOutage.since, parked: this.state.qa.filter((q) => q.repoId === r.id && q.ciOutage != null).map((q) => q.prNumber) } : null,
      ...this.practiceView(r),
    };
  }

  // ---------- version-control practices (#24) ----------

  protected practiceRt = new Map<string, FloorPractice>();

  protected floorPractice(repoId: string): FloorPractice {
    let p = this.practiceRt.get(repoId);
    if (!p) this.practiceRt.set(repoId, (p = new FloorPractice()));
    return p;
  }

  /**
   * The practice switches a floor's work runs with: Every project's, the floor's overrides, then (for an issue or PR)
   * its experiment variant's. `peek`: an issue not started yet, for the variant it would get.
   */
  protected practicesOf(r: PersistedRepo, issue?: number | null, pr?: number | null, peek?: { number: number; body: string; labels: string[] }) {
    const variant = issue != null || pr != null ? this.lab.practices(r.id, issue, pr, peek) : undefined;
    return effectivePractices(this.state.settings.everyProject.practices, r.practices, variant);
  }

  /** Whether any of the floor's work may run with leases or conflict-aware scheduling (#256): the floor's switch, or a running experiment's variant. */
  protected leasesWanted(r: PersistedRepo) {
    return this.practicesOf(r).leases || this.lab.tries(r.id, 'leases') || this.practicesOf(r).busyFiles || this.lab.tries(r.id, 'busyFiles');
  }

  /** The floor's leases now: each agent building or fixing an issue, and each open swarm PR (shared/practices.ts). */
  protected leasesOf(r: PersistedRepo): Lease[] {
    const rt = this.repoRt.get(r.id);
    if (!rt) return [];
    const fp = this.floorPractice(r.id);
    const known = fp.known();
    const work = this.state.agents
      .filter((a) => a.repoId === r.id && a.role !== 'ceo' && a.task !== 'qa' && a.issueNumber != null && BUSY.includes(a.status))
      .map((a) => {
        const issue = rt.issues.find((i) => i.number === a.issueNumber);
        return { agentId: a.id, issue: a.issueNumber!, pr: a.prNumber, declared: a.declared ?? null, predicted: issue ? predictFiles(`${issue.title}\n${issue.body}`, known) : [], real: fp.diffs.get(a.id)?.files ?? null };
      });
    const pulls = rt.pulls.filter((p) => p.state === 'OPEN' && p.headRefName.startsWith('swarm/')).map((p) => ({ number: p.number, issues: p.closesIssues, files: fp.prFiles.get(p.number)?.files ?? [] }));
    return floorLeases(work, pulls);
  }

  protected practiceView(r: PersistedRepo): Pick<RepoView, 'practices' | 'practiceOverrides' | 'leases' | 'leaseHolds' | 'hotFiles'> {
    const leases = this.leasesWanted(r);
    const fp = this.practiceRt.get(r.id);
    return { practices: this.practicesOf(r), practiceOverrides: r.practices ?? {}, leases: leases || fp?.diffs.size ? this.leasesOf(r) : [], leaseHolds: (leases && fp?.holds) || [], hotFiles: (leases && fp?.hot) || [] };
  }

  protected agentView(a: PersistedAgent, withLog: boolean): AgentView {
    const rt = this.agentRt.get(a.id)!;
    return {
      id: a.id,
      name: a.name,
      repoId: a.repoId,
      role: a.role,
      look: a.look,
      task: a.task,
      desk: a.desk,
      color: a.color,
      hair: a.hair,
      skin: a.skin,
      style: a.style,
      model: a.model,
      effort: a.effort,
      cli: a.cli,
      host: a.host === 'box' ? 'box' : 'local', ...(a.burst ? { burst: a.burst } : {}),
      ...(a.host === 'box' ? { cloud: this.boxMachines.stateOf(a.machine ?? machineName(a.id)), needsSignIn: !!a.needsSignIn, ...(a.needsSignIn && a.ownLogin ? { signInWhy: a.ownLogin } : {}) } : {}),
      terminal: !!rt.terminal,
      status: a.status,
      issueNumber: a.issueNumber,
      issueTitle: a.issueTitle,
      branch: a.branch,
      prNumber: a.prNumber,
      prUrl: a.prUrl,
      currentTool: rt.currentTool,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      costUsd: a.costUsd,
      turns: a.turns,
      browserUrl: rt.browserUrl,
      hasScreenshot: !!rt.screenshot,
      screenshotAt: rt.screenshot?.at ?? null,
      lastError: a.lastError,
      blocked: rt.blocked?.reason ?? null,
      career: a.role === 'ceo' ? null : (this.state.progress.careers[a.id] ?? null),
      log: withLog ? rt.log : [],
      activity: this.activityOf(a),
      ...(a.role !== 'ceo' ? { tools: a.tools ?? {}, voiceId: a.voiceId ?? '', voiceName: a.voiceName ?? '', nextIssue: a.nextIssue ?? null } : {}), // always sent: a patch can't drop a field
    };
  }

  /** What the sign over their head says (shared/activity.ts): from their status and latest action, never raw input. */
  protected activityOf(a: PersistedAgent): AgentActivity | null {
    const chat = a.role === 'ceo' && this.state.ceo.job?.kind === 'chat';
    const { status, task, issueNumber, prNumber, startedAt } = a;
    const rt = this.agentRt.get(a.id);
    if (rt?.blocked && a.status === 'working') return { kind: 'blocked', detail: stuckSign(rt.blocked.kind) }; // the reason may name paths: kept off the sign
    return agentActivity({ status, task, currentTool: rt?.currentTool ?? null, issueNumber, prNumber, startedAt }, this.seenActivity.get(a.id) ?? null, chat);
  }

  protected qaView(q: QaRecord): QaView {
    return {
      repoId: q.repoId,
      prNumber: q.prNumber,
      status: q.status,
      round: q.round,
      devAgentId: q.devAgentId,
      qaAgentId: q.qaAgentId,
      summary: q.summary,
      checks: q.checks, ...(q.status !== 'passed' && q.fixInstructions && { fixInstructions: q.fixInstructions }), // only while it's to do (scale.test.ts)
      commentUrl: q.commentUrl,
      mergeNote: q.mergeNote,
      ceoLooking: q.status === 'needs-human' && !q.escalated && this.triageJob(q) != null,
      updatedAt: q.updatedAt,
      shots: q.shots ?? [], ...(q.status === 'needs-human' && { stuckAt: q.stuckAt ?? null, stuckWhy: q.stuckWhy, ceoNote: q.ceoNote ?? null }), ...((q.status === 'failed' || q.status === 'fixing') && { fixReason: q.fixReason }),
    };
  }

  snapshot(): WorldSnapshot {
    return {
      user: this.user,
      ghReady: !this.ghError,
      ghError: this.ghError,
      demo: this.backend.demo,
      machinesRoot: MACHINES_DIR,
      settings: this.state.settings,
      repos: this.state.repos.map((r) => this.repoView(r)),
      // no terminal lines: each tab asks for the ones it shows (shared/watch.ts)
      agents: this.state.agents.map((a) => snapshotAgent(this.agentView(a, false))),
      qa: this.state.qa.map((q) => this.qaView(q)),
      prPreviews: this.previews.prViews(),
      previewStats: this.previewStats,
      requests: this.state.requests,
      ceo: this.ceoInfo(),
      chat: this.chatView(),
      ...latestPage(this.state.messages),
      phoneReadAt: this.state.phoneReadAt,
      notices: this.state.notices,
      usage: this.usageNow(),
      health: this.health.view(),
      testLab: this.labView(),
      claudeUsage: this.state.claudeUsage,
      claudeUsageCheck: this.usageCheck,
      ops: this.opsNow(),
      doctor: this.doctorView(),
      clis: this.clis,
      models: this.models,
      ...this.voice.keyView(),
      voiceCache: this.voice.cacheInfo(),
      weather: this.weather.current(),
      ticker: this.ticker.recent(),
      notifyChannels: this.notifier.channelsView(),
      cloud: this.cloud.view(),
      version: VERSION,
      officeCommit: this.officeHead?.slice(0, 7) ?? null,
      officeUpdate: this.officeHead ? this.officeUpdateView() : undefined,
      publicDemo: PUBLIC_DEMO && this.backend.demo ? { resetHours: PUBLIC_DEMO_RESET_H } : undefined,
      progress: this.progressView(),
      pastCareers: pastCareers(this.state.progress),
      pong: this.state.pong,
      files: this.files.list(),
      tooling: this.tooling,
      experiments: this.lab.view(),
      managerChanges: this.state.ceo.changes.list,
    };
  }

  /** The short commit the office runs, or null when it isn't a git checkout. */
  officeCommit(): string | null {
    return this.officeHead?.slice(0, 7) ?? null;
  }

  /** The agent's latest screenshot (or this session's taken `at`, #230): null when it has none, undefined for an unknown agent. */
  screenshot(agentId: string, at?: number) {
    const rt = this.agentRt.get(agentId);
    return !rt ? undefined : at ? (rt.shots.find((s) => s.at === at) ?? null) : rt.screenshot;
  }

  // ---------- clients ----------

  addClient(ws: WebSocket) {
    this.outbox.add(ws);
    ws.on('close', () => this.outbox.remove(ws));
    ws.on('message', (raw) => {
      // A tab back from the time-lapse asks for the live office again, and the terminal lines it shows with it;
      // otherwise it's saying whether the manager is using it (#210) or what it shows (shared/watch.ts).
      if (isResync(raw)) {
        this.send(ws, { type: 'snapshot', data: packCareers(this.snapshot()) });
        this.outbox.resync(ws);
      } else if (!this.notifier.attention.receive(ws, raw)) this.outbox.receive(ws, String(raw));
    });
    this.send(ws, { type: 'snapshot', data: packCareers(this.snapshot()) });
  }

  /** The floor an agent's desk is on, for routing their terminal lines: 0 for the CEO in the lobby, null for none. */
  protected floorOf(a: PersistedAgent): number | null {
    if (a.role === 'ceo') return 0;
    return this.state.repos.find((r) => r.id === a.repoId)?.floor ?? null;
  }

  protected send(ws: WebSocket, ev: ServerEvent) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
  }

  protected broadcast(ev: ServerEvent) {
    this.outbox.broadcast(ev);
    this.observe(ev);
  }

  /** What follows from an event besides the tabs hearing it: ticker lines and mission control's numbers. */
  protected observe(ev: ServerEvent) {
    for (const item of this.ticker.observe(ev)) this.broadcast({ type: 'ticker', item });
    if (OPS_EVENTS.has(ev.type)) this.opsSoon();
    this.journal.record(ev);
  }

  // ---------- the daily log and session history (#49) ----------

  /** A finished session's ledger line into the history and the daily log, with its transcript kept. */
  protected logSession(line: CostSession, run: CostRun | null) {
    const repo = this.state.repos.find((r) => r.id === line.repoId);
    const agent = this.state.agents.find((a) => a.id === line.agentId);
    const qa = line.outcome === 'qa-pass' || line.outcome === 'qa-fail' ? this.state.qa.find((q) => q.repoId === line.repoId && q.prNumber === line.pr) : undefined;
    const note = qa?.summary ?? (line.outcome === 'error' ? (agent?.lastError ?? '') : '');
    const secrets = this.secrets();
    const entry: HistoryEntry = {
      id: historyId(line.at, line.agentId, line.kind),
      at: line.at,
      startedAt: line.at - line.ms,
      repoId: line.repoId,
      repo: repo?.fullName ?? '',
      floor: repo?.floor ?? null,
      agentId: line.agentId,
      agent: line.agent,
      kind: line.kind,
      issue: line.issue,
      pr: line.pr,
      title: redact(run?.title ?? '', secrets).slice(0, 200),
      outcome: line.outcome,
      note: redact(note.replace(/\s+/g, ' '), secrets).slice(0, 300),
      usd: line.usd,
      tokens: line.tokens,
      model: line.model,
      effort: line.effort, ...(line.account && { account: line.account }), // the account it ran on (#376)
      sessionId: run?.sessionId ?? null,
      transcript: null, ...(run?.ceo && { ceo: run.ceo }), // a CEO job's row in the CEO jobs log (#332)
    };
    // Only Claude Code's transcripts on this computer: a cloud agent's stays in their Box.
    const local = agent?.host !== 'box' && (agent?.sessionCli ?? 'claude') === 'claude';
    void (async () => {
      const found = local && run?.cwd ? await this.backend.sessionTranscript(run.cwd, entry.sessionId, entry).catch(() => null) : null;
      const kept = await this.history.record({ ...entry, sessionId: found?.sessionId ?? entry.sessionId }, found?.file ?? null);
      this.broadcast({ type: 'history', entry: kept });
    })();
  }

  /** A PR the office merged, into the history and the daily log. */
  protected logMerge(repo: PersistedRepo, pr: number, title: string) {
    const at = Date.now();
    const entry: HistoryEntry = { id: historyId(at, '', 'merge'), at, startedAt: at, repoId: repo.id, repo: repo.fullName, floor: repo.floor, agentId: '', agent: 'The office', kind: 'merge', issue: null, pr, title: redact(title, this.secrets()).slice(0, 200), outcome: 'merged', note: '', usd: 0, tokens: null, model: '', effort: '', sessionId: null, transcript: null };
    void this.history.record(entry, null).then((kept) => this.broadcast({ type: 'history', entry: kept }));
  }

  /** Values the journal must never write: the ElevenLabs key, the Telegram bots' tokens and secret-looking environment variables. */
  protected secrets(): string[] {
    return [...this.envSecrets, ...[this.voice.secret(), this.telegram.secret(), this.itBotSecret()].filter((v): v is string => !!v), ...this.cloud.secretValues()];
  }

  /** POST /api/journal/sample (demo only): writes a made-up working day as yesterday's journal, to replay. */
  async journalSample(): Promise<{ day: string }> {
    if (!this.backend.demo) throw new HttpError(400, 'Sample days are only for the demo office');
    const today = new Date();
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime();
    const day = await this.journal.writeDay(sampleDay(journalFrame(this.snapshot(), this.secrets()), midnight, seeded(Number(dayKey(midnight).replace(/-/g, '')))));
    return { day };
  }

  protected toast(level: 'info' | 'success' | 'error', text: string) {
    this.broadcast({ type: 'toast', level, text: cleanTerminalText(text, 500) });
  }

  /** A rich toast that joins the notification centre (#107); with `push`, the manager's devices hear of it with the same id. */
  protected notice(input: NoticeInput, push?: { event: NotifyEvent; title?: string; line?: string; changes?: Parameters<Notifier['notify']>[4]; message?: number }) {
    const at = Date.now(), t = input.target;
    const repoId = !t ? undefined : t.kind === 'agent' ? this.state.agents.find((a) => a.id === t.agentId)?.repoId : t.repoId;
    const n = makeNotice({ ...input, floor: input.floor ?? this.state.repos.find((r) => r.id === repoId)?.floor }, `${at.toString(36)}-${++this.noticeSeq}`, at);
    this.state.notices = addNotice(this.state.notices, n, at);
    this.broadcast({ type: 'toast', ...n });
    if (push) this.notifier.notify(push.event, push.title ?? n.title, n.text, push.line, push.changes, n.id, push.message);
    this.save();
  }

  /** The Charter tab's numbers (#105) from the objective log, the cost ledger and the open issues; the view keeps them till the next. */
  protected refreshInsights(r: PersistedRepo) {
    const rt = this.repoRt.get(r.id);
    if (!rt) return;
    const busy = new Set([...this.state.agents.filter((a) => a.repoId === r.id && a.issueNumber !== null).map((a) => a.issueNumber!), ...rt.pulls.filter((p) => p.state === 'OPEN').flatMap((p) => p.closesIssues)]);
    rt.insights = charterInsights({
      log: r.charter.log,
      charter: r.charter,
      status: r.charter.status,
      ledger: this.spend.ledger.all().filter((x) => x.repoId === r.id),
      issues: rt.issues,
      busy,
      held: new Set(this.state.held.filter((h) => h.repoId === r.id).map((h) => h.issue)),
      now: Date.now(),
    });
  }

  protected emitRepo(r: PersistedRepo) {
    const repo = this.repoView(r);
    this.observe({ type: 'repo', repo });
    // to the tabs with the next batch: a big company syncs and merges many times a minute
    this.outbox.repo(repo);
  }

  protected emitAgent(a: PersistedAgent) {
    // A session can finish after its agent was let go (their floor disconnected mid-task); they're gone, so say nothing.
    if (!this.agentRt.has(a.id)) return;
    const { log: _log, ...rest } = this.agentView(a, false);
    this.shownActivity.set(a.id, rest.activity ?? null);
    this.observe({ type: 'agent', agent: rest });
    // to the tabs with the next batch: a busy agent changes tools many times a minute
    this.outbox.agent(rest);
  }

  protected setQa(rec: QaRecord, patch: Partial<QaRecord>) {
    const was = rec.status, told = was === 'needs-human' && rec.escalated, now = Date.now();
    Object.assign(rec, patch, { updatedAt: now, stuckAt: stuckSince(was, patch.status ?? was, rec.stuckAt, now, patch.stuckAt) });
    if (!this.state.qa.includes(rec)) return; // it left QA (its PR closed) while a session on it was still wrapping up
    if (rec.status !== 'needs-human') Object.assign(rec, { escalated: false, ceoNote: null });
    else this.ledger({ kind: 'needs-human', repoId: rec.repoId, pr: rec.prNumber });
    this.broadcast({ type: 'qa', qa: this.qaView(rec) });
    this.save();
    // Every way a PR reaches the manager (escalated by the CEO, or straight to them) passes here.
    if (!told && rec.status === 'needs-human' && rec.escalated) this.notifyNeedsHuman(rec);
  }

  protected appendLog(a: PersistedAgent, entries: LogEntry[]) {
    const rt = this.agentRt.get(a.id);
    if (!rt) return;
    const t = Date.now();
    const lines: LogLine[] = [];
    for (const e of entries) {
      const line: LogLine = { id: this.logSeq++, t, kind: e.kind, text: e.text, tool: e.tool };
      rt.log.push(line);
      lines.push(line);
      const act = lineActivity(line);
      if (act) this.seenActivity.set(a.id, { ...act, at: t });
    }
    if (rt.log.length > LOG_BUFFER) rt.log.splice(0, rt.log.length - LOG_BUFFER);
    this.outbox.log(a.id, lines);
    this.save();
  }

  /** Before new lines go out: a new action changes the sign over their head (tool changes already sent most of them). */
  protected updateSigns(agentIds: string[]) {
    for (const id of agentIds) {
      const a = this.state.agents.find((x) => x.id === id);
      if (a && !sameActivity(this.activityOf(a), this.shownActivity.get(id))) this.emitAgent(a);
    }
  }

  // ---------- persistence ----------

  protected save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => void this.writeState().catch((err) => console.warn('could not save the state', err)), 1500);
  }

  /** Write the state file now, e.g. before the office stops or hands itself to the launcher. Waits for a write in progress. */
  protected writeState(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const next = this.writing.then(() => this.writeStateFile());
    this.writing = next.catch(() => undefined);
    return next;
  }

  protected async writeStateFile() {
    for (const a of this.state.agents) a.logTail = (this.agentRt.get(a.id)?.log ?? []).slice(-200);
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2));
    await fs.rename(tmp, STATE_FILE);
  }

  // ---------- lookups ----------

  protected repo(id: string) {
    const r = this.state.repos.find((x) => x.id === id);
    if (!r) throw new HttpError(404, `Repo ${id} is not connected`);
    return r;
  }

  protected agent(id: string) {
    const a = this.state.agents.find((x) => x.id === id);
    if (!a) throw new HttpError(404, `No agent ${id}`);
    return a;
  }

  protected running() {
    return this.state.agents.filter((a) => BUSY.includes(a.status)).length + this.consults.filter((c) => c.runningOn).length;
  }

  /** Cloud agents working on a task in their Box, which an office restart doesn't stop. */
  protected inBoxes() {
    return this.state.agents.filter((a) => a.host === 'box' && a.status === 'working' && !!a.boxCli);
  }

  /** True when the manager has set a session limit and every slot is taken. The CEO never takes a slot (#46). */
  protected slotsFull() {
    const limit = this.state.settings.sessionLimit;
    return limit > 0 && this.state.agents.filter((a) => a.role !== 'ceo' && BUSY.includes(a.status)).length + this.consults.filter((c) => c.runningOn).length >= limit;
  }

  protected agentSlug(a: PersistedAgent) {
    return `${slugify(a.name)}-${a.id.slice(0, 4)}`;
  }

  /** The machines an agent's machine is one of: folders on this computer, or Upstash Boxes (docs/cloud.md). */
  protected machinesFor(a: Pick<PersistedAgent, 'host'>): MachineProvider {
    return a.host === 'box' ? this.boxMachines : this.backend.machines;
  }

  /** Where an agent works: their machine's worktree, or (from before machines, until their next task) their floor desk. */
  protected deskOf(a: PersistedAgent, repo: PersistedRepo) {
    return a.machine ? this.machinesFor(a).deskDir(a.machine, repo.fullName) : this.backend.deskDir(repo.fullName, this.agentSlug(a));
  }

  /** Stop what an agent left running at their desk: on their ports, or started there. Resolves to their ports still held after. */
  protected releaseDesk(a: PersistedAgent, repo: PersistedRepo): Promise<number[]> {
    return a.machine ? this.machinesFor(a).release(a.machine, repo.fullName, this.port(a)) : this.backend.releaseDesk(repo.fullName, this.agentSlug(a), this.port(a)).then(() => []);
  }

  /**
   * An agent's machine; one from before machines moves to theirs now, at the start of a task. Their sessions were kept
   * by the old desk folder (Claude Code stores them by folder), so none is resumed from the machine: fixes start fresh.
   */
  protected machineOf(a: PersistedAgent) {
    if (a.machine) return a.machine;
    a.machine = machineName(a.id);
    a.sessionId = null;
    a.sessionCli = null;
    for (const q of this.state.qa) if (q.devAgentId === a.id) q.devSessionId = null;
    this.appendLog(a, [{ kind: 'system', text: '🖥️ Moving to a machine of their own: their own clone of the repository, worktree and temp folder.' }]);
    this.save(); // a restart from here on must know the machine is theirs, or its sweep takes it
    return a.machine;
  }

  /** The environment of an agent's sessions on their machine; nothing extra for one not on a machine yet. */
  protected machineEnv(a: PersistedAgent): Record<string, string> | undefined {
    try {
      return a.machine ? this.machinesFor(a).env(a.machine) : undefined;
    } catch (err) {
      console.warn(`could not set up ${a.name}'s machine environment: ${oneLine(err)}`);
      return undefined;
    }
  }

  /** Remove a machine, saying where its unpushed work went; one still in use is tried again by sweepMachines. */
  protected async removeMachine(machine: string, name: string | null, host: MachineHost = 'local') {
    const r = await this.machinesFor({ host }).remove(machine).catch(() => ({ removed: false, patches: [] as string[] }));
    if (r.patches.length) this.postMessage('office', `🧳 ${name ?? 'A former agent'} left work that was on no GitHub branch: saved in ${path.dirname(r.patches[0])}.`);
    if (host === 'box' && r.removed) void this.cloud.count().catch(() => undefined);
  }

  /** Machines whose agents are gone (on this computer, or Boxes of this office): removed while still in use, or left by an office that stopped half-way. */
  protected async sweepMachines() {
    for (const host of ['local', 'box'] as const) {
      const anyones = (m: string) => this.state.agents.some((a) => a.role !== 'ceo' && (a.host ?? 'local') === host && (a.machine ?? machineName(a.id)) === m);
      for (const m of await this.machinesFor({ host }).list().catch(() => [])) if (!anyones(m)) await this.removeMachine(m, null, host);
    }
  }

  protected clearTask(a: PersistedAgent) {
    Object.assign(a, { status: 'idle', task: null, issueNumber: null, issueTitle: null, branch: null, prNumber: null, prUrl: null, lastError: null, declared: null });
    this.emitAgent(a);
  }
}
