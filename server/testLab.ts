// The test lab (#56): one office-wide desk that runs agents' screenshots, browser checks and heavy commands for them,
// so the computer runs one shared browser and one heavy suite at a time instead of one per agent. It is a
// deterministic runner, not a model session: requests cost no tokens. Pure rules first (fair queue, command allowlist,
// where results may be written, the reports agents read), then TestLab, which the Swarm drives. The browser and the
// commands themselves are a LabRunner (server/testLabRunner.ts; the demo fakes it).
import path from 'node:path';
import type { SessionKind } from '../shared/health.ts';
import { listResults, readResult, requestKey, resultText, REUSE_MS, saveResult, type LabStored } from './testLabResults.ts';
import { laneOf, type LabGraphics, type LabJobKind, type LabJobView, type LabLane, type LabProfile, type LabResultView, type TestLabSettings, type TestLabView } from '../shared/testLab.ts';

// ---------- rules ----------

/** At most this many jobs wait in the lab, and this many per agent: a flood is refused, not queued. */
const QUEUE_MAX = 40;
const PER_AGENT_MAX = 3;
/** Recent results the lab desk shows. */
const RECENT_MAX = 12;

interface Queued {
  id: string;
  kind: LabJobKind;
  repoId: string;
  queuedAt: number;
  /** Runs with nothing else in the lab: a full-quality browser pass (#301). */
  alone?: boolean;
  /** Who asked: an agent runs one lab job at a time (#578). */
  agentId?: string;
}

/** A job waiting longer than this goes first, whatever its lane or floor (#618). */
export const LAB_AGE_MS = 5 * 60_000;

type Limits = Record<LabLane, number> & { total?: number };

/** Room in a lane beside `now` (#618): each lane up to its limit; `total` shared by both plus one slot kept for a browser job. */
function room(lane: LabLane, now: readonly Queued[], limits: Limits): boolean {
  const browser = now.filter((j) => laneOf(j.kind) === 'browser').length;
  const heavy = now.length - browser;
  if ((lane === 'browser' ? browser : heavy) >= limits[lane]) return false;
  if (limits.total === undefined) return true;
  return lane === 'heavy' ? heavy + Math.max(0, browser - 1) < limits.total : now.length < limits.total + 1;
}

/** A lane's waiting jobs in the order they start: any waiting over LAB_AGE_MS first (oldest first), then the floor with the fewest running jobs, the floor served longest ago, the oldest request. */
export function laneOrder<J extends Queued>(waiting: readonly J[], now: readonly Queued[], servedAt: ReadonlyMap<string, number>, at: number): J[] {
  const aged = (j: J) => (at - j.queuedAt > LAB_AGE_MS ? j.queuedAt : Infinity);
  const busy = (repoId: string) => now.filter((j) => j.repoId === repoId).length;
  return [...waiting].sort((a, b) => aged(a) - aged(b) || busy(a.repoId) - busy(b.repoId) || (servedAt.get(a.repoId) ?? 0) - (servedAt.get(b.repoId) ?? 0) || a.queuedAt - b.queuedAt);
}

/**
 * The jobs to start now, within the lanes' room (see `room`), each lane in `laneOrder`. Two heavy jobs of one floor
 * never run at once: they share the floor's lab checkout. A job that runs alone goes first once the lab is empty, and
 * nothing new starts while it waits for that or runs. Under the `total` cap a browser job's lane goes first (#578,
 * #618): a check waits for at most the heavy run already running, unless the oldest job waiting over LAB_AGE_MS is
 * a heavy one. An agent runs one job at a time.
 */
export function pickNext<J extends Queued>(queue: readonly J[], running: readonly J[], limits: Limits, servedAt: ReadonlyMap<string, number>, at = Date.now()): J[] {
  if (running.some((j) => j.alone)) return [];
  const solo = queue.filter((j) => j.alone).sort((a, b) => a.queuedAt - b.queuedAt)[0];
  if (solo) return running.length ? [] : [solo];
  const now = [...running];
  const served = new Map(servedAt);
  const picked: J[] = [];
  const mine = (j: J) => j.agentId !== undefined && now.some((r) => r.agentId === j.agentId);
  const firstAged = queue.filter((j) => !mine(j) && at - j.queuedAt > LAB_AGE_MS).sort((a, b) => a.queuedAt - b.queuedAt)[0];
  const lanes: LabLane[] = limits.total === undefined || (firstAged && laneOf(firstAged.kind) === 'heavy') ? ['heavy', 'browser'] : ['browser', 'heavy'];
  for (const lane of lanes) {
    for (;;) {
      if (!room(lane, now, limits)) break;
      const waiting = queue.filter((j) => laneOf(j.kind) === lane && !picked.includes(j) && !mine(j) && !(lane === 'heavy' && now.some((r) => r.kind === 'run' && r.repoId === j.repoId)));
      const next = laneOrder(waiting, now, served, at)[0];
      if (!next) break;
      picked.push(next);
      now.push(next);
      served.set(next.repoId, Number.MAX_SAFE_INTEGER / 2 + picked.length); // just served: behind every other floor
    }
  }
  return picked;
}

/** Roughly how long a job `ahead` places back in its lane waits, from how long that lane's jobs take. */
export function estimateWaitMs(ahead: number, limit: number, avgMs: number): number {
  return (Math.floor(ahead / Math.max(1, limit)) + 1) * avgMs;
}

/** A queued job's place and why it waits: the heartbeat's words (#560). */
function queueNote(x: { id: string; position: number; lane: LabLane; reason: string; waitMs: number }): string {
  return `Lab job ${x.id} queued: position ${x.position} in the lab's ${x.lane} queue (${x.reason}), about ${Math.max(1, Math.ceil(x.waitMs / 60_000))} min. Keep waiting: it starts by itself.`;
}

