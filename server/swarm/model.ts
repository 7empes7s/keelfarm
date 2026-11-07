// The Swarm's persisted shapes, runtimes and constants, shared by its layers (server/swarm/*.ts).
import path from 'node:path';
import type { SessionHandle } from '../agentRunner.ts';
import type { ChatLog } from '../../shared/agentChat.ts';
import type { BoxCliRecord } from '../boxCli.ts';
import type { BoxSignIn } from '../cliRunner.ts';
import { HOME_DIR } from '../config.ts';
import type { CeoJob } from '../ceo.ts';
import type { LearnedPull } from '../closeCleanup.ts';
import type { PreQa } from '../qaOutcome.ts';
import type { RestartCounts } from '../reconcile.ts';
import type { OpsHistory } from '../metrics.ts';
import { cliLabel } from '../clis.ts';
import type { LedgerState } from '../ledger.ts';
import type { LabState } from '../experiments.ts';
import type { AgentTerminal } from '../terminal.ts';
import { cleanTerminalText } from '../../shared/terminalText.ts';
import type { ToolSwitches } from '../../shared/tooling.ts';
import type { PracticeOverrides } from '../../shared/practices.ts';
import type { FollowupState } from '../../shared/followups.ts';
import type { ChatsState } from '../../shared/conversations.ts';
import type { MemoryNote } from '../../shared/ceoMemory.ts';
import type { AgentStyle } from '../../shared/looks.ts';
import type { CharterRecord } from '../../shared/charter.ts';
import type { CharterInsights } from '../../shared/charterStats.ts';
import type { DecisionsState } from '../../shared/decisions.ts';
import type { RoundCause } from '../../shared/rounds.ts';
import { DEFAULT_MAX_AGENTS, FLOOR_SEATS } from '../../shared/types.ts';
import type {
  AgentCli,
  AgentLook,
  AgentQuestion,
  AgentRole,
  AgentStatus,
  AgentTask,
  EffortLevel,
  HireRequestView,
  IssueInfo,
  LogLine,
  MachineHost,
  NoticeView,
  PhoneMessage,
  PongRow,
  PreviewConfig,
  PullInfo,
  QaView,
  RepoView,
  ServerEvent,
  SwarmSettings,
  UsageReading,
} from '../../shared/types.ts';

// ---------- persisted shape ----------

export interface PersistedRepo {
  id: string;
  fullName: string;
  description: string;
  url: string;
  defaultBranch: string;
  floor: number;
  color: string;
  autoAssign: boolean;
  autoMerge: boolean; // PRs merge themselves once QA passes and GitHub's checks are green
  browserTesting: boolean;
  links: string[]; // other connected repos this floor's agents may read
  localPath: string | null; // the manager's own project folder (null: a clone under WORKSPACE_ROOT)
  mission: string;
  summary: string;
  qaBrief: string;
  playbook: string;
  trustedAuthors?: string[]; // the floor's allow-list besides the owner, the office and write collaborators (#185)
  labCommands?: string[]; // lab_run's allowlist on this floor beyond the default (#56), from the CEO's set_floor_profile
  preview: PreviewConfig; // how the floor's app runs for the preview monitor
  practices?: PracticeOverrides; // its own version-control practice switches over Every project's (#24)
  addedAt: number;
  /** The charter besides its mission (#48), the CEO's pending proposal, who changed what, and the drift view's log. */
  charter: CharterRecord;
}

