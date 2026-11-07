// Types shared between the swarm server and the 3D client.
import type { CareerView } from './careers.ts';
import type { CharterView } from './charter.ts';
import type { ProgressView, RewardView } from './progress.ts';

import type { WeatherSettings, WeatherView, WorldEventSettings } from './outside.ts';
import type { ThemeSettings } from './themes.ts';
import type { AgentStyle } from './looks.ts';
import type { TaskKind } from './costs.ts';
import type { FileRef, FileView } from './files.ts';
import type { UsedView } from './used.ts';
import type { ChatAction } from './ceoActions.ts';
import type { ToolInventory, ToolSettings, ToolSwitches } from './tooling.ts';
import type { CeoMandate, FollowupSettings } from './followups.ts';
import type { AgentQuestion } from './questions.ts';
import type { Decision } from './decisions.ts';
export type { AgentQuestion }; // its home is shared/questions.ts
import type { CeoAwakeSettings, CeoSessionView } from './ceoAwake.ts';
import type { LabView } from './experiments.ts';
import type { HistoryEntry } from './history.ts';
import type { HealthView, MemorySettings } from './health.ts';
import type { OpsView } from './ops.ts';
import type { CeoLive } from './ceoStream.ts';
import type { Conversation } from './conversations.ts';
import type { MemoryNote } from './ceoMemory.ts';
import type { TestLabSettings, TestLabView } from './testLab.ts';
import type { EveryProject, FloorPracticeView } from './practices.ts';
import type { ChatItem } from './agentChat.ts';

export type AgentStatus =
  | 'idle' // at desk, nothing assigned
  | 'preparing' // setting up the git worktree
  | 'working' // Claude Code session running
  | 'done' // finished, PR opened (or finished without one)
  | 'error' // session failed
  | 'stopped'; // manager stopped it

export type LogKind = 'text' | 'tool' | 'result' | 'system' | 'error' | 'manager' | 'done' | 'thinking';

export interface LogLine {
  id: number;
  t: number; // epoch ms
  kind: LogKind;
  text: string;
  tool?: string; // tool name for kind === 'tool'
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  createdAt: string;
  /** Its author's login (null: a deleted user) and GitHub's authorAssociation, for trust (shared/trust.ts, #185). */
  author?: string | null;
  authorAssociation?: string;
  /** Who last added the office-trusted label. */
  trustedBy?: string | null;
  /** Not from a trusted author: listed, never built (set by the sync). */
  untrusted?: boolean;
}

export interface PullInfo {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  mergeable: string; // MERGEABLE | CONFLICTING | UNKNOWN
  reviewDecision: string | null;
  closesIssues: number[];
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  checks: 'pending' | 'passing' | 'failing' | 'none';
  headSha: string;
  mergeState: string; // GitHub's mergeStateStatus: CLEAN | BEHIND | BLOCKED | DIRTY | UNSTABLE | DRAFT | UNKNOWN …
  failedChecks: { name: string; url: string | null }[];
  pendingChecks: string[];
  issueCreatedAt?: string | null; // when the issue it closes was filed, as far as the office knows (the whiteboard's issue → merge time)
  /** GitHub's check runs on the head commit once all have finished: how long they took (first start to last finish) and when they finished. */
  checkRun?: { ms: number; doneAt: number } | null;
  /** The paths it changes (up to PR_FILES_MAX), for the memory map's hot files and conflict risk (shared/memoryMap.ts). */
  files?: string[];
  author?: string | null;
  isCrossRepository?: boolean;
  /** From a fork or an untrusted author: never QA'd, fixed, previewed or merged by the office (set by the sync, #185). */
  untrusted?: boolean;
}

export const PR_FILES_MAX = 30;

export interface RepoView extends FloorPracticeView {
  id: string; // "owner/name"
  fullName: string;
  description: string;
  url: string;
  defaultBranch: string;
  floor: number; // 1-based floor number in the building
  color: string; // accent color for the floor
  autoAssign: boolean;
  autoMerge: boolean; // PRs merge themselves once QA passes and GitHub's checks are green
  folderSync: string | null; // how the floor's main checkout stands against GitHub: "in sync", "updated to abc1234", "2 behind: local changes" …
  browserTesting: boolean;
  links: string[]; // ids of related repos this floor's agents can read for context
  mission: string; // the manager's brief: what this floor is building
  summary: string; // the CEO's one-line read of the project, e.g. "3D browser game · Three.js + Vite"
  qaBrief: string; // how QA should test this kind of project (written by the CEO, editable)
  playbook: string; // the floor's architecture map, conventions, skills to use and traps, for every agent's prompt (up to PLAYBOOK_MAX)
  trustedAuthors?: string[]; // GitHub logins trusted besides the owner, the office and write collaborators (#185)
  localPath: string | null; // the manager's own project folder, when the floor lives in one
  checkoutPath: string; // where the floor's main checkout is on disk (localPath, or a clone the office manages)
  cloneStatus: 'pending' | 'cloning' | 'ready' | 'error';
  cloneError?: string;
  issues: IssueInfo[]; // open issues
  pulls: PullInfo[]; // open + recently merged PRs
  held: { issue: number; pr: number }[]; // open issues whose PR was closed: they wait to be assigned by hand
  lastSync: number | null;
  syncError?: string;
  previewConfig: PreviewConfig;
  preview: PreviewView;
  charter: CharterView; // the rest of the floor's charter (#48); `mission` above is its mission
}