/** A running job's heartbeat (#578): the call keeps hearing from the lab until its result comes back. */
function runningNote(x: { id: string; title: string; ms: number }): string {
  return `Lab job ${x.id} running: ${x.title}, ${Math.round(x.ms / 1000)} s so far. Keep waiting: the result comes back here, and stays in .lab/${x.id}/ for lab_result.`;
}

/** The answer to a caller that can't take progress notifications while its job would wait (#560): nothing queued. */
function queuedRefusal(x: { position: number; lane: LabLane; reason: string; waitMs: number }): string {
  return `Queued, position ${x.position} in the lab's ${x.lane} queue (${x.reason}): nothing ran. Retry in ${Math.max(10, Math.round(x.waitMs / 1000))} s.`;
}

/** Commands every floor may run in the lab. `<args>` stands for any further plain arguments. */
const DEFAULT_LAB_COMMANDS = ['npm test <args>', 'npm run test <args>', 'npm run typecheck', 'npm run lint', 'npm run build', 'npm run test:e2e <args>', 'npx playwright test <args>', 'npx vitest run <args>'];

const SHELL = /[;&|`$<>(){}[\]*?!~'"\\\r\n]/;
const PLAIN = /^[\w@%+=:,./-]+$/;

/** One argument the lab passes on: plain characters, a relative path that stays in the checkout. */
function plainArg(t: string): boolean {
  return PLAIN.test(t) && !t.startsWith('/') && !/^[a-z]:/i.test(t) && !t.split(/[/=]/).includes('..');
}

/**
 * A lab_run command as the argument list to run, when the floor's allowlist (`DEFAULT_LAB_COMMANDS` plus the floor's
 * own) has it; throws why not. No shell: no operators, quotes, variables, absolute paths or `..`.
 */
export function labCommand(command: string, extra: readonly string[] = []): string[] {
  const text = command.trim().replace(/\s+/g, ' ');
  if (!text) throw new Error('Give a command, e.g. "npm test".');
  if (SHELL.test(text)) throw new Error('No shell syntax in a lab command (operators, quotes, variables, globs): give one plain command.');
  const argv = text.split(' ');
  const bad = argv.find((t) => !plainArg(t));
  if (bad) throw new Error(`"${bad}" isn't allowed: arguments are plain names and relative paths inside the checkout.`);
  const allow = [...DEFAULT_LAB_COMMANDS, ...extra];
  const ok = allow.some((p) => {
    const want = p.trim().split(/\s+/);
    const rest = want.at(-1) === '<args>';
    const fixed = rest ? want.slice(0, -1) : want;
    return (rest ? argv.length >= fixed.length : argv.length === fixed.length) && fixed.every((w, i) => w === argv[i]);
  });
  if (!ok) throw new Error(`"${text}" isn't on this floor's lab allowlist: ${allow.join(', ')}.`);
  return argv;
}

/** A Playwright suite: `npx playwright test …` or a package script named like e2e. */
function isE2e(argv: readonly string[]): boolean {
  return (argv[0] === 'npx' && argv[1] === 'playwright') || (argv[0] === 'npm' && argv[1] === 'run' && /e2e/i.test(argv[2] ?? ''));
}

/**
 * What the lab actually runs: a Playwright suite gets `--reporter=line` (unless it names its own reporter), so it prints
 * each test as it goes rather than only at the end (CI=1 picks quiet reporters in many configs).
 */
export function labArgv(argv: readonly string[]): string[] {
  if (!isE2e(argv) || argv.some((a) => a.startsWith('--reporter'))) return [...argv];
  return argv[0] === 'npm' && !argv.includes('--') ? [...argv, '--', '--reporter=line'] : [...argv, '--reporter=line'];
}

/**
 * How long a Playwright suite may print nothing before the lab stops it as hung (with the line reporter it prints every
 * test). null: other commands only have their timeout, since a typecheck or build can be quiet for minutes.
 */
export function silenceMs(argv: readonly string[]): number | null {
  return isE2e(argv) ? 600_000 : null;
}

export type LabProblem = 'silent' | 'browser' | 'oom' | 'port';

