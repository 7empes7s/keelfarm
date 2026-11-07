import { existsSync } from 'node:fs';
import * as github from './github.ts';
import * as workspace from './workspace.ts';
import { startSession, type SessionCallbacks, type SessionHandle, type SessionOptions } from './agentRunner.ts';
import { detachBoxClis, hooksReady, officeProcesses, reconnectBoxClis, reconnectClis, releaseClis, startBoxSignIn, startCliSession, terminalsAvailable, type BoxSignIn, type KeptBoxCli, type ReconnectedCli } from './cliRunner.ts';
import { keeperHookUrl } from './ptyClient.ts';
import { upstashBoxes, type BoxApi } from './box.ts';
import { run } from './exec.ts';
import { localMachines, type MachineProvider } from './machines.ts';
import { detectClis } from './clis.ts';
import { readPicks } from './picks.ts';
import type { QuickPicks } from '../shared/used.ts';
import { scanTooling } from './tooling.ts';
import type { ToolInventory } from '../shared/tooling.ts';
import { checkUsage, type UsageCheck } from './usagePoll.ts';
import { readCatalog } from './modelCatalog.ts';
import { installDesk, type DepsCallbacks, type DepsOutcome } from './deps.ts';
import { previewDesks, realPreviews, type PreviewBackend } from './previewRunner.ts';
import { realOffice, type LastUpdate, type OfficeHost } from './officeUpdate.ts';
import { elevenLabs } from './elevenlabs.ts';
import { httpTransport, type NotifyTransport } from './notifier.ts';
import { telegramHttp, type TelegramApi } from './telegramBot.ts';
import type { VoiceApi } from './voice.ts';
import { openMeteo, type WeatherApi } from './weather.ts';
import type { AgentTerminal } from './terminal.ts';
import { readWorktree, type WorktreeRead } from './worktreeRead.ts';
import { checkoutFile, readRepoFile } from './repoFile.ts';
import type { OpsHistory } from './metrics.ts';
import type { CostRecord } from '../shared/costs.ts';
import type { DemoCharter } from './demoCharters.ts';
import type { ProposeDesignInput } from './designTool.ts';
import type { CareerView } from '../shared/careers.ts';
import type { CharterParts, ObjectiveLog } from '../shared/charter.ts';
import type { SurvivalSignals } from '../shared/experiments.ts';
import type { LabState } from './experiments.ts';
import type { UsageWarning } from './pacing.ts';
import { realResources, type ResourceProbe } from './health.ts';
import type { LabRunner } from './testLab.ts';
import { createLabRunner } from './testLabRunner.ts';
import { claudeProjectsDir, findTranscript } from './history.ts';
import type { HistoryEntry } from '../shared/history.ts';
import type { CliView, ModelCatalogView, GhRepoSummary, IssueInfo, NoticeView, PhoneMessage, PullInfo } from '../shared/types.ts';

