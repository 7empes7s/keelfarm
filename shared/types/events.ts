// The snapshot and what goes out on /ws: the events that keep a tab's state up to date. Imported through shared/types.ts.
import type { ChatItem } from '../agentChat.ts';
import type { CareerRow, PastCareer } from '../careers.ts';
import type { Decision } from '../decisions.ts';
import type { LabView } from '../experiments.ts';
import type { FileView } from '../files.ts';
import type { HealthView } from '../health.ts';
import type { ServerNow } from '../serverLoad.ts';
import type { HistoryEntry } from '../history.ts';
import type { OpsView } from '../ops.ts';
import type { WeatherView } from '../outside.ts';
import type { ProgressView, RewardView } from '../progress.ts';
import type { TestLabView } from '../testLab.ts';
import type { ToolInventory } from '../tooling.ts';
import type { AgentView, CliView, CloudView, HireRequestView, LogLine, ModelCatalogView } from './agents.ts';
import type { CeoChatView, CeoInfo, PhoneMessage, ServerDelivery, StatusReaction } from './chat.ts';
import type { NoteView, NoticeView, NotifyChannelsView } from './notify.ts';
import type { DoctorFinding, ManagerChange, OfficeUpdateView, UsageCheckError, UsageReading, UsageView } from './office.ts';
import type { EmoteId, VisitorPose, VisitorView } from './presence.ts';
import type { PongRow, PreviewStatsView, PrPreviewView, QaView, RepoView, TickerItem } from './repos.ts';
import type { SwarmSettings } from './settings.ts';
import type { AccountsView } from './accounts.ts';
import type { UsageSource } from './usage.ts';
import type { VoiceCacheView, VoiceLine } from './voice.ts';

export interface WorldSnapshot {
  user: string | null; // gh login
  ghReady: boolean;
  ghError?: string;
  demo: boolean;
  machinesRoot: string; // where agents' machines live (server/machines.ts)
  settings: SwarmSettings;
  repos: RepoView[];
  agents: AgentView[];
  qa: QaView[];
  prPreviews: PrPreviewView[];
  previewStats: PreviewStatsView;
  requests: HireRequestView[];
  ceo: CeoInfo;
  messages: PhoneMessage[]; // the chat's latest page (shared/chatPage.ts); older ones: GET /api/ceo/messages?before=
  messagesOlder?: boolean; // the thread has earlier messages than these
  phoneReadAt: number; // CEO messages newer than this are unread
  notices: NoticeView[]; // the notification centre's, newest last (shared/notices.ts keeps them)
  decisions?: Decision[]; // questions waiting on the manager (#114, shared/decisions.ts); absent in a replay
  version?: string; // the cubefarm version the server runs (package.json)
  officeCommit?: string | null; // short sha the server started on (absent on servers without self-update)
  officeUpdate?: OfficeUpdateView;
  publicDemo?: { resetHours: number }; // the demo for visitors (#95): what they can't change, and when it starts over
  usage: UsageView;
  health?: HealthView; // memory, load and sessions, for the health strip (#55); absent in a replay
  serverLoad?: ServerNow | null; // the server's latest reading by program (#271); absent in a replay
  claudeUsage: UsageReading[]; // the latest reading per limit, for the usage meter (none until a session reports)
  claudeUsageCheck?: UsageCheckError | null; // the office's last idle check failed (#89), null once one reads
  ops: OpsView;
  doctor?: DoctorFinding[]; // the office doctor's findings the manager hasn't ignored
  clis: CliView[];
  models?: ModelCatalogView; // the coding agents' models to pick from (#198); absent in a replay
  voiceKeySet: boolean; // an ElevenLabs key is saved (the key itself never leaves the server)
  voiceKeyHint: string; // its last 4 characters, '' when none
  voiceCache: VoiceCacheView;
  weather: WeatherView; // the real local weather's place and latest reading (Settings → Weather)
  ticker?: TickerItem[]; // the floors' recent ticker lines, oldest first
  notifyChannels: NotifyChannelsView;
  cloud?: CloudView; // Settings → Cloud agents: the Upstash account and the credentials cloud agents use
  accounts?: AccountsView; // Settings → Providers & accounts (#247): no secrets
  progress: ProgressView; // coins, decorations and achievements (#210)
  pastCareers?: PastCareer[]; // careers of people let go, kept for a rehire (#205); absent in a replay
  careers?: Record<string, CareerRow>; // agents' careers by id as rows (#291), their `career` then null; absent in a replay
  pong: Record<string, PongRow[]>; // each floor's ping-pong leaderboard by repo id, best first
  files: FileView[]; // the chat's files store, newest first (metadata only)
  tooling?: ToolInventory; // Tools & skills: what a Claude Code session on this machine loads (server/tooling.ts)
  experiments?: LabView; // the lab's experiments, their results and the running ones' issues (shared/experiments.ts)
  managerChanges?: ManagerChange[]; // the manager's recent board actions and what the CEO did (#207); absent in a replay
  chat?: CeoChatView; // absent in a replay
  testLab?: TestLabView; // the test lab desk (#56): its queue, running jobs and recent results; absent in a replay
}

/** What changed about an agent since the office last sent it, with its id; every field for one it never sent. */
export type AgentPatch = Partial<Omit<AgentView, 'log'>> & { id: string };
/** The same for a floor. */
export type RepoPatch = Partial<RepoView> & { id: string };

