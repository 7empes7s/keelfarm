import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEST_LAB, testLabSettings, type TestLabView } from '../shared/testLab.ts';
import type { SessionKind } from '../shared/health.ts';
import { browsersPath, estimateWaitMs, labArgv, labCommand, labFile, labOutDir, labPattern, labProblem, pickNext, silenceMs, TestLab, type LabRunner, type Requester, type RunResult, type TestLabHost } from './testLab.ts';
import { createLabTools } from './testLabTools.ts';
import { demoLabRunner, fakeShot } from './demoTestLab.ts';
import { devSystemPrompt, qaSystemPrompt } from './prompts.ts';

// The test lab (#56): one shared browser and one heavy run at a time for the whole office, fair across floors, behind
// #55's memory admission, running only allowlisted commands and writing only into the requester's own worktree.

const job = (id: string, kind: 'screenshot' | 'check' | 'run', repoId: string, queuedAt: number) => ({ id, kind, repoId, queuedAt });
const LIMITS = { browser: 1, heavy: 1 };

describe('pickNext', () => {
  it('starts at most the lane limits: one browser job and one heavy command', () => {
    const q = [job('a', 'screenshot', 'r1', 1), job('b', 'check', 'r1', 2), job('c', 'run', 'r1', 3), job('d', 'run', 'r2', 4)];
    expect(pickNext(q, [], LIMITS, new Map()).map((j) => j.id)).toEqual(['c', 'a']);
    expect(pickNext(q.slice(1), [q[0]], LIMITS, new Map()).map((j) => j.id)).toEqual(['d']); // r1 already runs one
    expect(pickNext(q, [], { browser: 2, heavy: 1 }, new Map()).map((j) => j.id)).toEqual(['c', 'a', 'b']);
  });

  it('is fair across floors: a floor with many requests does not starve another', () => {
    const q = [job('a1', 'screenshot', 'A', 1), job('a2', 'screenshot', 'A', 2), job('a3', 'screenshot', 'A', 3), job('b1', 'screenshot', 'B', 4)];
    // A was just served: B goes first even though its request is the newest.
    expect(pickNext(q, [], LIMITS, new Map([['A', 100]])).map((j) => j.id)).toEqual(['b1']);
    // Two slots: one per floor before a floor's second job.
    expect(pickNext(q, [], { browser: 2, heavy: 1 }, new Map()).map((j) => j.id)).toEqual(['a1', 'b1']);
    // A floor already running something waits behind one that isn't.
    expect(pickNext(q, [job('x', 'run', 'A', 0)], LIMITS, new Map()).map((j) => j.id)).toEqual(['b1']);
  });

  it("never runs two heavy commands of one floor at once (they share the floor's checkout)", () => {
    const q = [job('a', 'run', 'A', 1), job('b', 'run', 'B', 2)];
    expect(pickNext(q, [job('r', 'run', 'A', 0)], { browser: 1, heavy: 2 }, new Map()).map((j) => j.id)).toEqual(['b']);
    expect(pickNext([q[0]], [job('r', 'run', 'A', 0)], { browser: 1, heavy: 2 }, new Map())).toEqual([]);
  });

  it('estimates the wait from the place in the lane', () => {
    expect(estimateWaitMs(0, 1, 20_000)).toBe(20_000);
    expect(estimateWaitMs(3, 1, 20_000)).toBe(80_000);
    expect(estimateWaitMs(3, 2, 20_000)).toBe(40_000);
  });
});