/** Everything the swarm needs from the outside world. The demo backend fakes all of it. */
export interface Backend {
  demo: boolean;
  user(): Promise<string>;
  listMyRepos(owner?: string): Promise<GhRepoSummary[]>;
  repoMeta(fullName: string): Promise<github.RepoMeta>;
  listIssues(fullName: string): Promise<IssueInfo[]>;
  listPulls(fullName: string): Promise<PullInfo[]>;
  /** The logins of collaborators with write access, for trust (#185). */
  writers(fullName: string): Promise<string[]>;
  createIssue(fullName: string, title: string, body: string, labels?: string[]): Promise<number>;
  /** OPEN or CLOSED; null when there is no such issue. */
  issueState(fullName: string, number: number): Promise<'OPEN' | 'CLOSED' | null>;
  editIssue(fullName: string, number: number, edit: { body?: string; addLabels?: string[]; removeLabels?: string[] }): Promise<void>;
  /** Close an issue with a comment, as completed unless `reason` says not planned. */
  closeIssue(fullName: string, number: number, comment: string, reason?: 'completed' | 'not planned'): Promise<void>;
  mergePull(fullName: string, number: number, method: 'squash' | 'merge' | 'rebase', headSha?: string): Promise<void>;
  updateBranch(fullName: string, number: number): Promise<void>;
  /** Commits of `base` the PR's head doesn't have yet (up to date before merge, #24). */
  behindBy(fullName: string, base: string, headSha: string): Promise<number>;
  /** The floor's main checkout's latest commits and the files each changed, for its hot files (#24). */
  fileHistory(fullName: string): Promise<{ subject: string; files: string[] }[]>;
  /** The failed steps' log of a GitHub Actions run, for a checks fix. */
  failedRunLog(fullName: string, runId: string): Promise<string>;
  /** Re-run the failed jobs of these GitHub Actions runs. */
  rerunFailedJobs(fullName: string, runIds: number[]): Promise<void>;
  /** The annotations' messages on these failed checks' jobs (from their log URLs), e.g. GitHub saying why it wouldn't run them (#191). */
  checkAnnotations(fullName: string, urls: string[]): Promise<string[]>;
  closePull(fullName: string, number: number): Promise<void>;
  prForBranch(fullName: string, branch: string): Promise<{ number: number; url: string } | null>;
  prDetails(fullName: string, number: number): Promise<github.PrDetails>;
  /** The CEO's pr_diff: changed files, and the diff itself when `patch`. */
  prDiff(fullName: string, number: number, patch: boolean): Promise<github.PrDiff>;
  /** The CEO's worktree_file: a file or diff from an agent's worktree or branch (worktreeRead.ts). */
  readWorktree(r: WorktreeRead): Promise<string>;
  /** Chat file refs (repoFile.ts): the floor's main checkout has this plain file. */
  hasRepoFile(fullName: string, rel: string): boolean;
  /** A chat file ref's text on the floor's default branch; throws with what the viewer says. */
  readRepoFile(fullName: string, branch: string, rel: string): Promise<string>;
  /** createdAt: when it was filed (absent when the demo no longer knows). */
  issueDetails(fullName: string, number: number): Promise<{ title: string; body: string; createdAt?: string }>;
  commentPull(fullName: string, number: number, body: string): Promise<string>;
  /** The charter's Export (#48): docs/CHARTER.md on the office's charter branch, with a pull request; returns its URL. */
  exportCharter(fullName: string, base: string, markdown: string): Promise<string>;
  uploadEvidence(fullName: string, filePath: string, data: Buffer): Promise<string>;
  ensureClone(fullName: string): Promise<void>;
  /** Fast-forward the floor's main checkout to GitHub when that is safe; returns how it stands. */
  syncMain(fullName: string, defaultBranch: string, opts: { touch: boolean }): Promise<workspace.MainSync | null>;
  /** Point a floor at the user's own project folder (null: a clone the office manages). */
  setLocalPath(fullName: string, dir: string | null): void;
  scanProjects(root: string): Promise<workspace.LocalFolder[]>;
  inspectFolder(dir: string): Promise<workspace.LocalFolder>;
  publishFolder(dir: string, opts: { name: string; visibility: 'private' | 'public'; owner?: string; description?: string }): Promise<string>;
  createProject(root: string, name: string, opts: { visibility: 'private' | 'public'; owner?: string; description?: string }): Promise<{ fullName: string; path: string }>;
  mainDir(fullName: string): string;
  /** Agents' machines (server/machines.ts): each agent's own clone, worktree and temp folder. */
  machines: MachineProvider;
  /** A floor desk: the preview's worktrees, and agents' desks from before machines. */
  deskDir(fullName: string, agentSlug: string): string;
  /** The desk folder is there: a session started in a missing one dies at once (Windows exit 267). */
  deskExists(dir: string): boolean;
  /** `note` hears why the desk couldn't be reused in place, when it has to be rebuilt. */
  prepareDesk(fullName: string, base: workspace.DeskBase, agentSlug: string, branch: string, note?: (text: string) => void): Promise<string>;
  /** npm ci in a prepared desk unless nothing changed since the last one; never throws (see deps.ts installDesk). */
  installDeps(dir: string, cb: DepsCallbacks): Promise<DepsOutcome>;
  /** `main`: the floor's checkout as it was when the desk was let go (default: mainDir now). */
  removeDesk(fullName: string, agentSlug: string, main?: string): Promise<void>;
  /** Remove desks, stray desk folders and finished swarm/qa branches nothing in `keep` uses. */
  sweepDesks(fullName: string, keep: workspace.SweepKeep): Promise<workspace.SweepResult>;
  /** Free disk space on an idle desk (node_modules, build output); null when it doesn't exist or `stillIdle` says no. */
  trimDesk(fullName: string, agentSlug: string, stillIdle: () => boolean): Promise<workspace.DeskTrim | null>;
  /** Stop processes an agent left running (dev servers on its port, anything started in its desk). */
  releaseDesk(fullName: string, agentSlug: string, port: number): Promise<void>;
  /** The floor's preview desks (desks/preview, desks/preview-pr-N) and their size on disk, for cleanup and stats (#204). */
  previewDesks(fullName: string): Promise<{ slug: string; bytes: number }[]>;
  /** An agent session: the real CLI in the agent's terminal when opts.terminal is set, else an Agent SDK session. */
  startSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle;
  /** A finished Claude Code session's transcript (#49): its file and session id; null when there's none on disk. */
  sessionTranscript(cwd: string, sessionId: string | null, about: Pick<HistoryEntry, 'agent' | 'kind' | 'title' | 'at'>): Promise<{ file: string; sessionId: string } | null>;
  /** Terminals can run here (the native pseudo-terminal module loaded). */
  terminals: boolean;
  /** New CLIs start in the terminal keeper, which keeps them running through an office restart (#74). */
  keeping(): boolean;
  /** The office started: the CLIs its terminal keeper kept running through a restart, back in their agents' terminals. */
  reconnectClis(terminalFor: (agentId: string) => AgentTerminal | null): Promise<ReconnectedCli[]>;
  /** The office follows those CLIs' sessions again: hooks that waited for it can come in. */
  hooksReady(): void;
  /** The office is stopping: its CLIs carry on in the keeper through a restart (true), or stop with it. */
  releaseClis(restart: boolean): Promise<void>;
  /** The coding-agent CLIs installed on this machine. */
  detectClis(): Promise<CliView[]>;
  /** The chat's "/" picks: the manager's installed skills and connected apps (server/picks.ts). */
  quickPicks(): Promise<QuickPicks>;
  /** What a Claude Code session here loads (Tools & skills), read only, secrets masked; `projects`: the floors' checkouts. */
  toolInventory(projects: string[]): Promise<ToolInventory>;
  /** The coding agents' models, read from their live lists now (server/modelCatalog.ts): never throws. */
  modelCatalog(): Promise<ModelCatalogView>;
  /** Claude's subscription usage read directly, while no session reports it (#89): no model tokens, never throws. */
  usageCheck(): Promise<UsageCheck>;
  /** The default branch's commits and the issues filed since `since`: what says whether merged PRs survived (#23). */
  survivalSignals(fullName: string, since: number): Promise<SurvivalSignals>;
  /** Run a floor's app for the preview monitor (its own worktree, its own port). */
  previews: PreviewBackend;
  /** Memory, swap and load, and what agents' processes use (server/health.ts). */
  resources: ResourceProbe;
  /** The test lab's shared browser and heavy commands (#56). */
  testLab: LabRunner;
  /** The running office's own folder and its launcher, for the office's self-update. */
  office: OfficeHost;
  /** Text to speech for the manager's phone (ElevenLabs). */
  voice: VoiceApi;
  /** The real local weather for Settings → Weather (Open-Meteo, keyless; only coordinates are sent once a city is found). */
  weather: WeatherApi;
  /** Notifications to the chat apps and push services (docs/pocket.md). */
  notify: NotifyTransport;
  /** The manager's Telegram bot (docs/pocket.md): the Bot API; the demo's is a fake that logs what it would send. */
  telegram: TelegramApi;
  /** Cloud agents (docs/cloud.md): Upstash's Box API (the demo's is fake), and picking their CLIs up after a restart. */
  cloud: CloudBackend;
  /** The demo only: a made-up past week for mission control, so a fresh demo office has numbers from the start. */
  seedOps?(repos: string[], now: number): OpsHistory;
  /** The demo only: a made-up week of sessions and merges for the cost ledger (#18), when it's empty. */
  seedCosts?(repos: { id: string; fullName: string }[], agents: { id: string; name: string; role: string; repoId: string }[], now: number): CostRecord[];
  /** The demo only: made-up careers for a fresh demo office's agents (#117), so their profiles have numbers. */
  seedCareers?(agentIds: string[], now: number): Record<string, CareerView>;
  /** The demo only: an objective log over the made-up ledger (#105), so the Charter tab's numbers show from the start. */
  seedCharterLog?(charter: CharterParts, ledger: CostRecord[], now: number): ObjectiveLog;
  /** The demo only: the charter a fresh demo office gives a floor, and a CEO proposal waiting on it. */
  demoCharter?(fullName: string): DemoCharter;
  /** The demo only: an update the preflight held back (#138), so a fresh demo office's chat shows its card. */
  demoHeldUpdate?(): LastUpdate;
  /** The demo only: open PRs a CI outage holds (#191), which a fresh demo office starts with as QA-passed and parked; `stuck`: one that only needs the manager because CI is red (#209), with QA's summary. */
  demoParked?(): { fullName: string; prNumber: number; stuck?: string }[];
  /** The demo only: a design proposal (#209) a fresh demo office opens with, as propose_design's input. */
  demoDesign?(): Promise<ProposeDesignInput>;
  /** The demo only: how many agents a fresh demo office hires on floor `floor`. */
  demoTeam?(floor: number): number;
  /** The demo opens without the setup wizard or the tour (config.ts demoNoTour), for QA's and tests' browsers. */
  demoNoTour?: boolean;
  /** The demo only: an experiment with made-up results (#23), when the lab has no issues in one yet. */
  seedLab?(repos: { id: string }[], now: number): LabState;
  /** The demo only: a chat to open on, with edited messages of every kind (#125), reactions and quoted replies (#118); ids from 1 (the office renumbers them). */
  seedChat?(now: number): PhoneMessage[];
  /** The demo only: a day of notifications of every kind (#107), when the notification centre is empty. */
  seedNotices?(repos: { id: string; floor: number }[], agents: { id: string; name: string; repoId: string; role: string }[], now: number): NoticeView[];
  /** The demo only: Claude's usage warning, or its limit, on demand, as a session would report it. */
  simulateUsage?(kind: 'warning' | 'limit', now: number): UsageWarning | { limitResetsAt: number };
  /** The demo only: the office doctor's scenarios (a restart with desks gone and work finished, a stuck session). */
  demoDoctor?: DemoDoctor;
}