const PROBLEMS: [LabProblem, RegExp][] = [
  ['browser', /Executable doesn't exist|npx playwright install|no Playwright browser|browserType\.launch: .*(not found|missing)/i],
  ['oom', /heap out of memory|ENOMEM|Cannot allocate memory|out of memory/i],
  ['port', /EADDRINUSE|address already in use|port \d+ is (already )?in use/i],
];

/** Words that mark a lab problem in a report: what runReport writes, and the usual causes' own messages. */
export const LAB_PROBLEM_TEXT = new RegExp(`LAB ERROR|went silent for \\d+ ?s|${PROBLEMS.map(([, re]) => re.source).join('|')}`, 'i');

/** A failed run whose cause is the lab, not the code under test: the silence watchdog, a missing browser, OOM, a busy port. */
export function labProblem(r: Pick<RunResult, 'code' | 'silent' | 'tail' | 'oomMb'>): LabProblem | null {
  if (r.silent) return 'silent';
  if (r.oomMb) return 'oom';
  if (r.code === 0) return null;
  if (r.code === 137) return 'oom'; // SIGKILL: the kernel's OOM killer, as a shell reports it
  const text = r.tail.slice(-60).join('\n');
  return PROBLEMS.find(([, re]) => re.test(text))?.[0] ?? null;
}

const PROBLEM_TEXT: Record<LabProblem, string> = {
  silent: 'it printed nothing for too long and the lab stopped it',
  browser: 'the lab has no Playwright browser for it',
  oom: 'it ran out of memory',
  port: 'a port it needs is already in use',
};

// ---------- the browser's memory (#301) ----------

/** The shared browser restarts between jobs once its processes use this much: a software-rendered 3D page grows it. */
export const LAB_BROWSER_MAX_MB = 1200;
/** A browser job is stopped when the shared browser grows past this while it runs (#578: one grew to 3.9 GB and the kernel killed). */
export const LAB_BROWSER_KILL_MB = 2500;
/** A lab run is stopped when its processes (an e2e suite's browser included) use more than this together (#578). */
const LAB_RUN_MAX_MB = 4096;
/** How often a running job's memory is measured against those limits. */
export const LAB_MEMORY_CHECK_MS = 5_000;

/**
 * The shared browser's command-line flags, each measured on a 3D demo office and kept only where it lowered the peak
 * (PR #301's table): /dev/shm can be tiny in containers; at most two renderers; the GPU and network services inside the
 * browser process and no zygotes (Linux), fewer processes each with its own copy of Chrome's memory. Playwright passes
 * its own --enable-features, and only the last one counts, so its feature is repeated here.
 */
export function labLaunchArgs(): string[] {
  return ['--disable-dev-shm-usage', '--renderer-process-limit=2', '--in-process-gpu', '--no-zygote', '--enable-features=CDPScreenshotNewSurface,NetworkServiceInProcess2'];
}

/**
 * What runs in every page before its own scripts: the lab profile's flag the office's 3D client reads
 * (client/src/world/gfx/device.ts); for a full-quality pass on a desktop, the High preset unless one was picked, since
 * Auto would step down on the lab's software rendering. Other apps never read either.
 */
export function labInitScript(graphics: LabGraphics, profile: LabProfile): string {
  if (graphics === 'lab') return 'window.__swarmLabGfx = true;';
  return profile === 'desktop' ? "try { if (!localStorage.getItem('cubefarm:graphics')) localStorage.setItem('cubefarm:graphics', 'high'); } catch {}" : '';
}

/**
 * Restart the shared browser now that a job ended? Always after a full-quality pass, and when its processes have grown
 * past the limit; never while another browser job still uses it (the next job to end decides again).
 */
export function restartBrowser(x: { full: boolean; rssMb: number | null; busy: boolean; limitMb?: number }): boolean {
  if (x.busy) return false;
  return x.full || (x.rssMb !== null && x.rssMb >= (x.limitMb ?? LAB_BROWSER_MAX_MB));
}

/** Installing a browser needs this much free memory: it unpacks a few hundred MB next to running agents. */
export const BROWSER_INSTALL_MIN_MB = 2048;

/**
 * The one Playwright browser cache every lab run (and the office's start-up install) shares: PLAYWRIGHT_BROWSERS_PATH
 * when set, else Playwright's own default for the platform.
 */
export function browsersPath(env: Readonly<Record<string, string | undefined>>, home: string, platform: string): string {
  if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0') return env.PLAYWRIGHT_BROWSERS_PATH;
  if (platform === 'win32') return path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'ms-playwright');
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright');
  return path.join(env.XDG_CACHE_HOME ?? path.join(home, '.cache'), 'ms-playwright');
}

/** A floor's own allowlist entry (set_floor_profile lab_commands), normalised; throws when it isn't plain words. */
export function labPattern(entry: string): string {
  const words = entry.trim().split(/\s+/);
  const bad = words.find((w, i) => !(plainArg(w) || (w === '<args>' && i === words.length - 1 && i > 0)));
  if (bad !== undefined || !words[0]) throw new Error(`Lab command "${entry}" isn't plain words: no shell syntax, absolute paths or "..", and <args> only at the end.`);
  return words.join(' ');
}

/** Is `p` the folder `root` or inside it? */
function inside(root: string, p: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(p));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Where a job's files go: `.lab/<job>` in the requester's own worktree (the office resolves it from the session, never
 * from the request). Refused when that worktree is, holds or sits in a forbidden folder: the office's own folder or a
 * floor's checkout.
 */
export function labOutDir(worktree: string, jobId: string, forbidden: readonly string[]): string {
  if (!path.isAbsolute(worktree)) throw new Error('The lab needs your worktree, and this session has none.');
  if (!/^[\w-]+$/.test(jobId)) throw new Error(`Bad job id ${jobId}`);
  const no = forbidden.find((f) => inside(f, worktree) || inside(worktree, f));
  if (no) throw new Error(`The lab never writes to ${no}: run this from your own worktree.`);
  return path.join(worktree, '.lab', jobId);
}

/** A file in a job's folder; throws when the name would leave it. */
export function labFile(outDir: string, name: string): string {
  const file = path.join(outDir, name.replace(/[^\w.-]/g, '_'));
  if (!inside(outDir, file) || file === outDir) throw new Error(`Bad file name ${name}`);
  return file;
}

/** http(s) only: the lab's browser opens pages, not files. */
export function labUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`"${raw}" isn't a URL: give one like http://localhost:5678/, or preview: true for your floor's app.`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('The lab opens http and https pages only.');
  return u.toString();
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** At most `n` lines of a list in a report, with a count of the rest. */
const few = (label: string, xs: readonly string[], n = 5) => (xs.length ? [`${label} (${xs.length}):`, ...xs.slice(0, n).map((x) => `  ${clip(x, 200)}`), ...(xs.length > n ? [`  … ${xs.length - n} more`] : [])] : []);

