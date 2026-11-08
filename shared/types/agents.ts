// Agents: who they are, what they run and where, their terminals and the team changes that hire or let them go. Imported through shared/types.ts.
import type { CareerView } from '../careers.ts';
import type { AgentStyle } from '../looks.ts';
import type { AgentQuestion } from '../questions.ts';
import type { ToolSwitches } from '../tooling.ts';

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
  '- A demo office you start must be stopped before you finish.',
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

/** Where new agents work: one place, or 'hybrid': this computer while it has room, else a Box (#260). */
export type MachineKind = MachineHost | 'hybrid';

/** Settings → Cloud agents → Hybrid (#260). */
export interface HybridSettings {
  localMax: number; // most agents on this computer (0: no cap besides memory and the session limit)
  burst: boolean; // add a cloud agent by itself when ready work waits for memory
  burstAfterMin: number; // how long work waits for memory before one is added
  burstMax: number; // most cloud agents added that way at once
  burstIdleMin: number; // an added one leaves after this long without a task
}

/** Settings → Cloud agents. */
export interface CloudSettings {
  machineKind: MachineKind; // where new agents work ('local' unless the manager turns the cloud on)
  boxSize: BoxSize;
  boxLimit: number; // the Upstash plan's most Boxes (the free plan's 10), counted before a cloud agent is hired
  hybrid: HybridSettings;
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
  trouble?: { kind: KeyTrouble; at: number }; // its API key ran out of credit or was turned away: cloud agents use their own login (shared/keyTrouble.ts)
}

/** An API key cloud agents were given that stopped working: out of credit (or a spend limit), or turned away as invalid. */
export type KeyTrouble = 'out-of-credit' | 'invalid';

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

/** One model a coding agent can run (#198), from its live list or the office's built-in one (shared/models.ts). */
export interface ModelEntry {
  id: string; // what the agent is started with
  label: string; // "Opus 5.5"
  cli: AgentCli;
  source: 'live' | 'built-in';
  checkedAt: number;
  alias?: boolean; // Claude Code's opus / sonnet / haiku: they float to the newest model
  isDefault?: boolean; // what the agent picks when it's given none
}

/** The model catalog: every coding agent's models, cached in the state dir, refreshed at boot, daily and on demand. */
export interface ModelCatalogView {
  entries: ModelEntry[];
  checkedAt: number; // 0: never
  refreshing?: boolean;
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
  burst?: number; // when Hybrid's burst added them because this computer was full (#260); they leave when idle
  needsSignIn?: boolean; // a cloud agent whose coding agent waits for the manager to sign it in, in their terminal (docs/cloud.md)
  signInWhy?: KeyTrouble; // while needsSignIn: the office's API key stopped working, so they switched to their own login
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
  reviewedBy?: string | null; // the CEO's name while it decides about a manager's change to their running work (#207)
  career: CareerView | null; // their record on the team (#226); null for the CEO
  log: LogLine[]; // the terminal log: hiring answers with it; snapshots leave it empty (tabs get lines by watch, shared/watch.ts)
  activity?: AgentActivity | null; // what they're doing right now, safe to show anyone (null: nothing, e.g. idle)
  tools?: ToolSwitches; // their own Tools & skills switches on top of Everyone's (absent for the CEO, whose are in settings)
  account?: string; // the account (id) or tag they're pinned to (#247); absent: the rotation
  voiceId?: string; // their ElevenLabs voice ('' none; absent for the CEO, whose voice is settings.voice); #320
  voiceName?: string;
}

/** The kinds of work the icon over a busy agent shows (shared/activity.ts maps tools and status to them). */
export type ActivityKind = 'read' | 'edit' | 'test' | 'build' | 'browse' | 'git' | 'ci' | 'qa' | 'fix' | 'talk' | 'run' | 'blocked' | 'waiting';

/** An agent's current activity: a kind and a short, redacted detail ("store.ts", "npm test"; '' for none). */
export interface AgentActivity {
  kind: ActivityKind;
  detail: string;
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