/**
 * How a floor's app is run for the preview monitor. {port} and {tmp} are replaced in the command and env values;
 * PORT={port} is always set. command null: npm run dev, else start, else preview from package.json.
 */
export interface PreviewConfig {
  command: string | null;
  env: Record<string, string>;
}

export type PreviewStatus =
  | 'unconfigured' // no command and no package.json
  | 'stopped'
  | 'preparing' // checking out the ref in the preview worktree
  | 'installing' // npm ci / npm install
  | 'starting' // command started, waiting for the port
  | 'running'
  | 'error';

/** The floor's running app, served from its own worktree on a port reserved for the floor. */
export interface PreviewView {
  status: PreviewStatus;
  port: number;
  url: string | null; // set while running
  ref: string | null; // the default branch's name, or "PR #n"
  pr: number | null;
  commit: string | null; // short sha
  startedAt: number | null;
  error: string | null;
  logTail: string[]; // the last 40 lines of install / app output
}

/**
 * An open PR's app in the PR theatre: run beside the floor's main preview, from a worktree of its own, until nobody
 * has watched it for a while, its PR merges or closes, or the office stops.
 */
export interface PrPreviewView {
  repoId: string;
  pr: number;
  status: PreviewStatus;
  port: number;
  url: string | null; // set while running
  commit: string | null; // short sha of the PR's head
  startedAt: number;
  viewedAt: number; // the last time a viewer had it on screen
  watched: boolean; // a viewer has it on screen now
  error: string | null;
  logTail: string[]; // the last 40 lines of install / app output
}

/** A folder in the manager's projects folder, as offered when adding a floor. */
export interface ProjectFolderView {
  name: string;
  path: string;
  git: boolean;
  github: string | null; // owner/name of its GitHub origin
  floor: number | null; // already a floor in the office
}

/** Every agent on a floor is the same kind of worker (docs/agents.md); the one CEO works in the lobby and runs the company. */
export type AgentRole = 'agent' | 'ceo';

/** Desks in a floor's room: 12 in the open-plan grid and 3 along the east wall. A team is at most this big. */
export const FLOOR_SEATS = 15;

/** The longest a floor's playbook may be, in characters: it is in every agent's prompt there. */
export const PLAYBOOK_MAX = 3000;

/** The longest the office-wide playbook may be (#50): it is in every builder's, fixer's and QA's prompt, on every floor. */
export const OFFICE_PLAYBOOK_MAX = 1200;

/** The office-wide playbook a new office starts with: small rules the prompts don't already say. */
export const DEFAULT_OFFICE_PLAYBOOK = [
  '- A fix comes with a test that fails without it.',
  "- Don't reformat, rename or move code you aren't changing.",
  '- Never run, edit or restart anything outside your worktree and reserved port: no live services, no other desks.',
].join('\n');

/** A floor's most agents unless the manager changes it (Settings). */
export const DEFAULT_MAX_AGENTS = 10;

/** Fixed id of the CEO agent. */
export const CEO_ID = 'ceo';

/** What the office dog is called until the manager renames it (Settings). */
export const DEFAULT_DOG_NAME = 'Biscuit';

/** An agent's currentTool while the office installs their desk's dependencies (status 'preparing'). */
export const INSTALL_STEP = 'Installing dependencies';

/** How the cartoon character is drawn. Picked from the agent's name when hired; the manager can change it. */
export type AgentLook = 'feminine' | 'masculine';

/** What an agent is currently doing: implementing an issue, testing a PR, or fixing a PR after QA. */
export type AgentTask = 'issue' | 'qa' | 'fix';

/**
 * How agents run. terminal: each agent is the real coding-agent CLI in its own terminal, shown live in the office.
 * sdk: Claude Code through the Agent SDK, its stream turned into log lines.
 */
export type AgentRuntime = 'terminal' | 'sdk';

/** The coding-agent CLI an agent runs in its terminal. The CEO is always Claude Code. */
export type AgentCli = 'claude' | 'codex' | 'opencode';

/** Where an agent's machine is (docs/cloud.md): a folder on this computer, or an Upstash Box in the cloud. */
export type MachineHost = 'local' | 'box';

/** An Upstash Box's size. */
export type BoxSize = 'small' | 'medium' | 'large';

/** Settings → Cloud agents. */
export interface CloudSettings {
  machineKind: MachineHost; // where new agents work ('local' unless the manager turns the cloud on)
  boxSize: BoxSize;
  boxLimit: number; // the Upstash plan's most Boxes (the free plan's 10), counted before a cloud agent is hired
}

/** How a cloud agent's machine is doing, on their card. */
export type CloudMachineState = 'none' | 'creating' | 'setting-up' | 'ready' | 'paused' | 'disconnected' | 'error';

/** Where a cloud credential comes from (never its value). 'login': each cloud agent signs in in their own terminal. */
export type CloudCredentialSource = 'token' | 'gh' | 'subscription' | 'apiKey' | 'login' | null;

/** One credential cloud agents sign in with: whether it's there and where it comes from. */
export interface CloudCredentialView {
  ready: boolean;
  source: CloudCredentialSource;
  hint: string; // the last 4 characters of a saved key or token, '' otherwise
}