export interface PageIssues {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

interface ShotResult extends PageIssues {
  shots: { label: string; file: string }[];
}

export interface CheckResult extends PageIssues {
  steps: { step: string; ok: boolean; detail?: string; shot?: string }[];
}

export interface RunResult {
  code: number | null;
  ms: number;
  tail: string[]; // the last lines of output
  timedOut: boolean;
  silent?: boolean; // stopped by the silence watchdog (silenceMs)
  oomMb?: number; // stopped by the memory limit (maxMb): what its processes used then
  artifacts: string[]; // files the run left in its report folders, relative to the checkout
}

/** lab_screenshot's answer: the files, and what went wrong on the page. Small: agents pay for every line. */
function shotReport(r: ShotResult, graphics: LabGraphics): string {
  const issues = r.consoleErrors.length + r.pageErrors.length + r.failedRequests.length;
  return [
    `${r.shots.length} screenshot${r.shots.length === 1 ? '' : 's'} (in your worktree, not committed; Read a file to see it):`,
    ...r.shots.map((s) => `  ${s.label}: ${s.file}`),
    graphics === 'full' ? 'Full-quality pass: real graphics settings, shadows and lighting included; ran alone, browser restarted after.' : 'Lab graphics profile (light 3D, same UI and layout).',
    ...(issues ? [...few('Console errors', r.consoleErrors), ...few('Page errors', r.pageErrors), ...few('Failed requests', r.failedRequests)] : ['No console errors, page errors or failed requests.']),
  ].join('\n');
}

/** lab_browser_check's answer: pass/fail per step, with a screenshot of each failure. */
function checkReport(r: CheckResult, graphics: LabGraphics): string {
  const failed = r.steps.filter((s) => !s.ok).length;
  return [
    `${failed ? `FAIL: ${failed} of ${r.steps.length} steps failed.` : `PASS: all ${r.steps.length} steps.`}${graphics === 'full' ? ' Full-quality graphics.' : ''}`,
    ...r.steps.map((s, i) => `${i + 1}. ${s.ok ? 'ok' : 'FAIL'} ${clip(s.step, 120)}${s.detail ? `: ${clip(s.detail, 240)}` : ''}${s.shot ? ` (screenshot ${s.shot})` : ''}`),
    ...few('Console errors', r.consoleErrors),
    ...few('Page errors', r.pageErrors),
  ].join('\n');
}

/** lab_run's answer: exit code, duration, the output's last lines (at most 200) and the artifacts. */
function runReport(command: string, r: RunResult): string {
  const problem = labProblem(r);
  return [
    `${command}: ${r.silent ? `went silent for ${Math.round((silenceMs(command.split(' ')) ?? 0) / 1000)} s and was stopped` : r.oomMb ? `used ${r.oomMb} MB, over the lab's ${LAB_RUN_MAX_MB} MB limit, and was stopped` : r.timedOut ? 'timed out' : `exit code ${r.code}`} after ${Math.round(r.ms / 1000)} s.`,
    ...(problem ? [`LAB ERROR (${problem}): ${PROBLEM_TEXT[problem]}. This is the lab, not the code: QA reports verdict "lab-error" if it can't judge the PR without this run.`] : []),
    ...few('Artifacts', r.artifacts, 20),
    `Last ${Math.min(200, r.tail.length)} lines of output:`,
    ...r.tail.slice(-200),
  ].join('\n');
}

// ---------- requests ----------

export interface LabAction {
  do: 'click' | 'type' | 'press' | 'scroll' | 'wait';
  selector?: string;
  text?: string; // type: the text; press: the key
  y?: number; // scroll: pixels down
  ms?: number; // wait
}

export interface LabStep {
  do: LabAction['do'] | 'goto' | 'expect_visible' | 'expect_text' | 'no_horizontal_scroll' | 'no_console_errors' | 'viewport_scale' | 'axe';
  selector?: string;
  text?: string;
  url?: string; // goto
  value?: number; // viewport_scale: the expected visualViewport.scale; scroll: pixels; wait: ms
  y?: number;
  ms?: number;
}

/** The page a browser job opens: a URL, or the requester's floor's app (their PR's preview, else the floor's). */
interface LabTarget {
  url?: string;
  preview?: boolean;
}

export interface BrowserOpts {
  url: string;
  profile: LabProfile;
  theme: 'light' | 'dark';
  graphics: LabGraphics;
  outDir: string;
}

export interface LabRunner {
  /** The shared browser is running. */
  browserUp(): boolean;
  screenshot(o: BrowserOpts & { viewports: number[]; waitFor?: string; actions: LabAction[]; fullPage: boolean }): Promise<ShotResult>;
  check(o: BrowserOpts & { viewport: number; steps: LabStep[] }): Promise<CheckResult>;
  /** The floor's lab checkout at the requester's committed HEAD (`worktree`) or a branch on origin, dependencies installed. */
  checkout(o: { fullName: string; defaultBranch: string; worktree: string; branch?: string }): Promise<string>;
  /** silenceMs: stop it when it prints nothing for this long (RunResult.silent); null: never. maxMb: stop it when its processes use more (RunResult.oomMb). */
  run(o: { dir: string; argv: string[]; timeoutMs: number; silenceMs: number | null; maxMb: number }): Promise<RunResult>;
  /** Install Playwright's Chromium for the checkout's own Playwright, into the shared cache; false when it couldn't. */
  installBrowser(dir: string): Promise<boolean>;
  /** At office start: install that browser with the office's own Playwright, so no session has to. */
  warm(): Promise<boolean>;
  /** What the shared browser's processes use now, MB; null when it isn't running or can't be measured. */
  browserMb(): Promise<number | null>;
  /** Close the browser (idle, restarting it between jobs, or the office stops). */
  close(): Promise<void>;
}

/** Who asks: resolved by the office from the session, never from the request. */
export interface Requester {
  agentId: string;
  agent: string;
  repoId: string;
  floor: number;
  fullName: string;
  defaultBranch: string;
  worktree: string;
  pr: number | null;
  labCommands: string[];
}

type JobInput =
  | ({ kind: 'screenshot'; viewports: number[]; profile: LabProfile; theme: 'light' | 'dark'; graphics?: LabGraphics; waitFor?: string; actions: LabAction[]; fullPage: boolean } & LabTarget)
  | ({ kind: 'check'; viewport: number; profile: LabProfile; theme: 'light' | 'dark'; graphics?: LabGraphics; steps: LabStep[] } & LabTarget)
  | { kind: 'run'; command: string; branch?: string; timeoutMin?: number };

interface Job extends Queued {
  input: JobInput;
  key: string; // requestKey(input): a retry of the same request (#562)
  who: Requester;
  title: string;
  startedAt: number | null;
  done: (text: string) => void;
  answer: Promise<string>;
  /** The call that asked was aborted (MCP client gave up): the result waits on disk for lab_result (#562). */
  gone: () => boolean;
  beat?: ReturnType<typeof setInterval>; // the heartbeat while it waits (#560) and runs (#578)
}

/** A heartbeat while a job waits (#560) or runs (#578): its place in its lane's queue (0: running) and the words to show. */
export type LabProgress = (beat: { position: number; message: string }) => void;

// ---------- the lab ----------

export interface TestLabHost {
  runner(): LabRunner;
  settings(): TestLabSettings;
  /** Why a job of this kind can't start for memory now (#560's labAdmission), or null. */
  refusal(kind: 'labBrowser' | 'labRun'): string | null;
  /** Folders the lab never writes to: the office's own and every floor's checkout. */
  forbidden(): string[];
  /** The address of the requester's floor's app: their PR's preview (started on demand), else the floor's; held for agentId while they work. */
  previewUrl(repoId: string, pr: number | null, agentId: string): Promise<string>;
  /** A screenshot the lab took for an agent: their screen in the office shows it, and QA's evidence keeps it. */
  /** page: the address the browser was sent to. */
  shot(agentId: string, file: string, page: string): void;
  emit(view: TestLabView): void;
  /** While the office updates itself (#333): the agents whose queued jobs may still start (labGate); null: anyone's. */
  updateGate?(): readonly string[] | null;
  /** A run failed for the lab's own reason (labProblem), for IT's tickets (#542). */
  trouble?(t: { agent: string; job: string; problem: LabProblem; detail: string }): void;
}

const BROWSER_IDLE_MS = 5 * 60_000;
/** A waiting or running job's heartbeat: well inside the 300 s of silence after which an MCP client gives up on the call. */
const BEAT_MS = 20_000;
const RETRY_MS = 5_000;
const DEFAULT_RUN_MIN = 15;
const UPDATE_WAIT = 'Waiting for the office update: queued jobs start once the office has restarted.';

let seq = 0;

export class TestLab {
  private queue: Job[] = [];
  private running: Job[] = [];
  private recent: (LabResultView & { file?: string })[] = [];
  private served = new Map<string, number>(); // repo id → when one of its jobs last started
  private usage = new Map<string, { floor: number; jobs: number; ms: number }>();
  private took: Record<LabLane, number[]> = { browser: [], heavy: [] }; // recent durations, for the wait estimate
  private held: string | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private lastLab = new Map<string, number>(); // agent → when their last job ended (#333)
  private unread = new Map<string, LabStored[]>(); // agent → results whose caller was gone, for a retry (#562)

