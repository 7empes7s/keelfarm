import { create } from 'zustand';
import { DEFAULT_FOLLOWUPS } from '../../shared/followups';
import { DEFAULT_DOG_NAME, DEFAULT_MAX_AGENTS, type AccountsView, type AgentView, type CeoChatView, type CeoInfo, type CliView, type ModelCatalogView, type CloudView, type DoctorFinding, type HireRequestView, type LogLine, type ManagerChange, type NoticeView, type NotifyChannelsView, type OfficeUpdateView, type OpsView, type PhoneMessage, type PongRow, type PreviewStatsView, type PrPreviewView, type QaView, type RepoView, type ServerEvent, type SwarmSettings, type TickerItem, type UsageCheckError, type UsageReading, type UsageView, type VisitorView, type VoiceCacheView } from '../../shared/types';
import type { PastCareer } from '../../shared/careers';
import { blockers } from '../../shared/issues';
import { OUTSIDE_PR, UNTRUSTED_ISSUE } from '../../shared/trust';
import type { ChatItem } from '../../shared/agentChat';
import { DEFAULT_WEATHER, DEFAULT_WORLD_EVENTS, EMPTY_WEATHER_VIEW, type WeatherView } from '../../shared/outside';
import { DEFAULT_NOTIFY } from '../../shared/notify';
import { DEFAULT_MEMORY, type HealthView } from '../../shared/health';
import type { ServerNow } from '../../shared/serverLoad';
import { DEFAULT_TEST_LAB, type TestLabView } from '../../shared/testLab';
import { DEFAULT_CEO_AWAKE } from '../../shared/ceoAwake';
import { DEFAULT_CLOUD, EMPTY_CLOUD } from '../../shared/cloud';
import { DEFAULT_TOOL_SETTINGS, EMPTY_INVENTORY, type ToolInventory } from '../../shared/tooling';
import { emptyLabView, type LabView } from '../../shared/experiments';
import { emptyEveryProject } from '../../shared/practices';
import { sticky } from '../../shared/notices';
import type { OutgoingMessage } from '../../shared/chat';
import { EMPTY_CHAT } from './ceoChat';
import type { FileView } from '../../shared/files';
import type { Decision } from '../../shared/decisions';
import { EMPTY_OPS } from './ops';
import type { DecorItem, ProgressView } from '../../shared/progress';
import { qaCardNote, type CardTone } from './qaCard';
import { announce } from './ui/announce';
import { APPLY, snapshotState } from './store/apply';
import type { ApplyCtx } from './store/apply/types';
import type { SnackId } from './world/fridge';
import type { GroupId, SectionId } from './ui/consoleNavRules';

export type Agent = Omit<AgentView, 'log'>;

export type PhoneTab = 'chat' | 'hires' | 'company' | 'games';

export type Overlay =
  | { kind: 'terminal'; agentId: string; view?: 'chat' | 'terminal'; jump?: number; details?: 'now' | 'profile' | 'setup'; profile?: boolean } // view: opened on it (the CEO chat's @Agent opens their chat); jump: their chat item to scroll to; details: the details tab to open (#215); profile: with their Profile open (#205)
  | { kind: 'kanban'; repoId: string }
  /** One whiteboard card up close (CardView.tsx). `peel`: its sticky can come off the board (G). */
  | { kind: 'card'; repoId: string; key: string; number: number; pr: boolean; peel?: boolean }
  | { kind: 'app'; repoId: string; pr?: number | null; qa?: boolean; merged?: { pr: number; sha: string; path: string }; path?: string } // pr: open the viewer on that channel (null: main); qa: with its QA panel; merged: main opened for a merged PR, at its page, saying so; path: at that page (an agent's browser address, #230)
  | { kind: 'elevator' }
  | { kind: 'manager'; tab?: ManagerTab; repoId?: string; card?: string; history?: { agent?: string; repoId?: string; pr?: number } } // card: an OpsAlarm id, or 'usage'; history: what the History tab starts filtered to
  | { kind: 'phone'; tab?: PhoneTab; requestId?: string; full?: boolean }
  /** A team change face to face: a new agent waiting in the lobby, or the CEO's let-go note on a desk. */
  | { kind: 'interview'; requestId: string }
  | { kind: 'help'; tab?: HelpTab }
  | { kind: 'catalogue'; repoId?: string } // the lobby kiosk (#210)
  | { kind: 'decor-box'; repoId: string } // a floor's decor box
  /** The floor as a list (Settings → Accessibility): who is there, their status and what they're doing. */
  | { kind: 'floorList' }
  | { kind: 'notices' } // the notification centre (ui/Notices.tsx)
  | { kind: 'mapRoom' }; // the memory map as a 3D constellation (ui/MapRoom.tsx, #137)