/** The cloud account as the manager sees it in Settings → Cloud agents. Keys and tokens never leave the server. */
export interface CloudView {
  keySet: boolean; // an Upstash Box API key is saved
  keyHint: string;
  keyError: string | null; // Upstash turned the key away, or couldn't be reached, at the last check
  github: CloudCredentialView;
  claude: CloudCredentialView;
  codex: CloudCredentialView;
  boxes: { total: number; running: number; paused: number; orphans: number } | null; // null until counted
}

/** A coding-agent CLI the office knows how to run, and whether it's installed on this machine. */
export interface CliView {
  id: AgentCli;
  label: string;
  installed: boolean;
  version: string | null;
  /** Hooks report every tool call and enforce the guard rails; the others report only when a turn ends. */
  integrated: boolean;
}

/** Messages on an agent's terminal socket (/ws/term?agent=<id>), server to browser. */
export type TermServerMessage =
  | { t: 'snapshot'; data: string; cols: number; rows: number; live: boolean } // the screen and scrollback so far
  | { t: 'data'; data: string }
  | { t: 'size'; cols: number; rows: number } // another viewer resized the terminal
  | { t: 'live'; live: boolean }; // a CLI is (or is no longer) running in it

/** Browser to server: keystrokes go to the running CLI; the size is the viewer's fitted terminal. */
export type TermClientMessage = { t: 'input'; data: string } | { t: 'resize'; cols: number; rows: number };

export interface AgentView {
  id: string;
  name: string;
  repoId: string;
  role: AgentRole;
  look: AgentLook;
  task: AgentTask | null;
  desk: number; // desk slot on the floor, 0 to FLOOR_SEATS - 1
  color: string; // shirt color
  hair: string; // hair color
  skin: string;
  style: AgentStyle | null; // the manager's picks in the look editor (null: the look seeded from their id)
  model: string; // '' = use the swarm default model, or a model id / alias
  effort: EffortLevel | ''; // '' = use the swarm default effort
  cli: AgentCli | ''; // the CLI they run in the terminal runtime ('' = the office default)
  host?: MachineHost; // where their machine is: an Upstash Box, or this computer (absent: local; the CEO always is)
  cloud?: CloudMachineState; // their Box's state (absent for local agents)
  needsSignIn?: boolean; // a cloud agent whose coding agent waits for the manager to sign it in, in their terminal (docs/cloud.md)
  terminal: boolean; // they have a terminal to watch (the terminal runtime); otherwise their log lines are the screen
  status: AgentStatus;
  issueNumber: number | null; // the issue being built, or the one the PR under test or fix closes
  issueTitle: string | null; // the issue's title, or the PR's while testing or fixing it
  branch: string | null;
  prNumber: number | null; // the PR they opened, are testing or are fixing
  prUrl: string | null;
  currentTool: string | null; // while preparing: the setup step (INSTALL_STEP), null for the worktree
  startedAt: number | null;
  endedAt: number | null;
  costUsd: number;
  turns: number;
  browserUrl: string | null;
  hasScreenshot: boolean;
  screenshotAt: number | null;
  lastError: string | null;
  blocked?: string | null; // waiting on a prompt the office couldn't answer (server/unblock.ts): why
  waiting?: AgentQuestion['to'] | null; // waiting on an answer to their question (shared/questions.ts): from whom
  career: CareerView | null; // their record on the team (#226); null for the CEO
  log: LogLine[]; // the terminal log: hiring answers with it; snapshots leave it empty (tabs get lines by watch, shared/watch.ts)
  activity?: AgentActivity | null; // what they're doing right now, safe to show anyone (null: nothing, e.g. idle)
  tools?: ToolSwitches; // their own Tools & skills switches on top of Everyone's (absent for the CEO, whose are in settings)
}

/** The kinds of work the icon over a busy agent shows (shared/activity.ts maps tools and status to them). */
export type ActivityKind = 'read' | 'edit' | 'test' | 'build' | 'browse' | 'git' | 'ci' | 'qa' | 'fix' | 'talk' | 'run' | 'blocked' | 'waiting';

/** An agent's current activity: a kind and a short, redacted detail ("store.ts", "npm test"; '' for none). */
export interface AgentActivity {
  kind: ActivityKind;
  detail: string;
}