  constructor(private host: TestLabHost) {}

  /**
   * Queue a request; resolves with the report the agent reads (refusals included: they're tool errors upstream).
   * `progress`: called every BEAT_MS while the job waits and runs; null: the caller can't take progress (an MCP call without a
   * progressToken), so a job that can't start at once is refused with its place instead of waiting in silence.
   * `signal`: the call's; aborted when the caller is gone. A retry of the same request after that gets the job's result
   * (still running: its answer; ended within REUSE_MS: the kept one) instead of a second run (#562). A job still
   * queued when its caller is gone is dropped (#578): nobody would read it, and it holds others' places.
   */
  submit(who: Requester, input: JobInput, now = Date.now(), progress?: LabProgress | null, signal?: AbortSignal): Promise<string> {
    const key = requestKey(input);
    const gone = () => !!signal?.aborted;
    const same = [...this.running, ...this.queue].find((j) => j.who.agentId === who.agentId && j.key === key && j.gone());
    if (same) {
      same.gone = gone;
      if (progress) this.heartbeat(same, progress);
      signal?.addEventListener('abort', () => this.leave(same), { once: true });
      return same.answer;
    }
    const kept = this.unread.get(who.agentId)?.find((r) => r.key === key && now - r.endedAt <= REUSE_MS);
    if (kept) {
      this.unread.set(who.agentId, this.unread.get(who.agentId)!.filter((r) => r !== kept));
      return Promise.resolve(`Your earlier call was cut off; this is its job's result, not run again (call again to run it afresh).\n${resultText(kept, now)}`);
    }
    if (this.queue.length >= QUEUE_MAX) throw new Error(`The lab's queue is full (${QUEUE_MAX} jobs): try again in a few minutes.`);
    if ([...this.queue, ...this.running].filter((j) => j.who.agentId === who.agentId).length >= PER_AGENT_MAX) throw new Error(`You already have ${PER_AGENT_MAX} lab jobs waiting or running: wait for them first.`);
    if (input.kind === 'run') labCommand(input.command, who.labCommands); // refused before it queues
    if (input.kind !== 'run' && !input.url && !input.preview) throw new Error('Give a url, or preview: true for your floor\'s app.');
    if (input.kind !== 'run' && input.url) labUrl(input.url);
    labOutDir(who.worktree, 'x', this.host.forbidden());
    let done!: (text: string) => void;
    const answer = new Promise<string>((r) => (done = r));
    const id = `${now.toString(36)}${(++seq).toString(36)}`;
    const job: Job = { id, kind: input.kind, repoId: who.repoId, agentId: who.agentId, queuedAt: now, alone: input.kind !== 'run' && input.graphics === 'full', input, key, who, title: titleOf(input), startedAt: null, done, answer, gone };
    this.queue.push(job);
    this.pump();
    if (!this.queue.includes(job)) return answer;
    if (progress === null) {
      const place = this.place(job);
      this.queue = this.queue.filter((q) => q !== job);
      this.emit();
      throw new Error(queuedRefusal(place));
    }
    if (progress) this.heartbeat(job, progress);
    signal?.addEventListener('abort', () => this.leave(job), { once: true });
    if (signal?.aborted) this.leave(job);
    return answer;
  }