/** Help's tabs: how the office works, and the controls (keys, mouse, gamepad). */
export type HelpTab = 'office' | 'controls';

/** A console section, or a top tab (its remembered section): ui/consoleNavRules.ts. */
export type ManagerTab = SectionId | GroupId;

export interface Focus {
  id: string;
  label: string;
  // resume: the usage meter while pacing, resume full speed (asks first)
  action:
    | Overlay
    | { kind: 'hire'; repoId: string }
    | { kind: 'pickup'; toyId: string }
    | { kind: 'poke'; toyId: string }
    | { kind: 'coffee'; op: 'place' | 'brew' | 'take' }
    /** The kitchenette fridge (fridgeState.ts): open or close its door, grab a snack, or read the label on someone's lunch. */
    | { kind: 'fridge'; op: 'door' | 'take' | 'lunch'; snack?: SnackId }
    | { kind: 'jukebox'; op: 'next' | 'toggle' | 'station' | 'vol+' | 'vol-' }
    | { kind: 'channel'; repoId: string; pr: number | null }
    | { kind: 'resume' }
    | { kind: 'roof'; op: string }
    | { kind: 'decoration'; op: 'place' | 'take' | 'box' | 'arcade'; slot?: string }
    | { kind: 'trophy'; id: string }
    /** Say hi to someone with nothing to do (Chatter.tsx). */
    | { kind: 'greet'; agentId: string }
    /** E on a holiday theme's thing (themes/active.ts). */
    | { kind: 'theme'; id: string }
    /** Pick up a paddle at that end of the ping-pong table (toys/pongState.ts). */
    | { kind: 'pong'; end: 'west' | 'east' };
}

/** What the player is carrying. Other items (a blaster, say) join the union with their own kind. */
export type Held =
  | { kind: 'ball'; id: string }
  /** A foam blaster: darts left in the magazine, and performance.now() when a reload started (null when not reloading). */
  | { kind: 'blaster'; id: string; ammo: number; reloadAt: number | null }
  /** A coffee mug: sips of coffee left, 0 (empty) to 3 (full). */
  | { kind: 'mug'; id: string; sips: number }
  /** A sticky peeled off the whiteboard (boardHands.ts): an issue to build, or a PR to test, for a free agent's desk. */
  | { kind: 'sticky'; id: string; repoId: string; key: string; number: number; pr: boolean }
  /** A sausage in a bun off the roof's grill: bites left, eaten like coffee is sipped. */
  | { kind: 'sausage'; id: string; bites: number; charred: boolean }
  /** Something from the kitchenette fridge (fridge.ts): sips or bites left, had like coffee or a sausage. */
  | { kind: 'snack'; id: string; snack: SnackId; left: number }
  /** A decoration on its way to a slot (#210): from the floor's decor box (from null) or from the slot it stood in. */
  | { kind: 'decor'; id: string; item: DecorItem; from: string | null }
  /** A ping-pong paddle, playing at that end of the table (toys/pongState.ts): mouse and camera belong to the match. */
  | { kind: 'paddle'; id: 'west' | 'east' };

export interface Toast {
  id: number;
  level: 'info' | 'success' | 'error';
  text: string;
  notice?: NoticeView; // a rich toast (#107): ui/Notices.tsx draws it
}