export interface PersistedAgent {
  id: string;
  name: string;
  repoId: string; // '' for the CEO, who works in the lobby
  role: AgentRole;
  look: AgentLook;
  task: AgentTask | null;
  desk: number; // one numbering per floor, 0 to FLOOR_SEATS - 1
  color: string;
  hair: string;
  skin: string;
  style: AgentStyle | null; // the look editor's picks (null: seeded from the id)
  model: string;
  effort: EffortLevel | '';
  cli: AgentCli | ''; // '' = the office's default CLI
  machine: string | null; // their machine (machines.ts); null for an agent from before machines, until their next task
  host?: MachineHost; // 'box': their machine is an Upstash Box (docs/cloud.md); absent: a folder on this computer
  boxCli?: BoxCliRecord | null; // a cloud agent's live CLI in their Box, to pick up again after a restart
  needsSignIn?: boolean; // a cloud agent whose CLI waits for the manager to sign it in, in their terminal (docs/cloud.md)
  tools?: ToolSwitches; // their own Tools & skills switches on top of Everyone's
  declared?: string[] | null; // the files they declared for their current task (file leases, #24); cleared with the task
  status: AgentStatus;
  issueNumber: number | null;
  issueTitle: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  startedAt: number | null;
  endedAt: number | null;
  costUsd: number;
  turns: number;
  sessionId: string | null;
  sessionCli: AgentCli | null; // the CLI whose session sessionId is: only it can resume it
  lastError: string | null;
  logTail: LogLine[];
}

/** A pull request's trip through QA. */
export interface QaRecord extends Omit<QaView, 'ceoLooking'> {
  issueNumber: number | null;
  devSessionId: string | null; // the dev's Claude Code session, resumed to fix QA findings
  fixInstructions: string | null;
  sessionFailures: number;
  testedSha: string | null; // the head commit QA is testing
  passedSha: string | null; // the head commit QA signed off on: auto-merge merges exactly that
  fixReason: 'qa' | 'checks' | 'conflict' | null; // why it was last sent back to a developer
  qaCause?: RoundCause | null; // why QA last failed it (#188): a QA fix's cause
  mergeFixes: number; // times it went back for failing checks or conflicts
  retests: number; // QA rounds caused by merge fixes or new commits rather than by QA failing it
  preQa: PreQa | null; // a conflict found before QA tested the head is being fixed
  noChangeSha: string | null; // the head a developer last said needed no change (one free re-test per commit)
  pendingSince: number | null; // when auto-merge started waiting on its checks
  mergeRetryAt: number | null; // GitHub refused the merge: try again after this
  alerted: boolean; // the manager has been told it's stuck
  rerunSha: string | null; // the head commit whose failed checks the office re-ran (once per commit)
  rerunAt: number | null;
  qaChecks: PullInfo['checks'] | null; // GitHub's checks when QA last failed it: a later re-run can be the fix
  stuckWhy: string | null; // why it last became needs-human, for the CEO's triage and the manager's alert
  triages: number; // CEO triage jobs it has had (triage.ts caps them)
  escalated: boolean; // needs-human and the manager has been told; cleared when it leaves needs-human
  labRetryRound: number | null; // the round QA already re-ran by itself after a lab error (#189)
  updatedSha?: string | null; // the head the office made bringing it up to date with the base before merging (#24)
}

/** The PR work a desk is being set up for. author: the PR's author before a fix was handed out (restored if it can't start). */
export type PrepJob = { rec: QaRecord; task: 'qa' } | { rec: QaRecord; task: 'fix'; author: string | null };
export const prepKey = (repoId: string, prNumber: number, task: PrepJob['task']) => `${repoId}#${prNumber}:${task}`;

/** Choices made when a project moves into the office. */
export interface FloorOptions {
  mission?: string; // brief for the CEO to plan from
  autoAssign?: boolean; // free agents pick up backlog issues as soon as they're filed
}

interface CeoState {
  queue: CeoJob[];
  job: CeoJob | null; // the job the CEO is on right now
  lastReviewAt: number | null;
  lastFingerprint: string | null; // company state at the last review; unchanged means the next review is skipped
  followups: FollowupState; // office events waiting for a follow-up job (shared/followups.ts)
  chats: ChatsState; // the chat's conversations; state.messages is the current one's thread (shared/conversations.ts)
  remember: MemoryNote[]; // the manager's pinned notes, in every CEO job's prompt (shared/ceoMemory.ts)
  kept: { turns: number; costUsd: number; startedAt: number | null; lastEndedAt: number | null }; // its kept session (#28)
}