  private heartbeat(job: Job, progress: LabProgress) {
    clearInterval(job.beat);
    job.beat = setInterval(() => {
      if (job.startedAt) return progress({ position: 0, message: runningNote({ id: job.id, title: job.title, ms: Date.now() - job.startedAt }) });
      const place = this.place(job);
      progress({ position: place.position, message: queueNote(place) });
    }, BEAT_MS);
  }

  /** The call that asked is gone (#578): stop its heartbeat, and drop the job if it hasn't started (a running one still keeps its result). */
  private leave(job: Job) {
    if (!job.gone()) return; // a retry took the job over
    clearInterval(job.beat);
    if (!this.queue.includes(job)) return;
    this.queue = this.queue.filter((q) => q !== job);
    job.done('Not run: the call was cut off before the job started.');
    this.pump();
  }

  /** A waiting job's real place in its lane (the order it starts in, #618), why it waits and roughly how long. */
  private place(j: Job): { id: string; position: number; lane: LabLane; reason: string; waitMs: number } {
    const lane = laneOf(j.kind);
    const s = this.host.settings();
    const order = laneOrder(this.queue.filter((q) => laneOf(q.kind) === lane), this.running, this.served, Date.now());
    const ahead = Math.max(0, order.indexOf(j));
    return { id: j.id, position: ahead + 1, lane, reason: this.waitReason(j, lane, ahead), waitMs: estimateWaitMs(ahead, lane === 'browser' ? s.browserJobs : Math.min(s.heavyJobs, s.totalJobs), this.avg(lane)) };
  }

  /** Why a queued job hasn't started (#618): the first rule that holds it. */
  private waitReason(j: Job, lane: LabLane, ahead: number): string {
    const s = this.host.settings();
    const solo = this.running.find((r) => r.alone);
    const own = this.running.find((r) => r.who.agentId === j.who.agentId);
    const checkout = lane === 'heavy' ? this.running.find((r) => r.kind === 'run' && r.repoId === j.repoId) : undefined;
    if (this.held || solo || own || checkout) return this.held ?? (solo ? `a full-quality pass runs alone: ${solo.title}` : own ? `your other lab job runs first: ${own.title}` : `your floor's lab checkout is busy with ${checkout?.title}`);
    if (!room(lane, this.running, { browser: s.browserJobs, heavy: s.heavyJobs, total: s.totalJobs })) return `the ${lane} slots are full: ${this.running.map((r) => r.title).join(', ')} running`;
    return j.alone ? 'a full-quality pass waits for the lab to empty' : ahead ? `${ahead} job${ahead === 1 ? '' : 's'} ahead of it` : 'starting next';
  }

  /** lab_status: where the requester's jobs stand, what runs, the wait, and their finished jobs kept in `worktree` (#562). */
  status(agentId: string | null, worktree?: string): string {
    const s = this.host.settings();
    const lines = [`Lab: ${this.running.length} running, ${this.queue.length} waiting (at most ${s.browserJobs} browser job${s.browserJobs === 1 ? '' : 's'} and ${s.heavyJobs} heavy command${s.heavyJobs === 1 ? '' : 's'} at a time, ${s.totalJobs} in all plus one kept for a browser job).`];
    for (const j of this.running) lines.push(`Running: ${j.title} for ${j.who.agent} (floor ${j.who.floor}), ${Math.round((Date.now() - (j.startedAt ?? Date.now())) / 1000)} s so far.`);
    for (const j of this.queue.filter((q) => q.who.agentId === agentId)) {
      const p = this.place(j);
      lines.push(`Yours: ${j.title}, position ${p.position} in the ${p.lane} queue, waiting because ${p.reason}, about ${Math.max(1, Math.ceil(p.waitMs / 60_000))} min.`);
    }
    if (this.held) lines.push(this.held);
    const done = worktree ? listResults(worktree, this.host.forbidden()).slice(0, 8) : [];
    if (done.length) lines.push('Your finished jobs (lab_result with the id reads one):', ...done.map((r) => `  ${r.id}: ${r.title}, ${r.ok ? 'passed' : 'failed'} (${clip(r.summary, 80)}), ${Math.round((Date.now() - r.endedAt) / 60_000)} min ago`));
    return lines.join('\n');
  }

  /** lab_result: a job's kept report from the requester's worktree, or where it stands when it hasn't ended (#562). */
  result(who: Requester, id: string, now = Date.now()): string {
    const r = readResult(who.worktree, id, this.host.forbidden());
    if (r) {
      this.unread.set(who.agentId, (this.unread.get(who.agentId) ?? []).filter((u) => u.id !== id));
      return resultText(r, now);
    }
    const live = [...this.running, ...this.queue].find((j) => j.id === id && j.who.agentId === who.agentId);
    if (live) return `Lab job ${id} (${live.title}) ${live.startedAt ? `is running, ${Math.round((now - live.startedAt) / 1000)} s so far` : 'is still queued'}: call lab_result again in a minute.`;
    throw new Error(`No result for lab job ${id} in your .lab/ folder: it isn't yours, or ended over a day ago. lab_status lists your finished jobs.`);
  }