export interface State {
  connected: boolean;
  loaded: boolean;
  user: string | null;
  ghReady: boolean;
  ghError?: string;
  demo: boolean;
  publicDemo: { resetHours: number } | null; // the demo for visitors (#95)
  machinesRoot: string;
  settings: SwarmSettings;
  clis: CliView[]; // the coding-agent CLIs installed where the office runs
  models: ModelCatalogView; // their models to pick from (#198)
  repos: RepoView[];
  agents: Record<string, Agent>;
  logs: Record<string, LogLine[]>; // only for the agents this tab watches (shared/watch.ts): its floor and open panels
  latest: Record<string, LogLine>; // everyone's latest line worth listing, for the workers list
  agentChat: Record<string, ChatItem[]>; // chat items (#120) of the agents whose window is open
  workersOpen: boolean; // the workers list is showing (WorkersPanel.tsx), so the office sends everyone's latest line
  peek: string | null; // the agent a chat chip's preview shows, so the office sends their lines (ui/RefChips.tsx)
  screens: Record<string, number>; // agentId -> screenshot timestamp (cache buster)
  shotTimes: Record<string, number[]>; // agentId -> their session's earlier screenshots (#230), from the screen events this tab got
  qa: Record<string, QaView>; // `${repoId}#${prNumber}`
  prPreviews: Record<string, PrPreviewView>; // the PR theatre's previews, `${repoId}#${pr}`
  previewStats: PreviewStatsView;
  requests: HireRequestView[];
  ceo: CeoInfo;
  messages: PhoneMessage[]; // the chat's pages loaded so far (shared/chatPage.ts)
  chatOlder: boolean; // the thread has earlier messages than these
  chat: CeoChatView; // the live reply, conversations and pinned notes (#51)
  files: FileView[]; // the chat's files store (shared/files.ts), newest first
  chatOutbox: OutgoingMessage[]; // this tab's messages to the CEO the office doesn't have yet (ui/chatSend.ts)
  phoneReadAt: number;
  notices: NoticeView[]; // the notification centre's (shared/notices.ts), oldest first
  decisions: Decision[]; // questions waiting on the manager (#114, shared/decisions.ts)
  version?: string; // the cubefarm version the server runs
  officeCommit?: string | null; // undefined: the server can't update itself
  officeUpdate?: OfficeUpdateView;
  usage: UsageView; // Claude's subscription usage: normal, pacing after a warning, or paused at the limit
  health: HealthView | null; // memory, load and sessions for the health strip (null: a server without it, or a replay)
  serverLoad: ServerNow | null; // the server's latest reading by program (#271)
  testLab: TestLabView | null; // the test lab desk (#56); null: a server without it, or a replay
  claudeUsage: UsageReading[]; // Claude's latest reading per usage limit (empty until a session reports)
  claudeUsageCheck: UsageCheckError | null; // why the office's idle check couldn't read it (#89), null when it could
  ops: OpsView; // mission control: every floor's numbers and what needs the manager
  doctor: DoctorFinding[]; // the office doctor's findings (server/watchdog.ts)
  voiceKeySet: boolean; // an ElevenLabs key is saved on the server
  voiceKeyHint: string; // its last 4 characters
  voiceCache: VoiceCacheView; // the voice's saved clips: Settings → Voice, and which messages the phone's ▶ replays
  progress: ProgressView; // coins, decorations and achievements (#210)
  pastCareers: PastCareer[]; // careers of people let go (#205): the Team tab's Past agents
  voiceSpeaking: number | null; // the phone message being read aloud in this tab (ui/voiceMessages.ts)
  weather: WeatherView; // the real local weather's place and latest reading (Settings → Weather)
  ticker: TickerItem[]; // the floors' recent activity lines, oldest first (world/ActivityTicker.tsx)
  notifyChannels: NotifyChannelsView; // which chat apps have a webhook saved (hints only) and how many devices get push
  cloud: CloudView; // Settings → Cloud agents: the Upstash account and what cloud agents sign in with (never a key)
  accounts: AccountsView; // Settings → Providers & accounts (#247): logins and keys (never a key)
  tooling: ToolInventory; // Tools & skills: what a Claude Code session on the office's machine loads
  experiments: LabView; // the lab (#23): experiments, their results, and the running ones' issues
  managerChanges: ManagerChange[]; // the manager's board actions and what the CEO did about them (#207)
  historySeq: number; // bumped by each new history entry (#49): an open History tab reloads its page
  pong: Record<string, PongRow[]>; // each floor's ping-pong leaderboard by repo id, best first
  restarting: boolean; // the connection dropped because the office is restarting to update
  updateReady: string | null; // the office came back on this commit: its client loads at a safe moment (updateLoad.ts, #216)
  visitors: VisitorView[]; // everyone else appearing in the office, any floor (presence; their poses skip the store)
  replaying: boolean; // the time-lapse (replay.ts) is showing a recorded day: live events wait, live actions are off