/** An open issue whose PR was closed: auto-assign leaves it for the manager (closeCleanup.ts toHold). */
interface HeldIssue {
  repoId: string;
  issue: number;
  pr: number;
}

export interface Persisted {
  settings: SwarmSettings;
  repos: PersistedRepo[];
  agents: PersistedAgent[];
  qa: QaRecord[];
  requests: HireRequestView[];
  ceo: CeoState;
  messages: PhoneMessage[];
  phoneReadAt: number;
  notices: NoticeView[]; // the notification centre (shared/notices.ts)
  prLimits: number; // the PR budgets (PR_LIMITS_VERSION) needs-human records were judged by
  ops: OpsHistory; // mission control's rolling week of merges, QA verdicts, check runs and costs
  held: HeldIssue[];
  progress: LedgerState; // coins, decorations, achievements and careers (ledger.ts)
  pong: Record<string, PongRow[]>; // each floor's ping-pong leaderboard, by repo id
  officeId: string; // this office on a shared Upstash account: its Boxes carry it (docs/cloud.md)
  claudeUsage: UsageReading[]; // Claude's latest reading per usage limit, so a restart doesn't show none
  experiments: LabState; // the lab's experiments and the issues in them (experiments.ts)
  questions: AgentQuestion[]; // agents waiting on an answer (shared/questions.ts)
  decisions: DecisionsState; // questions waiting on the manager (#114, shared/decisions.ts)
}

export interface Shot {
  data: Buffer;
  mime: string;
  url: string | null;
  at: number;
}

export interface AgentRuntime {
  log: LogLine[];
  session: SessionHandle | null;
  currentTool: string | null;
  browserUrl: string | null;
  screenshot: { data: Buffer; mime: string; at: number } | null;
  shots: Shot[]; // every screenshot of the current session (QA evidence)
  terminal: AgentTerminal | null; // their terminal, once they've run in the terminal runtime
  qaResume?: { cwd: string; systemAppend: string } | null; // the QA run's one resume for a missing report, until used
  blocked?: { reason: string; since: number; told: boolean } | null; // waiting on a prompt the office couldn't answer (unblock.ts)
  chat?: ChatLog; // their chat (#120), from their sessions' transcripts and the manager's messages; not saved
}

export interface RepoRuntime {
  issues: IssueInfo[];
  pulls: PullInfo[];
  lastSync: number | null;
  syncError?: string;
  syncing: boolean;
  cloneStatus: RepoView['cloneStatus'];
  cloneError?: string;
  fetchedAt?: number; // when the latest issues/PRs fetch started
  lastMergedAt: string | null; // newest merge seen: a newer one means the folder needs a sync
  folderSync: string | null;
  merging: boolean;
  closedIssues: Map<number, number>; // issues the office learned are closed, and when (closeCleanup.ts)
  closedPulls: Map<number, LearnedPull>; // PRs it learned are closed or merged
  openAt: Map<string, number>; // `issue#<n>` / `pr#<n>` -> when GitHub said one the sync doesn't list is open
  insights?: CharterInsights; // the Charter tab's numbers, worked out at each sync and charter change (refreshInsights)
  writers?: { logins: string[]; at: number }; // collaborators with write access, as last asked (#185)
}

/** What startup reconciliation decided (reconcileRestart), for finishRestart once the floors have synced. */
export interface Restart {
  carryOn: PersistedAgent[];
  interrupted: PersistedAgent[];
  preparing: Set<PersistedAgent>;
  requeue: Set<PersistedAgent>;
  counts: RestartCounts;
}
// Every agent runs Claude Opus 5.5 at medium effort unless the manager overrides it.
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
// The CEO thinks harder than the staff: Opus 5.5 at xhigh effort unless the manager changes it.
export const CEO_MODEL = 'claude-opus-5-5';
export const CEO_EFFORT: EffortLevel = 'xhigh';
export const CEO_NAME = 'Morgan';
// The CEO's own folder: its notes about the company live here. Repos are read through their clones.
export const CEO_DIR = path.join(HOME_DIR, 'ceo');
// The chat's files (server/files.ts): outside every worktree, so agents only ever read them.
export const FILES_DIR = path.join(HOME_DIR, 'files');
// The other conversations' threads (server/ceoChat.ts).
export const CONVERSATIONS_DIR = path.join(HOME_DIR, 'conversations');
export const MAX_ISSUES_PER_JOB = 12;
export const KEEP_MESSAGES = 200;
export const KEEP_DECIDED_REQUESTS = 40;