  view(): TestLabView {
    const job = (j: Job): LabJobView => ({ id: j.id, kind: j.kind, repoId: j.repoId, floor: j.who.floor, agentId: j.who.agentId, agent: j.who.agent, pr: j.who.pr, title: j.title, queuedAt: j.queuedAt, startedAt: j.startedAt });
    return {
      enabled: this.host.settings().enabled,
      browser: this.host.runner().browserUp() ? 'up' : 'off',
      running: this.running.map(job),
      queue: this.queue.map(job),
      recent: this.recent.map(({ file: _file, ...r }) => r),
      usage: [...this.usage].map(([repoId, u]) => ({ repoId, ...u })),
      held: this.held,
    };
  }

  /** A recent result's thumbnail file (GET /api/testlab/shot/:id). */
  shotFile(id: string): string | null {
    return this.recent.find((r) => r.id === id)?.file ?? null;
  }

  /** What the office's update waits for (#333, labHold): whose jobs run and wait, and when each agent's last one ended. */
  activity(): { running: string[]; waiting: string[]; lastLab: ReadonlyMap<string, number> } {
    return { running: this.running.map((j) => j.who.agentId), waiting: this.queue.map((j) => j.who.agentId), lastLab: this.lastLab };
  }

  /** The office's update gate changed: start what it now lets start. */
  reopen() {
    this.pump();
  }

  /** Running lab jobs, for #55's admission: what they still reserve. */
  sessions(): { id: string; kind: SessionKind; dir: null; startedAt: number }[] {
    return this.running.map((j) => ({ id: `lab:${j.id}`, kind: laneOf(j.kind) === 'browser' ? 'labBrowser' : 'labRun', dir: null, startedAt: j.startedAt ?? Date.now() }));
  }

  /** restart: the office comes back at once (an update), and its sessions in the terminal keeper ask again (#333). */
  async close(restart = false) {
    if (this.retry) clearTimeout(this.retry);
    if (this.idle) clearTimeout(this.idle);
    const again = restart ? 'the office is restarting. Make the same lab call again in a minute, once it is back: that is not a finding.' : 'the office is stopping; ask the lab again once it is back.';
    for (const j of this.queue) {
      clearInterval(j.beat);
      j.done(`Not run: ${again}`);
    }
    for (const j of this.running) {
      clearInterval(j.beat);
      j.done(`Cut off: ${again}`);
    }
    this.queue = [];
    this.running = [];
    await this.host.runner().close().catch(() => undefined);
  }

  private avg(lane: LabLane): number {
    const xs = this.took[lane];
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : lane === 'browser' ? 20_000 : 180_000;
  }

  /** Start what may start: fair across floors, within the lanes' limits, when memory allows (#55). */
  private pump() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const s = this.host.settings();
    const gate = this.host.updateGate?.() ?? null;
    const open = gate ? this.queue.filter((j) => gate.includes(j.who.agentId)) : this.queue;
    const gated = this.queue.length > open.length;
    const next = pickNext(open, this.running, { browser: s.browserJobs, heavy: s.heavyJobs, total: s.totalJobs }, this.served);
    let held: string | null = null;
    for (const j of next) {
      const why = this.host.refusal(laneOf(j.kind) === 'browser' ? 'labBrowser' : 'labRun');
      if (why) {
        held = why; // already reads "Waiting for memory: …" (#313)
        continue;
      }
      this.queue = this.queue.filter((q) => q !== j);
      this.running.push(j);
      j.startedAt = Date.now();
      this.served.set(j.repoId, j.startedAt);
      void this.execute(j);
    }
    this.held = held ?? (gated ? UPDATE_WAIT : null); // the update reopens the gate itself
    if (held) this.retry = setTimeout(() => this.pump(), RETRY_MS);
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    if (!this.running.some((j) => laneOf(j.kind) === 'browser') && !this.queue.length) this.idle = setTimeout(() => void this.host.runner().close().then(() => this.emit()), BROWSER_IDLE_MS);
    this.emit();
  }

