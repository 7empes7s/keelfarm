// The test lab (#56): one office-wide desk that runs agents' screenshots, browser checks and heavy commands for them,
// so the computer runs one shared browser and one heavy suite at a time instead of one per agent. It is a
// deterministic runner, not a model session: requests cost no tokens. Pure rules first (fair queue, command allowlist,
// where results may be written, the reports agents read), then TestLab, which the Swarm drives. The browser and the
// commands themselves are a LabRunner (server/testLabRunner.ts; the demo fakes it).
import path from 'node:path';
import type { SessionKind } from '../shared/health.ts';
import { laneOf, type LabJobKind, type LabJobView, type LabLane, type LabProfile, type LabResultView, type TestLabSettings, type TestLabView } from '../shared/testLab.ts';

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
}

/**
 * The jobs to start now. Each lane runs up to its limit; among the waiting jobs the floor with the fewest running jobs
 * goes first, then the floor served longest ago, then the oldest request. Two heavy jobs of one floor never run at once:
 * they share the floor's lab checkout.
 */
export function pickNext<J extends Queued>(queue: readonly J[], running: readonly J[], limits: Record<LabLane, number>, servedAt: ReadonlyMap<string, number>): J[] {
  const now = [...running];
  const served = new Map(servedAt);
  const picked: J[] = [];
  for (const lane of ['heavy', 'browser'] as const) {
    for (;;) {
      if (now.filter((j) => laneOf(j.kind) === lane).length >= limits[lane]) break;
      const busy = (repoId: string) => now.filter((j) => j.repoId === repoId).length;
      const next = queue
        .filter((j) => laneOf(j.kind) === lane && !picked.includes(j) && !(lane === 'heavy' && now.some((r) => r.kind === 'run' && r.repoId === j.repoId)))
        .sort((a, b) => busy(a.repoId) - busy(b.repoId) || (served.get(a.repoId) ?? 0) - (served.get(b.repoId) ?? 0) || a.queuedAt - b.queuedAt)[0];
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
  artifacts: string[]; // files the run left in its report folders, relative to the checkout
}

/** lab_screenshot's answer: the files, and what went wrong on the page. Small: agents pay for every line. */
function shotReport(r: ShotResult): string {
  const issues = r.consoleErrors.length + r.pageErrors.length + r.failedRequests.length;
  return [
    `${r.shots.length} screenshot${r.shots.length === 1 ? '' : 's'} (in your worktree, not committed; Read a file to see it):`,
    ...r.shots.map((s) => `  ${s.label}: ${s.file}`),
    ...(issues ? [...few('Console errors', r.consoleErrors), ...few('Page errors', r.pageErrors), ...few('Failed requests', r.failedRequests)] : ['No console errors, page errors or failed requests.']),
  ].join('\n');
}

/** lab_browser_check's answer: pass/fail per step, with a screenshot of each failure. */
function checkReport(r: CheckResult): string {
  const failed = r.steps.filter((s) => !s.ok).length;
  return [
    failed ? `FAIL: ${failed} of ${r.steps.length} steps failed.` : `PASS: all ${r.steps.length} steps.`,
    ...r.steps.map((s, i) => `${i + 1}. ${s.ok ? 'ok' : 'FAIL'} ${clip(s.step, 120)}${s.detail ? `: ${clip(s.detail, 240)}` : ''}${s.shot ? ` (screenshot ${s.shot})` : ''}`),
    ...few('Console errors', r.consoleErrors),
    ...few('Page errors', r.pageErrors),
  ].join('\n');
}

/** lab_run's answer: exit code, duration, the output's last lines (at most 200) and the artifacts. */
function runReport(command: string, r: RunResult): string {
  return [
    `${command}: ${r.timedOut ? 'timed out' : `exit code ${r.code}`} after ${Math.round(r.ms / 1000)} s.`,
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
  outDir: string;
}

export interface LabRunner {
  /** The shared browser is running. */
  browserUp(): boolean;
  screenshot(o: BrowserOpts & { viewports: number[]; waitFor?: string; actions: LabAction[]; fullPage: boolean }): Promise<ShotResult>;
  check(o: BrowserOpts & { viewport: number; steps: LabStep[] }): Promise<CheckResult>;
  /** The floor's lab checkout at the requester's committed HEAD (`worktree`) or a branch on origin, dependencies installed. */
  checkout(o: { fullName: string; defaultBranch: string; worktree: string; branch?: string }): Promise<string>;
  run(o: { dir: string; argv: string[]; timeoutMs: number }): Promise<RunResult>;
  /** Close the browser (idle, or the office stops). */
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
  | ({ kind: 'screenshot'; viewports: number[]; profile: LabProfile; theme: 'light' | 'dark'; waitFor?: string; actions: LabAction[]; fullPage: boolean } & LabTarget)
  | ({ kind: 'check'; viewport: number; profile: LabProfile; theme: 'light' | 'dark'; steps: LabStep[] } & LabTarget)
  | { kind: 'run'; command: string; branch?: string; timeoutMin?: number };

interface Job extends Queued {
  input: JobInput;
  who: Requester;
  title: string;
  startedAt: number | null;
  done: (text: string) => void;
}

// ---------- the lab ----------

export interface TestLabHost {
  runner(): LabRunner;
  settings(): TestLabSettings;
  /** Why a job of this kind can't start for memory now (#55's admission), or null. */
  refusal(kind: SessionKind): string | null;
  /** Folders the lab never writes to: the office's own and every floor's checkout. */
  forbidden(): string[];
  /** The address of the requester's floor's app: their PR's preview (started on demand), else the floor's. */
  previewUrl(repoId: string, pr: number | null): Promise<string>;
  /** A screenshot the lab took for an agent: their screen in the office shows it, and QA's evidence keeps it. */
  shot(agentId: string, file: string): void;
  emit(view: TestLabView): void;
}

const BROWSER_IDLE_MS = 5 * 60_000;
const RETRY_MS = 5_000;
const DEFAULT_RUN_MIN = 15;

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

  constructor(private host: TestLabHost) {}

  /** Queue a request; resolves with the report the agent reads (refusals included: they're tool errors upstream). */
  submit(who: Requester, input: JobInput, now = Date.now()): Promise<string> {
    if (this.queue.length >= QUEUE_MAX) throw new Error(`The lab's queue is full (${QUEUE_MAX} jobs): try again in a few minutes.`);
    if ([...this.queue, ...this.running].filter((j) => j.who.agentId === who.agentId).length >= PER_AGENT_MAX) throw new Error(`You already have ${PER_AGENT_MAX} lab jobs waiting or running: wait for them first.`);
    if (input.kind === 'run') labCommand(input.command, who.labCommands); // refused before it queues
    if (input.kind !== 'run' && !input.url && !input.preview) throw new Error('Give a url, or preview: true for your floor\'s app.');
    if (input.kind !== 'run' && input.url) labUrl(input.url);
    labOutDir(who.worktree, 'x', this.host.forbidden());
    return new Promise((done) => {
      const id = `${now.toString(36)}${(++seq).toString(36)}`;
      this.queue.push({ id, kind: input.kind, repoId: who.repoId, queuedAt: now, input, who, title: titleOf(input), startedAt: null, done });
      this.pump();
    });
  }

  /** lab_status: where the requester's jobs stand, what runs, and the wait. */
  status(agentId: string | null): string {
    const s = this.host.settings();
    const lines = [`Lab: ${this.running.length} running, ${this.queue.length} waiting (at most ${s.browserJobs} browser job${s.browserJobs === 1 ? '' : 's'} and ${s.heavyJobs} heavy command${s.heavyJobs === 1 ? '' : 's'} at a time).`];
    for (const j of this.running) lines.push(`Running: ${j.title} for ${j.who.agent} (floor ${j.who.floor}), ${Math.round((Date.now() - (j.startedAt ?? Date.now())) / 1000)} s so far.`);
    for (const lane of ['browser', 'heavy'] as const) {
      const waiting = this.queue.filter((j) => laneOf(j.kind) === lane);
      waiting.forEach((j, i) => {
        if (j.who.agentId === agentId) lines.push(`Yours: ${j.title}, position ${i + 1} in the ${lane} queue, about ${Math.ceil(estimateWaitMs(i, lane === 'browser' ? s.browserJobs : s.heavyJobs, this.avg(lane)) / 60_000)} min.`);
      });
    }
    if (this.held) lines.push(this.held);
    return lines.join('\n');
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

  /** Running lab jobs, for #55's admission: what they still reserve. */
  sessions(): { id: string; kind: SessionKind; dir: null; startedAt: number }[] {
    return this.running.map((j) => ({ id: `lab:${j.id}`, kind: laneOf(j.kind) === 'browser' ? 'labBrowser' : 'labRun', dir: null, startedAt: j.startedAt ?? Date.now() }));
  }

  async close() {
    if (this.retry) clearTimeout(this.retry);
    if (this.idle) clearTimeout(this.idle);
    for (const j of this.queue) j.done('Refused: the office is stopping; ask the lab again once it is back.');
    this.queue = [];
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
    const next = pickNext(this.queue, this.running, { browser: s.browserJobs, heavy: s.heavyJobs }, this.served);
    let held: string | null = null;
    for (const j of next) {
      const why = this.host.refusal(laneOf(j.kind) === 'browser' ? 'labBrowser' : 'labRun');
      if (why) {
        held = `The lab waits for memory: ${why}`;
        continue;
      }
      this.queue = this.queue.filter((q) => q !== j);
      this.running.push(j);
      j.startedAt = Date.now();
      this.served.set(j.repoId, j.startedAt);
      void this.execute(j);
    }
    this.held = held;
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
    try {
      const outDir = labOutDir(j.who.worktree, j.id, this.host.forbidden());
      const input = j.input;
      if (input.kind === 'run') {
        const argv = labCommand(input.command, j.who.labCommands);
        const dir = await runner.checkout({ fullName: j.who.fullName, defaultBranch: j.who.defaultBranch, worktree: j.who.worktree, branch: input.branch });
        const r = await runner.run({ dir, argv, timeoutMs: Math.max(1, Math.min(30, input.timeoutMin ?? DEFAULT_RUN_MIN)) * 60_000 });
        ok = r.code === 0 && !r.timedOut;
        summary = r.timedOut ? 'timed out' : `exit ${r.code}`;
        text = runReport(argv.join(' '), r);
      } else {
        const url = input.url ? labUrl(input.url) : await this.host.previewUrl(j.repoId, j.who.pr);
        const base = { url, profile: input.profile, theme: input.theme, outDir };
        if (input.kind === 'screenshot') {
          const r = await runner.screenshot({ ...base, viewports: input.viewports, waitFor: input.waitFor, actions: input.actions, fullPage: input.fullPage });
          ok = !r.pageErrors.length && !r.consoleErrors.length;
          summary = `${r.shots.length} shots, ${r.consoleErrors.length + r.pageErrors.length} errors`;
          file = r.shots[0]?.file;
          for (const s of r.shots) this.host.shot(j.who.agentId, s.file);
          text = shotReport(r);
        } else {
          const r = await runner.check({ ...base, viewport: input.viewport, steps: input.steps });
          const failed = r.steps.filter((s) => !s.ok);
          ok = !failed.length;
          summary = ok ? `pass, ${r.steps.length} steps` : `${failed.length} of ${r.steps.length} steps failed`;
          file = failed.find((s) => s.shot)?.shot;
          if (file) this.host.shot(j.who.agentId, file);
          text = checkReport(r);
        }
      }
    } catch (err) {
      summary = clip((err as Error).message, 160);
      text = `Refused: ${(err as Error).message}`;
    }
    const endedAt = Date.now();
    const ms = endedAt - (j.startedAt ?? endedAt);
    const lane = laneOf(j.kind);
    this.took[lane] = [...this.took[lane], ms].slice(-10);
    const u = this.usage.get(j.repoId) ?? { floor: j.who.floor, jobs: 0, ms: 0 };
    this.usage.set(j.repoId, { floor: j.who.floor, jobs: u.jobs + 1, ms: u.ms + ms });
    this.recent = [{ id: j.id, kind: j.kind, repoId: j.repoId, floor: j.who.floor, agentId: j.who.agentId, agent: j.who.agent, pr: j.who.pr, title: j.title, queuedAt: j.queuedAt, startedAt: j.startedAt, endedAt, ok, summary, shot: !!file, file }, ...this.recent].slice(0, RECENT_MAX);
    this.running = this.running.filter((r) => r !== j);
    j.done(text);
    this.pump();
  }

  private emit() {
    this.host.emit(this.view());
  }
}

function titleOf(i: JobInput): string {
  if (i.kind === 'run') return clip(i.command.trim(), 80);
  const where = i.url ? clip(i.url.replace(/^https?:\/\//, ''), 60) : 'the floor preview';
  return i.kind === 'screenshot' ? `screenshot ${where}${i.viewports.length > 1 ? ` × ${i.viewports.length}` : ''}` : `check ${where} (${i.steps.length} steps)`;
}

export type { JobInput as LabJobInput };