export const BUSY: AgentStatus[] = ['preparing', 'working'];
export const FREE: AgentStatus[] = ['idle', 'done'];
// An agent whose session failed sits out this long before taking new work, so a broken setup can't burn through the queue.
export const ERROR_COOLDOWN_MS = 2 * 60_000;
// Auto-assign stops retrying an issue after this many failed sessions; the manager can still assign it by hand.
export const MAX_ISSUE_FAILURES = 2;
// Failed QA runs (sessions, or desks that couldn't be set up) before a PR goes to the manager.
export const MAX_QA_FAILURES = 2;
// How long the office waits after Claude's usage limit is hit when Claude doesn't say when it resets.
export const LIMIT_PAUSE_MS = 15 * 60_000;
export const READINGS_MS = 3000; // Claude's usage readings arrive with every status line: the office gets them at most this often
// Everyone on a floor this size or bigger busy at once is a full house (an achievement).
export const FULL_HOUSE = 4;
// Mission control's numbers are recomputed after these events (debounced), and every half minute for the clock's sake.
export const OPS_EVENTS = new Set<ServerEvent['type']>(['repo', 'repoRemoved', 'agent', 'agentRemoved', 'qa', 'qaRemoved', 'ceo']);
export const OPS_TICK_MS = 30_000;
// How often the watchdog looks for stuck work (watchdog.ts).
export const WATCHDOG_MS = 60_000;
export const oneLine = (err: unknown) => cleanTerminalText(err instanceof Error ? err.message : String(err), Infinity).split('\n')[0].slice(0, 200);
// While a cloud agent signs in, the office looks whether it's done this often (someone watching their terminal), else less.
export const SIGN_IN_POLL_MS = 8_000;
export const SIGN_IN_IDLE_POLL_MS = 60_000;
// What a session that lost its sign-in mid-task is told when it carries on.
export const SIGNED_IN_AGAIN = 'You were signed out in the middle of your task and are signed in again. Carry on where you left off.';

/** A cloud agent's CLI that runs in a Box and can sign in there (OpenCode can't run in one). */
export type BoxCliId = 'claude' | 'codex';

/** A cloud agent's CLI isn't signed in in their Box: their task waits for the manager to sign it in (docs/cloud.md). */
export class SignInNeeded extends Error {
  constructor(readonly cli: BoxCliId) {
    super(`${cliLabel(cli)} isn't signed in in their cloud machine.`);
  }
}

/** A cloud agent signing in: the task it holds (started once they're signed in) and the sign-in in their terminal. */
export interface SignIn {
  cli: BoxCliId;
  held: (() => void) | null;
  run: BoxSignIn | null;
  starting: boolean;
  poll: NodeJS.Timeout | null;
}

// QA's screenshots of each PR's latest round, for the app viewer's QA panel (qaShots.ts).
export const QA_SHOTS_DIR = path.join(HOME_DIR, 'qa-shots');

// Each agent's terminal (screen and scrollback) is saved too, so the office shows what they did after a restart.
const TERMINALS_DIR = path.join(HOME_DIR, 'terminals');
export const terminalFile = (agentId: string) => path.join(TERMINALS_DIR, `${agentId}.ansi`);
export const TERMINAL_SAVE_MS = 20_000;

export const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export const ICON = { pass: '✅', fail: '❌', skip: '⏭️' } as const;

export const clampMaxAgents = (n: unknown) => Math.max(1, Math.min(FLOOR_SEATS, Math.round(Number(n)) || DEFAULT_MAX_AGENTS));