export type ServerEvent =
  | { type: 'snapshot'; data: WorldSnapshot }
  | { type: 'repo'; repo: RepoView }
  /** Floor changes batched by the office (server/outbox.ts), like agents'. */
  | { type: 'repos'; repos: RepoPatch[] }
  | { type: 'repoRemoved'; repoId: string }
  | { type: 'agent'; agent: Omit<AgentView, 'log'> }
  /** Agent changes batched by the office (server/outbox.ts), a few times a second at most. */
  | { type: 'agents'; agents: AgentPatch[] }
  | { type: 'agentRemoved'; agentId: string }
  /** New terminal lines of the agents this tab watches (shared/watch.ts); `catchUp`: their recent buffer, replacing what it had. */
  | { type: 'logs'; tails: Record<string, LogLine[]>; catchUp?: boolean }
  /** The latest line worth listing of agents it doesn't watch, for the workers list. */
  | { type: 'latest'; lines: Record<string, LogLine> }
  | { type: 'agentChat'; chats: Record<string, ChatItem[]>; catchUp?: boolean } // chat items (#120) of the agent windows a tab has open; catchUp replaces
  | { type: 'screen'; agentId: string; url: string | null; at: number; earlier?: number[] } // earlier: the session's previous shots (#230's filmstrip, at most 5, /api/agents/:id/screen?at=)
  | { type: 'qa'; qa: QaView }
  | { type: 'qaRemoved'; repoId: string; prNumber: number }
  | { type: 'prPreview'; preview: PrPreviewView }
  | { type: 'previewStats'; stats: PreviewStatsView }
  | { type: 'prPreviewRemoved'; repoId: string; pr: number }
  | { type: 'settings'; settings: SwarmSettings }
  | { type: 'request'; request: HireRequestView }
  | { type: 'ceo'; ceo: CeoInfo }
  | { type: 'message'; message: PhoneMessage }
  /** The manager's messages moved on: the CEO read them, or replied. */
  | { type: 'delivery'; ids: number[]; delivery: ServerDelivery }
  /** The CEO's job on the manager's messages moved: their status reaction. */
  | { type: 'status'; ids: number[]; status: StatusReaction }
  /** The files store changed (an upload, keep, delete or the sweep): every file's metadata, newest first. */
  | { type: 'files'; files: FileView[] }
  | { type: 'phoneRead'; at: number }
  | { type: 'decisions'; decisions: Decision[] }
  /** The CEO chat changed: what's given replaces the tab's (messages: another conversation opened; message: one edited; removed: messages the manager deleted or hid, #145). */
  | ({ type: 'ceoChat'; messages?: PhoneMessage[]; messagesOlder?: boolean; message?: PhoneMessage; removed?: number[] } & Partial<CeoChatView>)
  | { type: 'officeUpdate'; officeUpdate: OfficeUpdateView }
  | { type: 'usage'; usage: UsageView }
  | { type: 'health'; health: HealthView }
  | { type: 'serverLoad'; serverLoad: ServerNow }
  | { type: 'testLab'; testLab: TestLabView }
  | { type: 'claudeUsage'; readings: UsageReading[]; check?: UsageCheckError | null }
  | { type: 'ops'; ops: OpsView }
  | { type: 'doctor'; doctor: DoctorFinding[] }
  | { type: 'clis'; clis: CliView[] }
  | { type: 'models'; models: ModelCatalogView }
  | { type: 'voiceKey'; voiceKeySet: boolean; voiceKeyHint: string }
  | { type: 'voiceCache'; voiceCache: VoiceCacheView }
  /** The CEO says something while it works (#286): never saved, nor in the snapshot. */
  | { type: 'voiceLine'; line: VoiceLine }
  | { type: 'weather'; weather: WeatherView }
  | { type: 'ticker'; item: TickerItem }
  | { type: 'notifyChannels'; notifyChannels: NotifyChannelsView }
  | { type: 'cloud'; cloud: CloudView }
  | { type: 'accounts'; accounts: AccountsView } // without `sources`: they come in usageSources
  | { type: 'usageSources'; sources: UsageSource[] } // the usage card's rows (#361), only when they changed
  | { type: 'tooling'; tooling: ToolInventory }
  | { type: 'experiments'; experiments: LabView }
  | { type: 'managerChanges'; changes: ManagerChange[] }
  /** A session (or merge) went into the history (#49): an open History screen shows it. */
  | { type: 'history'; entry: HistoryEntry }
  | { type: 'notify'; note: NoteView }
  | { type: 'progress'; progress: ProgressView }
  | { type: 'pastCareers'; past: PastCareer[] }
  | { type: 'reward'; reward: RewardView }
  | { type: 'pong'; repoId: string; board: PongRow[] }
  /** A plain toast, or with the notice fields a rich one that also joins the notification centre. */
  | ({ type: 'toast'; level: 'info' | 'success' | 'error'; text: string } & Partial<Omit<NoticeView, 'level' | 'text'>>)
  /** Notices marked read (in any tab, or by opening their push). */
  | { type: 'noticesRead'; ids: string[] }
  /** Notifications read or seen on some device (#210): the tabs close theirs, by their threads' events. */
  | { type: 'notifyClear'; events: string[] }
  /** The office's heartbeat to every tab (shared/heartbeat.ts): never applied, it only says the socket is alive. */
  | { type: 'beat' }
  // Presence (shared/presence.ts): relayed between the office's tabs, never persisted.
  | { type: 'visitors'; you: string; visitors: VisitorView[] }
  | ({ type: 'visitorPose'; id: string } & VisitorPose)
  | { type: 'visitorEmote'; id: string; e: EmoteId }
  | { type: 'visitorPing'; id: string; x: number; y: number; z: number; label: string };

/** What a tab shows of the agents' terminals, so the office sends it only those lines (shared/watch.ts). */
export interface Watch {
  /** The floor the tab is on (0: the lobby, where the CEO sits); -1 before it has said. */
  floor: number;
  /** Agents whose panel is open (their terminal, the CEO's in the console). */
  agents: string[];
  /** The workers list is showing: the latest line of every agent. */
  workers: boolean;
}