  floor: number; // 0 = lobby
  travel: { to: number; phase: 'closing' | 'opening' } | null;
  overlay: Overlay | null;
  back: Overlay | null; // what closing the overlay goes back to: the phone's chat after a chip's jump (ui/RefChips.tsx)
  chatDocked: boolean; // pocket mode's chat is open beside the pages on a desktop (#104): the CEO's messages don't toast
  focus: Focus | null;
  locked: boolean;
  started: boolean;
  toasts: Toast[];
  held: Held | null;
  /** performance.now() when the player started charging a throw; null when they aren't. */
  chargeAt: number | null;

  /**
   * Folds an event into the state. The time-lapse passes `replay`: 'play' shows it (gong and confetti, no cues, toasts
   * or voice), 'seek' only moves the state (fast-forwarding to a point on the timeline).
   */
  apply(ev: ServerEvent, replay?: 'play' | 'seek'): void;
  setConnected(v: boolean): void;
  setReplaying(v: boolean): void;
  setRestarting(v: boolean): void;
  setOfficeUpdate(u: OfficeUpdateView): void;
  openOverlay(o: Overlay | null): void;
  setFocus(f: Focus | null): void;
  /** Pick something up (or swap), or let go of it with null. Always ends a charge. */
  setHeld(h: Held | null): void;
  setCharge(at: number | null): void;
  setLocked(v: boolean): void;
  setWorkersOpen(v: boolean): void;
  start(): void;
  goToFloor(n: number): void;
  finishTravel(phase: 'arrived' | 'done'): void;
  pushToast(level: Toast['level'], text: string, notice?: NoticeView): void;
  dismissToast(id: number): void;
}

let toastSeq = 1;

// Where the viewer was standing, so a refresh puts them back on the same floor and spot.
export interface SavedView {
  floor: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}
const VIEW_KEY = 'cubefarm:view';

export function loadView(): SavedView | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as SavedView | null;
    return v && [v.floor, v.x, v.z, v.yaw, v.pitch].every(Number.isFinite) ? v : null;
  } catch {
    return null;
  }
}

export function saveView(v: SavedView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // storage may be unavailable (private mode); the view just won't be remembered
  }
}