export interface CloudBackend {
  /** The Box API behind an Upstash Box API key. */
  boxes(key: string): BoxApi;
  /** The environment cloud credentials are read from (CUBEFARM_CLAUDE_TOKEN): the office's own, or the demo's. */
  env(): Record<string, string | undefined>;
  /** The manager's gh login token ('' when gh isn't signed in), for cloud agents' GitHub when no token is saved. */
  ghToken(): Promise<string>;
  /** Who cloud agents' commits are by: the manager's git identity, else their GitHub login. */
  gitIdentity(login: string | null): Promise<{ name: string; email: string }>;
  /** The office started: cloud agents' CLIs that kept working in their Boxes, back in their terminals. */
  reconnect(kept: KeptBoxCli[], terminalFor: (agentId: string) => AgentTerminal | null): Promise<ReconnectedCli[]>;
  /** The office is stopping: stop following cloud agents' CLIs, which carry on. */
  detach(): void;
  /** A cloud agent's CLI signing in with its own login, in their terminal (docs/cloud.md). */
  signIn(o: { api: BoxApi; boxId: string; cli: 'claude' | 'codex'; term: AgentTerminal; agentId: string }, exited: (code: number) => void): BoxSignIn;
  /** The demo only: every Box's sign-in expires, as a login Anthropic or OpenAI turned away would. */
  expireSignIns?(): void;
}