  private async execute(j: Job) {
    const runner = this.host.runner();
    let text: string;
    let ok = false;
    let summary: string;
    let file: string | undefined;
    let artifacts: string[] = [];
    let browserOomMb: number | null = null;
    try {
      const outDir = labOutDir(j.who.worktree, j.id, this.host.forbidden());
      const input = j.input;
      if (input.kind === 'run') {
        const argv = labArgv(labCommand(input.command, j.who.labCommands));
        const dir = await runner.checkout({ fullName: j.who.fullName, defaultBranch: j.who.defaultBranch, worktree: j.who.worktree, branch: input.branch });
        const go = () => runner.run({ dir, argv, timeoutMs: Math.max(1, Math.min(30, input.timeoutMin ?? DEFAULT_RUN_MIN)) * 60_000, silenceMs: silenceMs(argv), maxMb: LAB_RUN_MAX_MB });
        let r = await go();
        // The checkout's Playwright wants a browser build the shared cache lacks: install it once and run again.
        if (labProblem(r) === 'browser' && (await runner.installBrowser(dir))) r = await go();
        ok = r.code === 0 && !r.timedOut && !r.silent;
        const problem = labProblem(r);
        summary = problem ? `lab error: ${problem}` : r.timedOut ? 'timed out' : `exit ${r.code}`;
        if (problem) this.host.trouble?.({ agent: j.who.agent, job: j.id, problem, detail: `${argv.join(' ')}: ${r.silent ? 'went silent' : r.oomMb ? `used ${r.oomMb} MB` : r.timedOut ? 'timed out' : `exit code ${r.code}`}` });
        artifacts = r.artifacts;
        text = runReport(argv.join(' '), r);
      } else {
        const url = input.url ? labUrl(input.url) : await this.host.previewUrl(j.repoId, j.who.pr, j.who.agentId);
        const graphics = input.graphics ?? 'lab';
        const base = { url, profile: input.profile, theme: input.theme, graphics, outDir };
        // The shared browser never grows into an OOM kill (#578): past LAB_BROWSER_KILL_MB it closes, and the job fails as the lab's.
        const guard = setInterval(() => {
          void runner.browserMb().then((mb) => {
            if (mb === null || mb < LAB_BROWSER_KILL_MB || browserOomMb) return;
            browserOomMb = mb;
            return runner.close();
          }).catch(() => undefined);
        }, LAB_MEMORY_CHECK_MS);
        // Whatever happens on the page, the browser restarts after a full pass (and between jobs once it has grown).
        const recycled = async <T>(p: Promise<T>): Promise<T> => {
          try {
            return await p;
          } finally {
            clearInterval(guard);
            await this.recycleBrowser(j, graphics === 'full');
          }
        };
        if (input.kind === 'screenshot') {
          const r = await recycled(runner.screenshot({ ...base, viewports: input.viewports, waitFor: input.waitFor, actions: input.actions, fullPage: input.fullPage }));
          ok = !r.pageErrors.length && !r.consoleErrors.length;
          summary = `${r.shots.length} shots${graphics === 'full' ? ' (full quality)' : ''}, ${r.consoleErrors.length + r.pageErrors.length} errors`;
          file = r.shots[0]?.file;
          artifacts = r.shots.map((s) => s.file);
          for (const s of r.shots) this.host.shot(j.who.agentId, s.file, url);
          text = shotReport(r, graphics);
        } else {
          const r = await recycled(runner.check({ ...base, viewport: input.viewport, steps: input.steps }));
          const failed = r.steps.filter((s) => !s.ok);
          ok = !failed.length;
          summary = ok ? `pass, ${r.steps.length} steps` : `${failed.length} of ${r.steps.length} steps failed`;
          file = failed.find((s) => s.shot)?.shot;
          artifacts = r.steps.flatMap((s) => s.shot ?? []);
          if (file) this.host.shot(j.who.agentId, file, url);
          text = checkReport(r, graphics);
        }
      }
    } catch (err) {
      summary = clip((err as Error).message, 160);
      text = `Refused: ${(err as Error).message}`;
    }
    if (browserOomMb) {
      ok = false;
      summary = 'lab error: oom';
      text = `LAB ERROR (oom): the lab's browser used ${browserOomMb} MB, over its ${LAB_BROWSER_KILL_MB} MB limit, and was stopped. This is the lab, not the code: ask again once; QA reports verdict "lab-error" if it keeps happening.\n${text}`;
      this.host.trouble?.({ agent: j.who.agent, job: j.id, problem: 'oom', detail: `${j.title}: the browser used ${browserOomMb} MB` });
    }
    const endedAt = Date.now();
    const ms = endedAt - (j.startedAt ?? endedAt);
    const lane = laneOf(j.kind);
    this.took[lane] = [...this.took[lane], ms].slice(-10);
    const u = this.usage.get(j.repoId) ?? { floor: j.who.floor, jobs: 0, ms: 0 };
    this.usage.set(j.repoId, { floor: j.who.floor, jobs: u.jobs + 1, ms: u.ms + ms });
    this.recent = [{ id: j.id, kind: j.kind, repoId: j.repoId, floor: j.who.floor, agentId: j.who.agentId, agent: j.who.agent, pr: j.who.pr, title: j.title, queuedAt: j.queuedAt, startedAt: j.startedAt, endedAt, ok, summary, shot: !!file, file }, ...this.recent].slice(0, RECENT_MAX);
    this.keep(j, { ok, summary, report: text, artifacts, endedAt });
    clearInterval(j.beat);
    if (!this.running.includes(j)) return; // answered by close()
    this.running = this.running.filter((r) => r !== j);
    this.lastLab.set(j.who.agentId, endedAt);
    j.done(text);
    this.pump();
  }

  /** Write a finished job's result to its folder whoever still waits for it, and remember it for a retry (#562). */
  private keep(j: Job, x: Pick<LabStored, 'ok' | 'summary' | 'report' | 'artifacts' | 'endedAt'>) {
    const r: LabStored = { id: j.id, kind: j.kind, title: j.title, key: j.key, queuedAt: j.queuedAt, startedAt: j.startedAt, callerGone: j.gone(), ...x };
    try {
      saveResult(j.who.worktree, r, this.host.forbidden(), x.endedAt);
    } catch (err) {
      console.warn(`[lab] couldn't keep job ${j.id}'s result: ${(err as Error).message}`);
    }
    if (r.callerGone) this.unread.set(j.who.agentId, [r, ...(this.unread.get(j.who.agentId) ?? [])].filter((u) => x.endedAt - u.endedAt <= REUSE_MS));
  }

  /** After a browser job, before the next starts: restart the shared browser when restartBrowser says so. */
  private async recycleBrowser(j: Job, full: boolean) {
    const runner = this.host.runner();
    const busy = this.running.some((r) => r !== j && laneOf(r.kind) === 'browser');
    const rssMb = busy || full ? null : await runner.browserMb().catch(() => null);
    if (restartBrowser({ full, rssMb, busy })) await runner.close().catch(() => undefined);
  }

  private emit() {
    this.host.emit(this.view());
  }
}

function titleOf(i: JobInput): string {
  if (i.kind === 'run') return clip(i.command.trim(), 80);
  const where = i.url ? clip(i.url.replace(/^https?:\/\//, ''), 60) : 'the floor preview';
  if (i.graphics === 'full') return `full-quality ${i.kind} ${where}`;
  return i.kind === 'screenshot' ? `screenshot ${where}${i.viewports.length > 1 ? ` × ${i.viewports.length}` : ''}` : `check ${where} (${i.steps.length} steps)`;
}

export type { JobInput as LabJobInput };