export const useStore = create<State>((set, get) => ({
  connected: false,
  loaded: false,
  user: null,
  ghReady: true,
  demo: false,
  publicDemo: null,
  machinesRoot: '',
  // Until the server's snapshot arrives; setupDone stays true so the wizard doesn't flash while loading.
  settings: {
    sessionLimit: 0,
    memory: DEFAULT_MEMORY,
    testLab: DEFAULT_TEST_LAB,
    defaultModel: 'claude-opus-5-5',
    defaultEffort: 'medium',
    taskEffort: {},
    runtime: 'terminal',
    defaultCli: 'claude',
    scaling: 'approve',
    maxAgents: DEFAULT_MAX_AGENTS,
    ceoHeartbeatMin: 60,
    researchMin: 20,
    ceoFollowups: DEFAULT_FOLLOWUPS,
    ceoMandates: [],
    ceoAwake: DEFAULT_CEO_AWAKE,
    managerName: '',
    companyName: '',
    dogName: DEFAULT_DOG_NAME,
    projectsDir: '',
    setupDone: true,
    tutorialStep: -1,
    pacingSessions: 3,
    trimIdleDesksMin: 120,
    stuckRecheckMin: 30,
    previewRecentHours: 48,
    mainPreviewIdleMin: 1, prPreviewIdleMin: 1, previewMaxLifeHours: 0,
    dailyLogDir: '',
    historyDays: 90,
    voice: { provider: 'off', voiceId: '', voiceName: '', model: '', speakOffice: false, keepDays: 7, speed: 1, favourites: [] },
    themes: { mode: 'auto', disabled: [], birthday: null },
    weather: DEFAULT_WEATHER,
    worldEvents: DEFAULT_WORLD_EVENTS,
    listen: { provider: 'off', autoSend: false, handsFree: false },
    notify: DEFAULT_NOTIFY,
    cloud: DEFAULT_CLOUD,
    tools: DEFAULT_TOOL_SETTINGS,
    everyProject: emptyEveryProject(),
    officePlaybook: '',
  },
  clis: [],
  models: { entries: [], checkedAt: 0 },
  repos: [],
  agents: {},
  logs: {},
  latest: {},
  agentChat: {},
  workersOpen: false,
  peek: null,
  screens: {},
  shotTimes: {},
  qa: {},
  prPreviews: {},
  previewStats: { diskBytes: null, memMb: null, cleanedAt: null },
  requests: [],
  ceo: { queue: [], job: null, lastReviewAt: null, nextReviewAt: null, followups: { pending: [], startsAt: null, held: null } },
  messages: [],
  chatOlder: false,
  chat: EMPTY_CHAT,
  files: [],
  chatOutbox: [],
  phoneReadAt: 0,
  notices: [],
  decisions: [],
  usage: { state: 'normal', until: null, warning: null },
  health: null,
  serverLoad: null,
  testLab: null,
  claudeUsage: [],
  claudeUsageCheck: null,
  ops: EMPTY_OPS,
  doctor: [],
  voiceKeySet: false,
  voiceKeyHint: '',
  voiceCache: { clips: 0, bytes: 0, saved: [] },
  progress: { floors: {}, achievements: [], coffees: 0, merges: 0 },
  pastCareers: [],
  voiceSpeaking: null,
  weather: EMPTY_WEATHER_VIEW,
  ticker: [],
  notifyChannels: {
    webhooks: { ntfy: { set: false, hint: '', last: null } },
    pushDevices: 0,
    devices: [],
    desktop: null,
    telegram: { set: false, bot: '', linked: false, chat: '', linking: false, on: true, polling: 'off', error: '', okAt: null, advice: '', last: null },
    today: { sent: 0, skipped: 0 },
  },
  cloud: EMPTY_CLOUD,
  accounts: { accounts: [] },
  tooling: EMPTY_INVENTORY,
  experiments: emptyLabView(),
  managerChanges: [],
  historySeq: 0,
  pong: {},
  restarting: false,
  updateReady: null,
  visitors: [],
  replaying: false,

  floor: loadView()?.floor ?? 0,
  travel: null,
  overlay: null,
  back: null,
  chatDocked: false,
  focus: null,
  locked: false,
  started: false,
  toasts: [],
  held: null,
  chargeAt: null,

  apply(ev, replay) {
    // Cues compare the old state with the new, so each change sounds once; snapshots (page load,
    // reconnect) never do, and nothing sounds before the first snapshot. A replay shows merges but makes no cues.
    const live = get().loaded && replay !== 'seek';
    const c = { set, get, live, cues: live && !replay, replay };
    if (ev.type === 'snapshot') set({ ...snapshotState(ev.data, c), loaded: true, restarting: false });
    else if (ev.type !== 'beat') (APPLY[ev.type] as (ev: ServerEvent, c: ApplyCtx) => void)(ev, c); // each event's handler: store/apply/<area>.ts
  },

  setConnected: (connected) => set({ connected }),
  setReplaying: (replaying) => set({ replaying }),
  setRestarting: (restarting) => set({ restarting }),
  setOfficeUpdate: (officeUpdate) => set({ officeUpdate }),
  openOverlay(overlay) {
    // Terminals and the floor's app are live, whatever the time-lapse shows.
    if (overlay && get().replaying && (overlay.kind === 'terminal' || overlay.kind === 'app')) {
      get().pushToast('info', 'That shows the live office: press Esc to leave the replay first.');
      return;
    }
    // Closing a panel a chat chip opened goes back to the chat.
    const back = get().back;
    if (!overlay && back) overlay = back;
    // Opening any panel drops whatever you're carrying, so nothing is left floating behind it.
    set(overlay ? { overlay, back: null, focus: null, held: null, chargeAt: null } : { overlay });
    if (overlay && document.pointerLockElement) document.exitPointerLock();
  },
  setFocus: (focus) => {
    const cur = get().focus;
    if (cur?.id === focus?.id && cur?.label === focus?.label) return;
    set({ focus });
  },
  setHeld: (held) => set({ held, chargeAt: null }),
  setCharge: (chargeAt) => set({ chargeAt }),
  setLocked: (locked) => set({ locked }),
  setWorkersOpen: (workersOpen) => set({ workersOpen }),
  start: () => set({ started: true }),
  goToFloor(n) {
    if (n === get().floor || get().travel) {
      set({ overlay: null, back: null });
      return;
    }
    set({ overlay: null, back: null, held: null, chargeAt: null, travel: { to: n, phase: 'closing' } });
  },
  finishTravel(phase) {
    const t = get().travel;
    if (!t) return;
    if (phase === 'arrived') set({ floor: t.to, travel: { ...t, phase: 'opening' } });
    else set({ travel: null });
  },
  pushToast(level, text, notice) {
    // Screen readers hear it (the CEO's messages are announced as they arrive); ui/Notices.tsx times it out.
    if (level === 'error' || (notice && sticky(notice))) announce(notice ? `${notice.title}: ${notice.text}` : text, 'assertive');
    else if (notice && notice.kind !== 'ceo') announce(`${notice.title}: ${notice.text}`);
    set({ toasts: [...get().toasts.slice(-9), { id: toastSeq++, level, text, ...(notice && { notice }) }] });
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

// ---------- derived helpers ----------

export { floorPrCounts } from './floorCounts';

export const qaKey = (repoId: string, prNumber: number) => `${repoId}#${prNumber}`;

export const repoOnFloor = (repos: RepoView[], floor: number) => repos.find((r) => r.floor === floor) ?? null;

export const agentsOnRepo = (agents: Record<string, Agent>, repoId: string) =>
  Object.values(agents)
    .filter((a) => a.repoId === repoId)
    .sort((a, b) => a.desk - b.desk);

/**
 * Panels that hide the whole office (the wide ones: Kanban, terminals, the manager's console and the map room), so the
 * 3D view can stop drawing behind them. The phone, help, elevator panel and confirm dialogs are see-through.
 */
export const coversView = (o: Overlay | null) => o?.kind === 'kanban' || o?.kind === 'terminal' || o?.kind === 'manager' || o?.kind === 'mapRoom' || (o?.kind === 'phone' && !!o.full);

/**
 * Whether the 3D view stops drawing under this panel: a full-screen one anywhere, and any panel on a touch screen
 * (#83: a phone's panels fill the screen, and drawing every frame behind them left their buttons answering taps late
 * or not at all).
 */
export const pausesView = (o: Overlay | null, touch: boolean) => coversView(o) || (touch && !!o);

export const isBusy = (a: Agent) => a.status === 'preparing' || a.status === 'working';

/** CEO messages the manager hasn't seen yet (proposals are counted by pendingRequests instead). */
export const unreadMessages = (messages: PhoneMessage[], readAt: number) => messages.filter((m) => m.from === 'ceo' && !m.requestId && m.at > readAt).length;

export const pendingRequests = (requests: HireRequestView[]) => requests.filter((r) => r.status === 'pending');

/** The red dot on the phone: decisions waiting on the manager plus unread messages. */
export function usePhoneBadge() {
  const requests = useStore((s) => s.requests);
  const messages = useStore((s) => s.messages);
  const readAt = useStore((s) => s.phoneReadAt);
  return pendingRequests(requests).length + unreadMessages(messages, readAt);
}

export interface KanbanCard {
  key: string;
  number: number;
  title: string;
  url?: string;
  agent?: Agent;
  note?: string;
  tone?: CardTone;
  prNumber?: number;
  qa?: QaView;
  /** The 3D board draws it as an outline: its sticky is off the board, with the agent testing it (StickyNotes.tsx). */
  ghost?: boolean;
  /** An outsider's issue or PR (#185): the office leaves it alone. */
  untrusted?: boolean;
}

export interface KanbanColumns {
  backlog: KanbanCard[];
  progress: KanbanCard[];
  qa: KanbanCard[];
  ready: KanbanCard[];
  merged: KanbanCard[];
}

/**
 * Sort a floor's GitHub state and QA pipeline into the five office Kanban columns. With `usage`, backlog issues
 * auto-assign would start but Claude's usage holds back say so ("⏸ paced").
 */
export function kanbanFor(repo: RepoView, agents: Agent[], qaRecords: Record<string, QaView>, usage?: Pick<UsageView, 'state'>): KanbanColumns {
  const openPulls = repo.pulls.filter((p) => p.state === 'OPEN');
  const byId = new Map(agents.map((a) => [a.id, a]));
  const workers = agents.filter((a) => a.role !== 'ceo');
  // While testing, an agent's prNumber is the PR under test, not one of theirs.
  const authors = workers.filter((a) => a.task !== 'qa');
  const authorOf = (n: number, head: string) => authors.find((a) => a.prNumber === n) ?? authors.find((a) => a.branch && a.branch === head);

  const progress: KanbanCard[] = [];
  for (const a of workers) {
    if (a.issueNumber == null || a.task !== 'issue' || a.status === 'idle') continue;
    // Their PR's card is the work now; once it's closed or merged there is no card ("finished · no PR" was wrong).
    if (a.prNumber != null) continue;
    const note =
      a.status === 'preparing' ? 'setting up' : a.status === 'working' ? 'working' : a.status === 'error' ? 'needs help' : a.status === 'stopped' ? 'stopped' : 'finished · no PR';
    progress.push({
      key: `a-${a.id}`,
      number: a.issueNumber,
      title: a.issueTitle ?? '',
      agent: a,
      note,
      tone: a.status === 'error' ? 'bad' : a.status === 'stopped' || a.status === 'done' ? 'warn' : undefined,
    });
  }

  const qa: KanbanCard[] = [];
  const ready: KanbanCard[] = [];
  for (const p of openPulls) {
    const rec = qaRecords[qaKey(repo.id, p.number)];
    const dev = (rec?.devAgentId ? byId.get(rec.devAgentId) : undefined) ?? authorOf(p.number, p.headRefName);
    const tester = rec?.qaAgentId ? byId.get(rec.qaAgentId) : undefined;
    const base = { key: `pr-${p.number}`, number: p.number, prNumber: p.number, title: p.title, url: p.url, qa: rec, untrusted: p.untrusted };
    const card = { ...base, ...(p.untrusted ? { note: OUTSIDE_PR, tone: 'warn' as const } : qaCardNote(rec, p, repo.autoMerge)) };
    if (rec?.status === 'passed') ready.push({ ...card, agent: dev });
    else qa.push({ ...card, agent: rec?.status === 'testing' ? tester : dev });
  }

  const claimed = new Set<number>([...progress.map((c) => c.number), ...openPulls.flatMap((p) => (p.untrusted ? [] : p.closesIssues))]);
  const open = new Set(repo.issues.map((i) => i.number));
  const held = new Map((repo.held ?? []).map((h) => [h.issue, h.pr]));
  const paced = repo.autoAssign && usage && usage.state !== 'normal' ? (usage.state === 'paused' ? 'paused' : 'paced') : '';
  const backlog: KanbanCard[] = repo.issues
    .filter((i) => !claimed.has(i.number))
    .map((i) => {
      const waits = blockers(i.body, open);
      const labels = i.labels.slice(0, 2).join(', ');
      const card = { key: `i-${i.number}`, number: i.number, title: i.title, url: i.url };
      if (i.untrusted) return { ...card, note: `${UNTRUSTED_ISSUE} · @${i.author ?? 'ghost'}`, tone: 'warn' as const, untrusted: true };
      // Its PR was closed: it waits for the manager rather than going back to auto-assign.
      if (held.has(i.number)) return { ...card, note: `PR #${held.get(i.number)} closed · assign by hand`, tone: 'warn' as const };
      return { ...card, note: (waits.length ? `after #${waits.join(', #')}` : [paced, labels].filter(Boolean).join(' · ')) || undefined };
    });

  const merged: KanbanCard[] = repo.pulls
    .filter((p) => p.state === 'MERGED')
    .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''))
    .map((p) => ({ key: `m-${p.number}`, number: p.number, prNumber: p.number, title: p.title, url: p.url, agent: authorOf(p.number, p.headRefName) }));

  return { backlog, progress, qa, ready, merged };
}