/** One line on a floor's activity ticker ("Ken opened PR #212"), worked out by the server from what changed. */
export interface TickerItem {
  id: number;
  repoId: string;
  at: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

/** What an agent is told for one kind of task (the CEO: its one prompt). */
export interface PromptPart {
  label: string; // e.g. "Building an issue", "Testing a pull request"
  text: string;
}

/** GET /api/agents/:id/prompt: what the agent is told on each kind of task, with placeholders for the task's details. */
export interface AgentPromptView {
  kind: 'agent' | 'ceo';
  parts: PromptPart[];
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type QaStatus =
  | 'queued' // waiting for a free agent to test it
  | 'testing' // an agent is testing it
  | 'passed' // ready to merge
  | 'failed' // failed; waiting for its author (or any free agent) to fix it
  | 'fixing' // an agent is fixing what QA found
  | 'needs-human'; // failed too many rounds, or nobody can fix it automatically

export interface QaCheck {
  name: string;
  result: 'pass' | 'fail' | 'skip';
  details: string;
}

export interface QaView {
  repoId: string;
  prNumber: number;
  status: QaStatus;
  round: number; // 1-based QA round
  devAgentId: string | null; // the agent who wrote it, or took over its fixes (null for PRs opened outside the swarm)
  qaAgentId: string | null; // the agent testing it, or who last did
  summary: string | null; // latest QA summary
  checks: QaCheck[];
  commentUrl: string | null; // the PR comment with the latest QA report
  mergeNote: string | null; // where auto-merge stands once QA passed, e.g. "waiting for checks: Vercel"
  ceoLooking: boolean; // needs-human, and the CEO has a triage job for it (queued or running) before the manager hears
  updatedAt: number;
  shots?: QaShotView[]; // QA's screenshots from the latest round (absent: none)
}

/** A screenshot from QA's latest round on a PR, served at /api/repos/:repo/pulls/:n/qa-shots/:index. */
export interface QaShotView {
  caption: string;
  page: string | null; // the page it shows
  mime: string;
}

export interface SwarmSettings {
  sessionLimit: number; // most agent sessions running at once; 0 = no limit
  memory: MemorySettings; // memory headroom, the per-session ceiling and learned estimates (shared/health.ts)
  testLab: TestLabSettings; // the test lab's switch and how many jobs it runs at once (shared/testLab.ts)
  defaultModel: string;
  defaultEffort: EffortLevel;
  taskEffort: Partial<Record<TaskKind, EffortLevel>>; // effort per kind of task (#18); an agent's own wins, and a kind without one runs at the default
  runtime: AgentRuntime;
  defaultCli: AgentCli; // what agents run in their terminals unless they have their own
  scaling: 'approve' | 'auto'; // the CEO's team changes wait for the manager (new agents wait in the lobby), or apply at once
  maxAgents: number; // most agents on a floor: 1 to FLOOR_SEATS (DEFAULT_MAX_AGENTS)
  ceoHeartbeatMin: number; // minutes between the CEO's periodic reviews; 0 = off
  researchMin: number; // a research job's time budget in minutes, after which the CEO wraps up with what it has
  ceoFollowups: FollowupSettings; // Settings → The CEO: which office events wake the CEO for a follow-up (shared/followups.ts)
  ceoMandates: CeoMandate[]; // the manager's standing mandates: follow-ups may file issues on the floors they cover
  ceoAwake: CeoAwakeSettings; // Settings → The CEO: its kept session, waits and consults (shared/ceoAwake.ts)
  managerName: string; // what the office calls you
  companyName: string;
  dogName: string; // the office dog's name, on its tag and in the hint when you aim at it
  projectsDir: string; // where your project folders live; new projects are created here
  setupDone: boolean; // the first-run setup wizard has been completed or skipped
  tutorialStep: number; // index of the current tutorial step; -1 when finished or skipped
  autoUpdate?: boolean; // update the office itself once it's quiet (absent on servers without self-update)
  updateSettleMin?: number; // an automatic update waits this long after the latest commit (at most 15 min after the first), so a run of merges is one restart
  pacingSessions: number; // after Claude warns about usage, new issues start only while fewer sessions than this run
  trimIdleDesksMin: number; // a desk idle this many minutes loses its node_modules and build output; 0 = never
  dailyLogDir: string; // the daily work log's folder (#49); '' = /opt/ai-vault/daily when it exists, else <SWARM_HOME>/daily
  historyDays: number; // days the session history and its transcripts are kept; 0 = forever
  voice: VoiceSettings;
  themes: ThemeSettings; // holiday themes: Settings → Themes (shared/themes.ts)
  weather: WeatherSettings; // Settings → Weather: the calm cycle, off, or the manager's real local weather
  worldEvents: WorldEventSettings; // Settings → World events: how often something happens outside
  listen: ListenSettings;
  notify: NotifySettings;
  cloud: CloudSettings;
  tools: ToolSettings; // Tools & skills: what Everyone's and the CEO's sessions load (shared/tooling.ts)
  everyProject: EveryProject; // Settings → Every project: the practice switches every floor inherits (#24)
  officePlaybook: string; // above every floor's playbook in builders', fixers' and QA's prompts (up to OFFICE_PLAYBOOK_MAX)
}

/** What the office tells the manager about when they're away (docs/pocket.md). */
export type NotifyEvent = 'needsHuman' | 'question' | 'ceoMessage' | 'hire' | 'agentError' | 'usage' | 'memory' | 'merge' | 'decisions';

/** Where it tells them: this browser, Web Push to their devices, a chat app's webhook, or their own Telegram bot. */
export type NotifyChannel = 'desktop' | 'push' | 'ntfy' | 'telegram';

/** The chat apps, whose webhook URLs and tokens live in the server's secrets file. */
export type NotifyWebhook = 'ntfy';

export interface NotifySettings {
  events: Record<NotifyEvent, boolean>;
  channels: Record<NotifyChannel, boolean>; // a chat app also needs its webhook saved
  officeUrl: string; // where messages link back to ('' = no link), e.g. a Tailscale Serve URL
  telegramMirror: boolean; // every CEO message also goes to Telegram (otherwise only replies to messages sent from there)
}

/** A channel's last send since the office started: when, and whether it arrived (else why not). */
export interface NotifyHealth {
  at: number;
  ok: boolean;
  error: string;
}

/** A device that gets Web Push. `id` is derived from its subscription, which never leaves the server. */
export interface PushDeviceView {
  id: string;
  name: string;
  addedAt: number;
  last: NotifyHealth | null;
}

/** Which chat apps have a webhook saved (only a hint of it: the secret never leaves the server), the push devices and each channel's last send. */
export interface NotifyChannelsView {
  webhooks: Record<NotifyWebhook, { set: boolean; hint: string; last: NotifyHealth | null }>;
  pushDevices: number;
  devices: PushDeviceView[];
  desktop: NotifyHealth | null;
  telegram: TelegramView;
}

/** The manager's Telegram bot (docs/pocket.md): its token and their chat id stay on the server. */
export interface TelegramView {
  set: boolean; // a bot token is saved
  bot: string; // its username, e.g. "my_office_bot"
  linked: boolean; // the manager pressed Start in their chat
  chat: string; // that chat's first name, for "Linked to …"
  linking: boolean; // a Start link is waiting to be pressed
  on: boolean; // Settings' Telegram switch: off, nothing is read, retried or sent; the token and chat are kept
  polling: 'off' | 'ok' | 'retrying'; // reading the bot's messages ('off' while there's no token or the switch is off)
  error: string; // why the last read failed, while retrying
  okAt: number | null; // when reading last worked
  advice: string; // what to check after repeated failures
  last: NotifyHealth | null; // its last send
}

/** A test push to one device: the push service took it, the device is gone (and dropped), or another error. */
export interface PushTestView {
  outcome: 'delivered' | 'expired' | 'error';
  status: number;
  message: string;
}

/** A notification the office sent: a browser with the office open but hidden shows it as a desktop notification. */
export interface NoteView {
  id: string;
  event: NotifyEvent | 'test';
  title: string;
  body: string;
  at: number;
  url: string; // in-app link, e.g. '/?tab=approvals'
}

/** The notification centre (#107, shared/notices.ts): what a notice is about, and the buttons it offers. */
export type NoticeKind = 'merge' | 'qaPass' | 'qaFail' | 'needsYou' | 'ceo' | 'stuck' | 'usage' | 'error' | 'approval' | 'update';
/** Each maps to an existing api call or panel in the client (ui/noticeActions.ts), never to a URL from the server. */
export type NoticeAction = 'openPr' | 'openQa' | 'approve' | 'reply' | 'terminal' | 'retry' | 'approvals';
type NoticeTarget = DistributiveOmit<Exclude<ChatRef, { kind: 'file' }>, 'start' | 'end'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export interface NoticeView {
  id: string; // a push or Telegram message about it carries the same id (?note=), so opening one marks it read
  at: number;
  kind: NoticeKind;
  level: 'info' | 'success' | 'error';
  title: string;
  text: string;
  floor?: number;
  target?: NoticeTarget; // where tapping it jumps (the chat's refs, #26)
  actions?: NoticeAction[]; // at most 2
  requestId?: string; // the team change 'approve' approves
  read: boolean;
}

/** Who reads phone messages aloud: nobody, the browser's own voice, or ElevenLabs (with the manager's key). */
export type VoiceProvider = 'off' | 'browser' | 'elevenlabs';

export interface VoiceSettings {
  provider: VoiceProvider;
  voiceId: string; // the ElevenLabs voice (or the browser voice's name)
  voiceName: string;
  model: string; // ElevenLabs model id
  speakOffice: boolean; // read the office's own notes too, not just the CEO's messages
  keepDays: number; // saved clips older than this are deleted (1–90; the newest 20 CEO messages' clips always stay)
}

/** Who turns the manager's speech into text: nobody (no 🎙), the browser's own recognition, or ElevenLabs (with the key). */
export type ListenProvider = 'off' | 'browser' | 'elevenlabs';

/** Talking instead of typing (docs/voice.md): the 🎙 by every message box, and the phone's hands-free conversation. */
export interface ListenSettings {
  provider: ListenProvider;
  autoSend: boolean; // send once you stop talking (about 1.2 s of quiet), not only when you press Send
  handsFree: boolean; // after the CEO's spoken reply, the phone listens for up to 8 s and sends what it hears
}

/** The voice's saved clips: how many and how big, and which phone messages can be replayed from them. */
export interface VoiceCacheView {
  clips: number;
  bytes: number;
  saved: number[]; // message ids with every clip still on disk
}

/** GET /api/voice/voices: a voice the manager can pick. recommended: on docs/voice.md's shortlist. */
export interface VoiceOption {
  id: string;
  name: string;
  category: string;
  labels: { accent: string; gender: string; age: string; description: string; use_case: string };
  previewUrl: string | null;
  recommended: boolean;
}

/** The last usage warning Claude gave: which limit ("weekly limit"), how full it was (0-100), when it resets, and when it came. */
export interface UsageWarningView {
  limit: string | null;
  pct: number | null;
  resetsAt: number | null;
  at: number;
}

/** Claude's subscription usage: normal, pacing new work after a usage warning, or paused at the limit until `until`. */
export interface UsageView {
  state: 'normal' | 'pacing' | 'paused';
  until: number | null;
  warning: UsageWarningView | null; // the latest since the office started, for the usage meter
}

/**
 * Claude's latest reading of one usage limit, from any session's status line or rate-limit event. These are the whole
 * subscription's numbers, so they include usage outside the office (claude.ai, other Claude Code sessions).
 */
export interface UsageReading {
  type: string; // Claude's rate limit type: five_hour, seven_day, seven_day_opus, …
  pct: number; // how full, 0-100
  resetsAt: number | null; // epoch ms
  at: number; // when it was read
}

/** Why the office's own idle check of Claude's usage (#89) found nothing: no login on file, an expired one, or it failed. */
export type UsageCheckError = 'no-login' | 'expired' | 'failed';

// Mission control's numbers live in ./ops.ts.
export type { OpsAlarm, OpsFloor, OpsNumbers, OpsView } from './ops.ts';

/** What the office doctor's one-click fixes do (#262): the console's own actions, nothing new. */
export type DoctorFix = 'clear' | 'stop' | 'requeue' | 'retry-qa' | 'send-back' | 'close-issue';

/** Something stuck the watchdog has no safe remedy for, or already remedied within the hour (server/watchdog.ts). */
export interface DoctorFinding {
  id: string; // stable while the problem lasts
  kind: 'quiet' | 'preparing' | 'stale' | 'qa-orphan' | 'fix-orphan' | 'unclosed';
  repoId: string;
  agentId: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  text: string;
  fixes: DoctorFix[];
  since: number;
}

/**
 * Where the office's own update stands. none: up to date · available: new commits on GitHub · waiting / draining:
 * starting nothing new while running sessions finish · updating: handed to the launcher · failed: see detail.
 */
export type OfficeUpdateState = 'none' | 'available' | 'waiting' | 'settling' | 'draining' | 'updating' | 'failed';

export interface OfficeUpdateView {
  state: OfficeUpdateState;
  behind: number; // commits the office's folder is behind GitHub
  launcher: boolean; // started by npm run dev / npm start, which can install the update and restart the office
  drainingSince: number | null;
  running: number; // sessions still running that an office restart would stop (CLIs in the terminal keeper or a Box carry on)
  updateAt: number | null; // settling: when the update goes ahead unless another commit lands
  holds: boolean; // nothing new starts until the office has restarted
  detail: string | null;
}

/**
 * One change to a floor's team: a new agent (they wait in the lobby, where the manager can set them up before they're
 * created) or an agent leaving. The CEO's scale_team makes them; with scaling on auto they're decided at once.
 */
export interface HireRequestView {
  id: string;
  kind: 'hire' | 'let-go';
  repoId: string;
  agentId: string | null; // let-go: who; hire: who was hired once approved
  name: string; // the new agent's name (let-go: the agent's name)
  reason: string;
  cli: AgentCli | ''; // the coding agent they'll run ('' = the office default)
  host?: MachineHost | ''; // where they'll work ('' or absent = the office default, Settings → Cloud agents)
  model: string; // '' = the default model
  effort: EffortLevel | '';
  look: AgentLook;
  color: string;
  hair: string;
  skin: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string; // the manager's reason when rejecting
  createdAt: number;
  decidedAt: number | null;
  decidedBy: 'manager' | 'auto' | null;
}

/**
 * Where a manager's message to the CEO is (shared/chat.ts nextDelivery): sending and failed live only in the phone
 * that sent it; the office records sent, read (the CEO's session took it, or their reply job started) and replied.
 */
export type Delivery = 'sending' | 'sent' | 'read' | 'replied' | 'failed';
export type ServerDelivery = Extract<Delivery, 'sent' | 'read' | 'replied'>;

/** One message in the phone thread between the manager and the CEO. */
export interface PhoneMessage {
  id: number;
  from: 'ceo' | 'manager' | 'office'; // office = notes from the building itself (decisions, errors)
  text: string;
  at: number;
  requestId?: string; // a hire / let-go proposal this message is about
  voice?: Exclude<VoiceProvider, 'off'>; // who read it aloud when it arrived (absent: nobody), for the phone's ▶ replay
  telegram?: 'in' | 'out'; // in: the manager sent it from Telegram; out: the CEO's message also went there
  replyTo?: number; // replies to this one (its id): the manager's quote, or the CEO's answer to it (shared/reactions.ts)
  delivery?: ServerDelivery; // the manager's messages only (absent on messages saved before delivery was tracked)
  suggestions?: string[]; // the CEO's tappable replies (shared/chatParts.ts)
  artifacts?: ChatArtifact[]; // the CEO's longer content, shown as cards that open full-screen
  attachments?: FileRef[]; // files sent with it, in the office's files store (shared/files.ts)
  used?: UsedView; // the CEO's: the skills, connectors and tools it used for this reply (shared/used.ts)
  refs?: ChatRef[]; // the office things it names (@Ada, floor 2 #13, file: …), in text order (shared/chatRefs.ts)
  research?: { topic: string; repoId?: string }; // the CEO's reply to a research job (repoId: from a floor's Plan dialog); a reply to it becomes a plan (server/research.ts)
  question?: string; // the CEO's: it asks the manager this agent question (its id): answers go to the agent
  steps?: string[]; // the CEO's: the steps it took for this reply (shared/ceoStream.ts)
  actions?: ChatAction[]; // the CEO's: what its office tools changed for this reply, as cards (shared/ceoActions.ts)
  idea?: ChatIdea; // the CEO's: a suggestion about the office's structure, as a card with Accept (shared/chatParts.ts)
  edited?: number; // when its sender last edited it (#125: anyone's, shared/messageEdits.ts)
  versions?: MessageVersion[]; // its earlier texts, oldest first (at most MESSAGE_VERSIONS_MAX with the current one)
  status?: StatusReaction; // the manager's: the office's reaction as the CEO's job on it moves (shared/reactions.ts)
  reactions?: MessageReaction[]; // the manager's and the CEO's, oldest first
  tg?: number; // its Telegram message id, for one the manager sent from there
  notice?: ChatNotice; // the office's: a system notice (an update held back, rolled back…) shown as a card
}

/** The office's own reaction under a manager's message (#118): 🕓 queued, 👀 seen, ⏳ working, ✅ done, ⚠️ failed or stopped. */
export type StatusReaction = 'queued' | 'seen' | 'working' | 'done' | 'failed';
export interface MessageReaction { emoji: string; by: 'ceo' | 'manager' }

/** An earlier text of an edited message: when it was written, and why its sender replaced it (the CEO's edit_message). */
export interface MessageVersion {
  text: string;
  at: number;
  reason?: string;
}

/** A system notice in the chat (#138), shown as a card headed by the message's text: the cleaned output behind it, and links to what it's about. */
export interface ChatNotice {
  details?: string;
  links?: { label: string; url: string }[];
}

/** The CEO chat beyond its messages (#51): the reply being written, the conversations and the manager's pinned notes. */
export interface CeoChatView {
  live: CeoLive | null;
  current: string; // the conversation the phone shows
  conversations: Conversation[];
  memory: MemoryNote[];
}

/** Something in the office a chat message names; `start`/`end` are its span in the message's text. */
export type ChatRef = { start: number; end: number } & (
  | { kind: 'agent'; agentId: string; terminal?: true }
  | { kind: 'floor'; repoId: string }
  | { kind: 'issue'; repoId: string; number: number } // an issue or a pull request
  | { kind: 'file'; repoId: string; path: string; line?: number }
  | { kind: 'qa'; repoId: string; number: number }
  | { kind: 'preview'; repoId: string; number?: number } // a PR's in the PR theatre, else the floor's app
);

/** GET /api/messages/:id/refs/:index/file: a file ref's text from the floor's default branch, size-capped. */
export interface RefFileView {
  path: string;
  line: number | null;
  text: string;
  url: string; // the file on GitHub, at the line
}

/** A CEO message's ```idea block: a change to how the office works, which Accept sends as `message`. */
export interface ChatIdea {
  kind: 'objective' | 'focus' | 'mandate' | 'experiment' | 'research' | 'charter' | 'team' | 'plan';
  title: string;
  message: string;
}

/** A CEO message's artifact: a titled markdown document shown as a card. */
export interface ChatArtifact {
  id: string; // `<message id>-<n>`
  title: string;
  lead: string; // its first line, plain words, for the card
  markdown?: string; // absent when the snapshot left it out: GET /api/messages/:id/artifacts/:artifactId
}

export type CeoJobKind = 'onboard' | 'plan' | 'review' | 'chat' | 'triage' | 'followup' | 'research';

export interface CeoInfo {
  queue: { kind: CeoJobKind; label: string }[]; // jobs waiting for the CEO
  job: { kind: CeoJobKind; label: string } | null; // what the CEO is doing now
  lastReviewAt: number | null;
  nextReviewAt: number | null; // null when the heartbeat is off
  followups?: { pending: string[]; startsAt: number | null; held: 'usage' | 'cap' | null }; // events waiting for a follow-up job (absent in old journals)
  session?: CeoSessionView; // its kept session (#28; absent in old journals)
  held?: CeoHeld | null; // why the manager's queued message can't start a CEO turn (server/ceoLane.ts)
  questions?: AgentQuestion[]; // agents waiting on an answer, oldest first (shared/questions.ts; absent in old journals)
}

/** Only Claude's usage limit holds the CEO's chat (#46): the phone shows it above the composer, with the reset time. */
export interface CeoHeld {
  reason: 'usage';
  until: number;
}

/** One player on a floor's ping-pong leaderboard: the manager or an agent, with their games on that floor. */
export interface PongRow {
  id: string; // 'player' for the manager (shared/pong.ts PONG_PLAYER), else an agent id
  name: string; // as of their last game
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  lastAt: number; // epoch ms of their last game
}

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
  requests: HireRequestView[];
  ceo: CeoInfo;
  messages: PhoneMessage[];
  phoneReadAt: number; // CEO messages newer than this are unread
  notices: NoticeView[]; // the notification centre's, newest last (shared/notices.ts keeps them)
  decisions?: Decision[]; // questions waiting on the manager (#114, shared/decisions.ts); absent in a replay
  version?: string; // the cubefarm version the server runs (package.json)
  officeCommit?: string | null; // short sha the server started on (absent on servers without self-update)
  officeUpdate?: OfficeUpdateView;
  publicDemo?: { resetHours: number }; // the demo for visitors (#95): what they can't change, and when it starts over
  usage: UsageView;
  health?: HealthView; // memory, load and sessions, for the health strip (#55); absent in a replay
  claudeUsage: UsageReading[]; // the latest reading per limit, for the usage meter (none until a session reports)
  claudeUsageCheck?: UsageCheckError | null; // the office's last idle check failed (#89), null once one reads
  ops: OpsView;
  doctor?: DoctorFinding[]; // the office doctor's findings the manager hasn't ignored
  clis: CliView[];
  voiceKeySet: boolean; // an ElevenLabs key is saved (the key itself never leaves the server)
  voiceKeyHint: string; // its last 4 characters, '' when none
  voiceCache: VoiceCacheView;
  weather: WeatherView; // the real local weather's place and latest reading (Settings → Weather)
  ticker?: TickerItem[]; // the floors' recent ticker lines, oldest first
  notifyChannels: NotifyChannelsView;
  cloud?: CloudView; // Settings → Cloud agents: the Upstash account and the credentials cloud agents use
  progress: ProgressView; // coins, decorations and achievements (#210)
  pong: Record<string, PongRow[]>; // each floor's ping-pong leaderboard by repo id, best first
  files: FileView[]; // the chat's files store, newest first (metadata only)
  tooling?: ToolInventory; // Tools & skills: what a Claude Code session on this machine loads (server/tooling.ts)
  experiments?: LabView; // the lab's experiments, their results and the running ones' issues (shared/experiments.ts)
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
  | { type: 'screen'; agentId: string; url: string | null; at: number }
  | { type: 'qa'; qa: QaView }
  | { type: 'qaRemoved'; repoId: string; prNumber: number }
  | { type: 'prPreview'; preview: PrPreviewView }
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
  /** The CEO chat changed: what's given replaces the tab's (messages: another conversation opened; message: one edited). */
  | ({ type: 'ceoChat'; messages?: PhoneMessage[]; message?: PhoneMessage } & Partial<CeoChatView>)
  | { type: 'officeUpdate'; officeUpdate: OfficeUpdateView }
  | { type: 'usage'; usage: UsageView }
  | { type: 'health'; health: HealthView }
  | { type: 'testLab'; testLab: TestLabView }
  | { type: 'claudeUsage'; readings: UsageReading[]; check?: UsageCheckError | null }
  | { type: 'ops'; ops: OpsView }
  | { type: 'doctor'; doctor: DoctorFinding[] }
  | { type: 'clis'; clis: CliView[] }
  | { type: 'voiceKey'; voiceKeySet: boolean; voiceKeyHint: string }
  | { type: 'voiceCache'; voiceCache: VoiceCacheView }
  | { type: 'weather'; weather: WeatherView }
  | { type: 'ticker'; item: TickerItem }
  | { type: 'notifyChannels'; notifyChannels: NotifyChannelsView }
  | { type: 'cloud'; cloud: CloudView }
  | { type: 'tooling'; tooling: ToolInventory }
  | { type: 'experiments'; experiments: LabView }
  /** A session (or merge) went into the history (#49): an open History screen shows it. */
  | { type: 'history'; entry: HistoryEntry }
  | { type: 'notify'; note: NoteView }
  | { type: 'progress'; progress: ProgressView }
  | { type: 'reward'; reward: RewardView }
  | { type: 'pong'; repoId: string; board: PongRow[] }
  /** A plain toast, or with the notice fields a rich one that also joins the notification centre. */
  | ({ type: 'toast'; level: 'info' | 'success' | 'error'; text: string } & Partial<Omit<NoticeView, 'level' | 'text'>>)
  /** Notices marked read (in any tab, or by opening their push). */
  | { type: 'noticesRead'; ids: string[] }
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

// ---------- presence: everyone viewing the office appears in it as a visitor ----------

/** Someone else in the 3D office (a tab or device that entered it and appears to others). */
export interface VisitorView {
  id: string;
  name: string; // cleaned by the server (shared/presence.ts cleanName)
  color: string; // #rrggbb
  floor: number; // 0 = lobby, -1 = the roof
}

/** What a visitor carries, as the others draw it. `s`: a mug's sips left (0–3). */
export interface VisitorHeld {
  k: 'ball' | 'mug' | 'blaster';
  id: string;
  s?: number;
}

/**
 * Where a visitor stands: floor, position (metres), heading (yaw, 0 facing -Z), look pitch and what they hold. `ts`:
 * when, on the sender's own clock (ms), so others space their poses as they were sent, not as they happened to arrive.
 */
export interface VisitorPose {
  ts: number;
  f: number;
  x: number;
  z: number;
  h: number;
  p: number;
  held: VisitorHeld | null;
}

export type EmoteId = 'wave' | 'thumbs' | 'clap' | 'point' | 'laugh';

/**
 * Browser to server on /ws. resync: send a fresh snapshot (a tab back from the time-lapse replay); lines: which
 * agents' terminal lines this tab shows (shared/watch.ts). The rest: presence.
 */
export type ClientEvent = { type: 'resync' } | ({ type: 'lines' } & Watch) | PresenceEvent;

/**
 * A tab's presence (shared/presence.ts). hello: your name and colour · pose: you're in the office and appear to others ·
 * watch: you're in the office on floor f but don't appear · away: not in the office · fakes: the demo's fake visitors.
 */
export type PresenceEvent =
  | { type: 'hello'; name: string; color: string }
  | ({ type: 'pose' } & VisitorPose)
  | { type: 'watch'; f: number }
  | { type: 'away' }
  | { type: 'emote'; e: EmoteId }
  | { type: 'ping'; x: number; y: number; z: number; label: string }
  | { type: 'fakes'; n: number };

export interface GhRepoSummary {
  nameWithOwner: string;
  description: string;
  visibility: string;
  updatedAt: string;
}