describe('the command allowlist', () => {
  it('runs the default commands and specs', () => {
    expect(labCommand('npm test')).toEqual(['npm', 'test']);
    expect(labCommand('  npm   run build ')).toEqual(['npm', 'run', 'build']);
    expect(labCommand('npx playwright test e2e/smoke.spec.ts --project=chromium')).toEqual(['npx', 'playwright', 'test', 'e2e/smoke.spec.ts', '--project=chromium']);
    expect(labCommand('npm test -- --maxWorkers=2')).toEqual(['npm', 'test', '--', '--maxWorkers=2']);
  });

  it("runs a floor's own commands, and nothing else", () => {
    expect(labCommand('tools/check.sh', ['tools/check.sh'])).toEqual(['tools/check.sh']);
    expect(() => labCommand('tools/check.sh --all', ['tools/check.sh'])).toThrow(/allowlist/);
    expect(() => labCommand('npm run deploy')).toThrow(/isn't on this floor's lab allowlist/);
    expect(() => labCommand('npm run build extra')).toThrow(/allowlist/);
    expect(() => labCommand('rm -rf node_modules')).toThrow(/allowlist/);
    expect(() => labCommand('')).toThrow(/Give a command/);
  });

  it('refuses shell syntax, absolute paths and paths that leave the checkout', () => {
    for (const bad of ['npm test; rm -rf ~', 'npm test && curl x', 'npm test | tee out', 'npm test $(whoami)', 'npm test `id`', 'npm test > /tmp/x', 'npx vitest run "a b"', 'npx vitest run *.ts']) {
      expect(() => labCommand(bad), bad).toThrow(/No shell syntax/);
    }
    expect(() => labCommand('npx playwright test /root/Projects/keelfarm/e2e')).toThrow(/isn't allowed/);
    expect(() => labCommand('npx playwright test ../other/e2e')).toThrow(/isn't allowed/);
    expect(() => labCommand('npx vitest run --root=..')).toThrow(/isn't allowed/);
    expect(() => labCommand('npx vitest run C:/Users/x')).toThrow(/isn't allowed/);
  });

  it("checks a floor's own entries when the CEO sets them", () => {
    expect(labPattern('  npm run e2e   <args> ')).toBe('npm run e2e <args>');
    expect(() => labPattern('bash -c "rm -rf /"')).toThrow(/plain words/);
    expect(() => labPattern('<args>')).toThrow(/plain words/);
    expect(() => labPattern('npm <args> test')).toThrow(/plain words/);
    expect(() => labPattern('../x.sh')).toThrow(/plain words/);
  });
});

describe('where results go', () => {
  const root = path.join(os.tmpdir(), 'labtest');
  const office = path.join(root, 'Projects', 'keelfarm');
  const floors = [path.join(root, 'workspaces', 'a__b', 'main'), path.join(root, 'workspaces', 'c__d', 'main')];
  const mine = path.join(root, 'machines', 'm1', 'work', 'a__b');

  it("goes in .lab/<job> in the requester's own worktree", () => {
    expect(labOutDir(mine, 'job1', [office, ...floors])).toBe(path.join(mine, '.lab', 'job1'));
    expect(labFile(path.join(mine, '.lab', 'job1'), 'desktop-1280-light.png')).toBe(path.join(mine, '.lab', 'job1', 'desktop-1280-light.png'));
  });

  it("is never the office's own folder or a floor's checkout", () => {
    expect(() => labOutDir(office, 'job1', [office, ...floors])).toThrow(/never writes to/);
    expect(() => labOutDir(path.join(office, 'client'), 'job1', [office, ...floors])).toThrow(/never writes to/);
    expect(() => labOutDir(floors[1], 'job1', [office, ...floors])).toThrow(/never writes to/);
    expect(() => labOutDir(root, 'job1', [office, ...floors])).toThrow(/never writes to/); // it holds them
    expect(() => labOutDir('relative/dir', 'job1', [])).toThrow(/worktree/);
  });

  it('never leaves the job folder', () => {
    const out = path.join(mine, '.lab', 'job1');
    expect(() => labOutDir(mine, '../../x', [])).toThrow(/Bad job id/);
    expect(path.dirname(labFile(out, '../../../evil.png'))).toBe(out);
    expect(() => labFile(out, '..')).toThrow(/Bad file name/);
  });
});

// ---------- the lab ----------

function fakeRunner(log: string[], ms = 0, runs: Partial<RunResult>[] = []): LabRunner & { release(): void } {
  let gate: (() => void)[] = [];
  const wait = () => (ms < 0 ? new Promise<void>((r) => gate.push(r)) : Promise.resolve());
  return {
    browserUp: () => true,
    async screenshot(o) {
      log.push(`start shot ${o.url}`);
      await wait();
      log.push(`end shot ${o.url}`);
      return { shots: o.viewports.map((w) => ({ label: String(w), file: path.join(o.outDir, `${w}.png`) })), consoleErrors: [], pageErrors: [], failedRequests: [] };
    },
    async check(o) {
      log.push(`check ${o.url}`);
      return { steps: o.steps.map((s) => (s.do === 'no_horizontal_scroll' ? { step: s.do, ok: false, detail: 'the page scrolls sideways by 40px' } : { step: s.do, ok: true })), consoleErrors: [], pageErrors: [], failedRequests: [] };
    },
    checkout: async (o) => `${o.worktree}-lab`,
    async run(o) {
      log.push(`run ${o.argv.join(' ')} in ${o.dir}`);
      return { code: 1, ms: 1000, timedOut: false, tail: ['1 failed'], artifacts: ['test-results/a.png'], ...runs.shift() };
    },
    installBrowser: async (dir) => (log.push(`install browser in ${dir}`), true),
    warm: async () => true,
    close: async () => undefined,
    release() {
      const g = gate;
      gate = [];
      g.forEach((r) => r());
    },
  };
}

const who = (agentId: string, repoId = 'r1', floor = 1): Requester => ({ agentId, agent: agentId.toUpperCase(), repoId, floor, fullName: `o/${repoId}`, defaultBranch: 'main', worktree: path.join(os.tmpdir(), 'labdesk', agentId), pr: 7, labCommands: [] });
const shot = (url: string) => ({ kind: 'screenshot' as const, url, viewports: [375, 390, 1280], profile: 'phone' as const, theme: 'light' as const, actions: [], fullPage: false });

function lab(runner: LabRunner, refusal: (k: SessionKind) => string | null = () => null) {
  const views: TestLabView[] = [];
  const shots: string[] = [];
  const pages: string[] = [];
  const host: TestLabHost = {
    runner: () => runner,
    settings: () => DEFAULT_TEST_LAB,
    refusal,
    forbidden: () => [path.join(os.tmpdir(), 'office')],
    previewUrl: async (repoId, pr) => `http://localhost:6300/${repoId}/${pr}`,
    shot: (_a, file, page) => {
      shots.push(file);
      pages.push(page);
    },
    emit: (v) => views.push(v),
  };
  return { lab: new TestLab(host), views, shots, pages };
}

describe('TestLab', () => {
  afterEach(() => vi.useRealTimers());

  it('runs one browser job at a time: six agents at three viewports share the one browser in turn', async () => {
    const log: string[] = [];
    const runner = fakeRunner(log, -1);
    const { lab: l, views, pages } = lab(runner);
    const asks = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => l.submit(who(id, `r${i % 3}`, i % 3), shot(`http://localhost:${5000 + i}/`)));
    await Promise.resolve();
    expect(l.view().running).toHaveLength(1);
    expect(l.view().queue).toHaveLength(5);
    for (let i = 0; i < 6; i++) {
      runner.release();
      await new Promise((r) => setTimeout(r, 0));
    }
    const reports = await Promise.all(asks);
    expect(reports[0]).toMatch(/^3 screenshots/);
    expect(new Set(pages)).toEqual(new Set(Array.from({ length: 6 }, (_, i) => `http://localhost:${5000 + i}/`))); // each shot says its page (#230)
    // Never two at once: every start follows the previous end.
    const order = log.map((x) => x.split(' ')[0]);
    expect(order).toEqual(Array.from({ length: 6 }, () => ['start', 'end']).flat());
    // Fair across the three floors: each floor's first request runs before any floor's second.
    const firsts = log.filter((x) => x.startsWith('start')).slice(0, 3).map((x) => Number(x.match(/:(\d+)\//)![1]) % 3);
    expect(new Set(firsts).size).toBe(3);
    expect(views.at(-1)!.recent).toHaveLength(6);
    expect(views.at(-1)!.usage.reduce((n, u) => n + u.jobs, 0)).toBe(6);
  });

  it("waits for memory (#55's admission) and starts once there is room", async () => {
    vi.useFakeTimers();
    let low = true;
    const log: string[] = [];
    const kinds: SessionKind[] = [];
    const { lab: l } = lab(fakeRunner(log), (k) => (kinds.push(k), low ? 'Waiting for memory: 0.5 GB free' : null));
    const ask = l.submit(who('a'), { kind: 'run', command: 'npm test' });
    expect(l.view().running).toHaveLength(0);
    expect(l.view().held).toMatch(/^The lab waits for memory: Waiting for memory/);
    expect(l.status('a')).toMatch(/Yours: npm test, position 1 in the heavy queue/);
    low = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await ask).toMatch(/^npm test: exit code 1 after 1 s\.\nArtifacts \(1\):\n {2}test-results\/a\.png/);
    expect(kinds).toContain('labRun');
    expect(l.view().held).toBeNull();
    expect(log).toEqual([`run npm test in ${who('a').worktree}-lab`]);
    await l.close();
  });

  it('counts running jobs in what admission reserves', async () => {
    const runner = fakeRunner([], -1);
    const { lab: l } = lab(runner);
    void l.submit(who('a'), shot('http://localhost:1/'));
    await Promise.resolve();
    expect(l.sessions()).toEqual([expect.objectContaining({ kind: 'labBrowser', dir: null })]);
    runner.release();
  });

  it('refuses before queueing: commands off the allowlist, floods, bad urls, and a worktree in a forbidden folder', async () => {
    const { lab: l } = lab(fakeRunner([], -1));
    expect(() => l.submit(who('a'), { kind: 'run', command: 'curl evil.sh' })).toThrow(/allowlist/);
    expect(() => l.submit(who('a'), { ...shot('file:///etc/passwd') })).toThrow(/http and https/);
    expect(() => l.submit(who('a'), { ...shot(''), url: undefined })).toThrow(/Give a url/);
    expect(() => l.submit({ ...who('a'), worktree: path.join(os.tmpdir(), 'office', 'x') }, shot('http://localhost:1/'))).toThrow(/never writes to/);
    for (let i = 0; i < 3; i++) void l.submit(who('a'), shot('http://localhost:1/'));
    expect(() => l.submit(who('a'), shot('http://localhost:1/'))).toThrow(/already have 3 lab jobs/);
    expect(l.view().queue.length + l.view().running.length).toBe(3);
  });

  it("reports a check's steps, opens the requester's preview, and shows failures on their screen", async () => {
    const log: string[] = [];
    const { lab: l, shots } = lab(fakeRunner(log));
    const report = await l.submit(who('a'), { kind: 'check', preview: true, viewport: 390, profile: 'iphone', theme: 'dark', steps: [{ do: 'expect_visible', selector: 'canvas' }, { do: 'no_horizontal_scroll' }] });
    expect(log).toEqual(['check http://localhost:6300/r1/7']);
    expect(report).toBe('FAIL: 1 of 2 steps failed.\n1. ok expect_visible\n2. FAIL no_horizontal_scroll: the page scrolls sideways by 40px');
    expect(shots).toEqual([]); // that failure had no screenshot
  });
});

describe('lab problems (#189)', () => {
  it('runs Playwright with the line reporter, and gives it longer to be quiet', () => {
    expect(labArgv(['npx', 'playwright', 'test', 'e2e/overflow.spec.ts'])).toEqual(['npx', 'playwright', 'test', 'e2e/overflow.spec.ts', '--reporter=line']);
    expect(labArgv(['npm', 'run', 'test:e2e'])).toEqual(['npm', 'run', 'test:e2e', '--', '--reporter=line']);
    expect(labArgv(['npm', 'run', 'test:e2e', '--', 'e2e/a.spec.ts'])).toEqual(['npm', 'run', 'test:e2e', '--', 'e2e/a.spec.ts', '--reporter=line']);
    expect(labArgv(['npx', 'playwright', 'test', '--reporter=list'])).toEqual(['npx', 'playwright', 'test', '--reporter=list']);
    expect(labArgv(['npm', 'test'])).toEqual(['npm', 'test']);
    expect(silenceMs(['npx', 'playwright', 'test'])).toBe(600_000);
    expect(silenceMs(['npm', 'test'])).toBeNull(); // a quiet typecheck or build only has its timeout
  });

  it("tells the lab's failures from the code's", () => {
    const r = { code: 1, tail: ['1 failed'] };
    expect(labProblem(r)).toBeNull();
    expect(labProblem({ ...r, code: null, silent: true })).toBe('silent');
    expect(labProblem({ ...r, tail: ["browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium-1187/chrome"] })).toBe('browser');
    expect(labProblem({ ...r, tail: ['FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory'] })).toBe('oom');
    expect(labProblem({ ...r, code: 137 })).toBe('oom');
    expect(labProblem({ ...r, tail: ['Error: listen EADDRINUSE: address already in use :::4399'] })).toBe('port');
    expect(labProblem({ code: 0, tail: ['EADDRINUSE mentioned in a passing test'] })).toBeNull();
  });

  it('reports a run the watchdog stopped as a LAB ERROR', async () => {
    const { lab: l, views } = lab(fakeRunner([], 0, [{ code: null, silent: true, ms: 600_000, tail: ['Running 12 tests using 1 worker'] }]));
    const report = await l.submit(who('a'), { kind: 'run', command: 'npx playwright test e2e/overflow.spec.ts' });
    expect(report).toMatch(/^npx playwright test e2e\/overflow\.spec\.ts --reporter=line: went silent for 600 s and was stopped after 600 s\.\nLAB ERROR \(silent\)/);
    expect(views.at(-1)!.recent[0]).toMatchObject({ ok: false, summary: 'lab error: silent' });
  });

  it('installs a missing browser once and runs again', async () => {
    const log: string[] = [];
    const { lab: l } = lab(fakeRunner(log, 0, [{ tail: ["Executable doesn't exist at /x/chrome"] }, { code: 0, tail: ['12 passed'] }]));
    const report = await l.submit(who('a'), { kind: 'run', command: 'npx playwright test' });
    const dir = `${who('a').worktree}-lab`;
    expect(log).toEqual([`run npx playwright test --reporter=line in ${dir}`, `install browser in ${dir}`, `run npx playwright test --reporter=line in ${dir}`]);
    expect(report).toMatch(/exit code 0/);
    expect(report).not.toMatch(/LAB ERROR/);
  });

  it('shares one browser cache', () => {
    expect(browsersPath({ PLAYWRIGHT_BROWSERS_PATH: '/srv/pw' }, '/home/m', 'linux')).toBe('/srv/pw');
    expect(browsersPath({}, '/home/m', 'linux')).toBe(path.join('/home/m', '.cache', 'ms-playwright'));
    expect(browsersPath({ LOCALAPPDATA: 'C:\\L' }, 'C:\\U', 'win32')).toBe(path.join('C:\\L', 'ms-playwright'));
  });
});

describe('the lab tools', () => {
  it('validate their input and answer in plain text', async () => {
    const asked: unknown[] = [];
    const tools = createLabTools({ submit: async (i) => (asked.push(i), 'ok'), status: () => 'Lab: 0 running, 0 waiting' });
    expect(await tools.call('lab_status', {})).toBe('Lab: 0 running, 0 waiting');
    expect(await tools.call('lab_screenshot', { url: 'http://localhost:5678/', viewports: [390, 1280], theme: 'dark' })).toBe('ok');
    expect(asked[0]).toEqual({ kind: 'screenshot', url: 'http://localhost:5678/', preview: undefined, viewports: [390, 1280], profile: 'desktop', theme: 'dark', waitFor: undefined, actions: [], fullPage: false });
    expect(await tools.call('lab_run', { command: 'npm test' })).toBe('ok');
    const refused = createLabTools({ submit: () => Promise.reject(new Error('the queue is full')), status: () => '' });
    expect(await refused.call('lab_run', { command: 'npm test' })).toBe('Refused: the queue is full');
  });
});

describe('the demo lab', () => {
  it('draws real PNGs for its fake screenshots', async () => {
    expect(fakeShot(4, 3, false).subarray(1, 4).toString()).toBe('PNG');
    const out = path.join(os.tmpdir(), `demolab-${process.pid}`, '.lab', 'j1');
    const r = await demoLabRunner().screenshot({ url: 'http://x/', profile: 'desktop', theme: 'light', outDir: out, viewports: [390], actions: [], fullPage: false });
    expect(r.shots[0].file).toBe(path.join(out, 'desktop-390-light.png'));
  });
});

describe('settings and prompts', () => {
  it('keeps valid settings and clamps counts', () => {
    expect(testLabSettings(DEFAULT_TEST_LAB, { enabled: false, browserJobs: 9, heavyJobs: 'x' })).toEqual({ enabled: false, browserJobs: 4, heavyJobs: 1 });
  });

  it('tells lab sessions to use the lab tools instead of their own browser', () => {
    const base = { agent: { name: 'Ada' }, repo: { fullName: 'o/r', defaultBranch: 'main', autoMerge: true, browserTesting: true, summary: '', mission: '', qaBrief: '', playbook: '' }, port: 5678, cwd: '/w', branch: 'b' };
    const dev = devSystemPrompt({ ...base, linked: [], lab: true });
    expect(dev).toMatch(/lab_screenshot and lab_browser_check/);
    expect(dev).not.toMatch(/mcp__playwright/);
    expect(devSystemPrompt({ ...base, linked: [] })).toMatch(/mcp__playwright__browser_navigate/);
    const qa = qaSystemPrompt({ ...base, pr: { number: 1, title: 't', headRefName: 'h', url: 'u' }, lab: true });
    expect(qa).toMatch(/lab_browser_check/);
    expect(qa).not.toMatch(/browser_take_screenshot/);
  });
});
