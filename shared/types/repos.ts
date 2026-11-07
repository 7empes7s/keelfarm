// Floors: their repos, issues and pull requests, previews, QA, the ticker and the ping-pong board. Imported through shared/types.ts.
import type { CharterView } from '../charter.ts';
import type { FloorPracticeView } from '../practices.ts';

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  createdAt: string;
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

/** One line on a floor's activity ticker ("Ken opened PR #212"), worked out by the server from what changed. */
export interface TickerItem {
  id: number;
  repoId: string;
  at: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

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

export interface GhRepoSummary {
  nameWithOwner: string;
  description: string;
  visibility: string;
  updatedAt: string;
}