/** The real cloud: Upstash, the manager's gh and git. */
export const realCloud: CloudBackend = {
  boxes: upstashBoxes,
  env: () => process.env,
  ghToken: () => run('gh', ['auth', 'token'], { timeoutMs: 15_000 }).then((t) => t.trim()),
  gitIdentity: async (login) => {
    const get = (key: string) => run('git', ['config', '--global', key], { timeoutMs: 10_000 }).then((v) => v.trim(), () => '');
    const [name, email] = await Promise.all([get('user.name'), get('user.email')]);
    return { name: name || login || 'cubefarm', email: email || (login ? `${login}@users.noreply.github.com` : '') };
  },
  reconnect: reconnectBoxClis,
  detach: detachBoxClis,
  signIn: startBoxSignIn,
};

/** The demo's fakes for trying the office doctor (#262). */
export interface DemoDoctor {
  /** Delete a desk folder behind the office's back. */
  dropDesk(dir: string): void;
  /** Close an issue (or merge a PR) on the fake GitHub without the office hearing about it. */
  finishQuietly(fullName: string, kind: 'issue' | 'pr', n: number): void;
  /** The agent's fake session goes silent: no more output, and nudges go unanswered. False when it has none. */
  stall(agentId: string): boolean;
  /** A merged PR whose issue GitHub never closed; null when the floor has no open issue. */
  unclosedMerge(fullName: string, mergedAgoMs: number): { issue: number; pr: number } | null;
}

export const realBackend: Backend = {
  demo: false,
  resources: realResources,
  testLab: createLabRunner(),
  user: github.currentUser,
  listMyRepos: github.listMyRepos,
  repoMeta: github.repoMeta,
  listIssues: github.listIssues,
  listPulls: github.listPulls,
  writers: github.writers,
  createIssue: github.createIssue,
  exportCharter: github.exportCharter,
  issueState: github.issueState,
  editIssue: github.editIssue,
  closeIssue: github.closeIssue,
  mergePull: github.mergePull,
  updateBranch: github.updateBranch,
  behindBy: github.behindBy,
  fileHistory: (fullName) => workspace.fileHistory(fullName),
  failedRunLog: github.failedRunLog,
  rerunFailedJobs: github.rerunFailedJobs,
  checkAnnotations: github.checkAnnotations,
  closePull: github.closePull,
  prForBranch: github.prForBranch,
  prDetails: github.prDetails,
  prDiff: github.prDiff,
  readWorktree,
  hasRepoFile: (fullName, rel) => checkoutFile(workspace.mainDir(fullName), rel) !== null,
  readRepoFile: (fullName, branch, rel) => readRepoFile(workspace.mainDir(fullName), `origin/${branch}`, rel),
  issueDetails: github.issueDetails,
  commentPull: github.commentPull,
  uploadEvidence: github.uploadEvidence,
  ensureClone: workspace.ensureClone,
  syncMain: workspace.syncMain,
  setLocalPath: workspace.setLocalPath,
  scanProjects: workspace.scanProjects,
  inspectFolder: workspace.inspectFolder,
  publishFolder: workspace.publishFolder,
  createProject: workspace.createProject,
  mainDir: workspace.mainDir,
  machines: localMachines(officeProcesses),
  deskDir: workspace.deskDir,
  deskExists: (dir) => existsSync(dir),
  prepareDesk: workspace.prepareDesk,
  installDeps: (dir, cb) => installDesk(dir, cb),
  removeDesk: workspace.removeDesk,
  sweepDesks: workspace.sweepDesks,
  trimDesk: workspace.trimDesk,
  releaseDesk: (fullName, agentSlug, port) => workspace.releaseDesk(fullName, agentSlug, port, officeProcesses()),
  previewDesks,
  // A CLI started in the terminal keeper outlives an office restart (kept); a Box's is followed through its record.
  startSession: (opts, cb) => (opts.terminal ? Object.assign(startCliSession(opts, cb), { kept: !opts.box && keeperHookUrl() !== null }) : startSession(opts, cb)),
  sessionTranscript: async (cwd, sessionId) => {
    const file = sessionId ? await findTranscript(claudeProjectsDir(), cwd, sessionId) : null;
    return file && sessionId ? { file, sessionId } : null;
  },
  terminals: terminalsAvailable,
  keeping: () => keeperHookUrl() !== null,
  reconnectClis: (terminalFor) => (terminalsAvailable ? reconnectClis(terminalFor) : Promise.resolve([])),
  hooksReady,
  releaseClis,
  detectClis,
  quickPicks: () => readPicks(),
  toolInventory: (projects) => scanTooling(projects),
  modelCatalog: () => readCatalog(),
  usageCheck: () => checkUsage(),
  survivalSignals: github.survivalSignals,
  previews: realPreviews,
  office: realOffice,
  voice: elevenLabs,
  weather: openMeteo,
  notify: httpTransport,
  telegram: telegramHttp,
  cloud: realCloud,
};
