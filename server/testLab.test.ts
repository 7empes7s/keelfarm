import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEST_LAB, testLabSettings, type TestLabView } from '../shared/testLab.ts';
import type { SessionKind } from '../shared/health.ts';
import { browsersPath, estimateWaitMs, LAB_BROWSER_KILL_MB, labArgv, labCommand, labFile, labOutDir, LAB_AGE_MS, labPattern, labProblem, laneOrder, pickNext, silenceMs, TestLab, type LabRunner, type Requester, type RunResult, type TestLabHost } from './testLab.ts';
import { expiredResults, requestKey, saveResult } from './testLabResults.ts';
import { createLabTools, labProgress, progressStream } from './testLabTools.ts';
import { demoLabRunner, fakeShot } from './demoTestLab.ts';
import { devSystemPrompt, qaSystemPrompt } from './prompts.ts';

// The test lab (#56): one shared browser and one heavy run at a time for the whole office, fair across floors, behind
// #55's memory admission, running only allowlisted commands and writing only into the requester's own worktree.

const job = (id: string, kind: 'screenshot' | 'check' | 'run', repoId: string, queuedAt: number) => ({ id, kind, repoId, queuedAt });
const LIMITS = { browser: 1, heavy: 1 };

describe('pickNext', () => {
  it('starts at most the lane limits: one browser job and one heavy command', () => {
    const q = [job('a', 'screenshot', 'r1', 1), job('b', 'check', 'r1', 2), job('c', 'run', 'r1', 3), job('d', 'run', 'r2', 4)];
    expect(pickNext(q, [], LIMITS, new Map(), 10).map((j) => j.id)).toEqual(['c', 'a']);
    expect(pickNext(q.slice(1), [q[0]], LIMITS, new Map(), 10).map((j) => j.id)).toEqual(['d']); // r1 already runs one
    expect(pickNext(q, [], { browser: 2, heavy: 1 }, new Map(), 10).map((j) => j.id)).toEqual(['c', 'a', 'b']);
  });

  it('is fair across floors: a floor with many requests does not starve another', () => {
    const q = [job('a1', 'screenshot', 'A', 1), job('a2', 'screenshot', 'A', 2), job('a3', 'screenshot', 'A', 3), job('b1', 'screenshot', 'B', 4)];
    // A was just served: B goes first even though its request is the newest.
    expect(pickNext(q, [], LIMITS, new Map([['A', 100]]), 10).map((j) => j.id)).toEqual(['b1']);
    // Two slots: one per floor before a floor's second job.
    expect(pickNext(q, [], { browser: 2, heavy: 1 }, new Map(), 10).map((j) => j.id)).toEqual(['a1', 'b1']);
    // A floor already running something waits behind one that isn't.
    expect(pickNext(q, [job('x', 'run', 'A', 0)], LIMITS, new Map(), 10).map((j) => j.id)).toEqual(['b1']);
  });

  it("never runs two heavy commands of one floor at once (they share the floor's checkout)", () => {
    const q = [job('a', 'run', 'A', 1), job('b', 'run', 'B', 2)];
    expect(pickNext(q, [job('r', 'run', 'A', 0)], { browser: 1, heavy: 2 }, new Map(), 10).map((j) => j.id)).toEqual(['b']);
    expect(pickNext([q[0]], [job('r', 'run', 'A', 0)], { browser: 1, heavy: 2 }, new Map(), 10)).toEqual([]);
  });

  it('caps the whole lab, with one slot kept for a browser job: a heavy run never blocks a check (#560, #618)', () => {
    const q = [job('a', 'run', 'A', 1), job('b', 'screenshot', 'B', 2), job('c', 'check', 'C', 3), job('d', 'run', 'D', 4)];
    expect(pickNext(q, [], { ...LIMITS, total: 1 }, new Map(), 10).map((j) => j.id)).toEqual(['b', 'a']);
    expect(pickNext(q.slice(1), [q[0]], { ...LIMITS, total: 1 }, new Map(), 10).map((j) => j.id)).toEqual(['b']); // beside the heavy run
    expect(pickNext([q[3]], [q[0], q[1]], { ...LIMITS, total: 1 }, new Map(), 10)).toEqual([]); // heavy runs wait for each other
    expect(pickNext(q, [], { browser: 2, heavy: 1, total: 1 }, new Map(), 10).map((j) => j.id)).toEqual(['b', 'c']); // two checks fill both slots
    expect(pickNext(q, [], { browser: 2, heavy: 2, total: 2 }, new Map(), 10).map((j) => j.id)).toEqual(['b', 'c', 'a']);
  });

  it('starts a check queued behind 5 heavy runs after at most the one already running (#618)', () => {
    const heavy = [1, 2, 3, 4, 5].map((i) => job(`e${i}`, 'run', `R${i}`, i));
    const check = job('check', 'check', 'C', 6);
    const limits = { ...LIMITS, total: 1 };
    expect(pickNext([...heavy, check], [], limits, new Map(), 10).map((j) => j.id)).toEqual(['check', 'e1']);
    expect(pickNext([...heavy.slice(1), check], [heavy[0]], limits, new Map(), 10).map((j) => j.id)).toEqual(['check']);
    // Every heavy run aged over 5 minutes: the check still takes the slot kept for it.
    expect(pickNext([...heavy.slice(1), check], [heavy[0]], { browser: 1, heavy: 1, total: 1 }, new Map(), 10 + LAB_AGE_MS).map((j) => j.id)).toEqual(['check']);
  });

  it('lets a job that waited over 5 minutes go first, whatever its floor or lane (#618)', () => {
    const q = [job('a1', 'screenshot', 'A', 0), job('b1', 'screenshot', 'B', LAB_AGE_MS)];
    expect(pickNext(q, [], LIMITS, new Map([['A', 100]]), LAB_AGE_MS + 10).map((j) => j.id)).toEqual(['a1']); // A was just served, but a1 is aged
    expect(pickNext(q, [], LIMITS, new Map([['A', 100]]), LAB_AGE_MS - 10).map((j) => j.id)).toEqual(['b1']);
    // Under a shared cap two browser jobs fill it; an aged heavy run's lane goes first.
    const shared = [job('e', 'run', 'E', 0), job('c1', 'check', 'C', 1), job('c2', 'check', 'D', 2)];
    expect(pickNext(shared, [], { browser: 2, heavy: 1, total: 1 }, new Map(), 10).map((j) => j.id)).toEqual(['c1', 'c2']);
    expect(pickNext(shared, [], { browser: 2, heavy: 1, total: 1 }, new Map(), LAB_AGE_MS + 10).map((j) => j.id)).toEqual(['e', 'c1']);
  });

  it('orders a lane the way it starts, for the real queue position (#618)', () => {
    const q = [job('a1', 'screenshot', 'A', 1), job('a2', 'screenshot', 'A', 2), job('b1', 'screenshot', 'B', 3)];
    expect(laneOrder(q, [job('x', 'run', 'A', 0)], new Map(), 10).map((j) => j.id)).toEqual(['b1', 'a1', 'a2']);
    expect(laneOrder(q, [job('x', 'run', 'A', 0)], new Map(), LAB_AGE_MS + 2).map((j) => j.id)).toEqual(['a1', 'b1', 'a2']);
  });

  it('runs one job per agent at a time (#578)', () => {
    const mine = (id: string, kind: 'screenshot' | 'run', agentId: string, at: number) => ({ ...job(id, kind, `R${id}`, at), agentId });
    expect(pickNext([mine('a2', 'screenshot', 'a', 1), mine('b1', 'screenshot', 'b', 2)], [mine('a1', 'run', 'a', 0)], { browser: 2, heavy: 1 }, new Map(), 10).map((j) => j.id)).toEqual(['b1']);
    expect(pickNext([mine('a1', 'run', 'a', 1), mine('a2', 'screenshot', 'a', 2)], [], { browser: 1, heavy: 1 }, new Map(), 10).map((j) => j.id)).toEqual(['a1']);
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
    browserMb: async () => null,
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

function lab(runner: LabRunner, refusal: (k: SessionKind) => string | null = () => null, updateGate?: () => readonly string[] | null, settings = DEFAULT_TEST_LAB) {
  const views: TestLabView[] = [];
  const shots: string[] = [];
  const pages: string[] = [];
  const host: TestLabHost = {
    runner: () => runner,
    settings: () => settings,
    refusal,
    forbidden: () => [path.join(os.tmpdir(), 'office')],
    previewUrl: async (repoId, pr) => `http://localhost:6300/${repoId}/${pr}`,
    shot: (_a, file, page) => {
      shots.push(file);
      pages.push(page);
    },
    emit: (v) => views.push(v),
    updateGate,
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
    expect(l.view().held).toBe('Waiting for memory: 0.5 GB free'); // said once (#313)
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

  it("starts no queued job while the office drains for an update, except a holding QA round's, and says why (#333)", async () => {
    const log: string[] = [];
    const runner = fakeRunner(log, -1);
    let gate: readonly string[] | null = ['qa1'];
    const { lab: l } = lab(runner, undefined, () => gate);
    const dev = l.submit(who('dev1', 'r2'), shot('http://localhost:1/'));
    const qa = l.submit(who('qa1'), shot('http://localhost:2/'));
    await Promise.resolve();
    expect(l.view().running.map((j) => j.agentId)).toEqual(['qa1']);
    expect(l.view().held).toBe('Waiting for the office update: queued jobs start once the office has restarted.');
    expect(l.activity()).toMatchObject({ running: ['qa1'], waiting: ['dev1'] });
    gate = []; // handed to the launcher: nothing new starts
    runner.release();
    await qa;
    expect(l.view().running).toEqual([]);
    expect(l.activity().lastLab.has('qa1')).toBe(true);
    gate = null; // the update is over (here: the preflight refused it)
    l.reopen();
    await Promise.resolve();
    expect(l.view().running.map((j) => j.agentId)).toEqual(['dev1']);
    expect(l.view().held).toBeNull();
    runner.release();
    await dev;
  });

  it('answers running and waiting jobs when the office restarts, so their sessions ask again (#333)', async () => {
    const { lab: l } = lab(fakeRunner([], -1));
    const running = l.submit(who('a'), shot('http://localhost:1/'));
    const waiting = l.submit(who('b'), shot('http://localhost:2/'));
    await l.close(true);
    expect(await running).toMatch(/^Cut off: the office is restarting\. Make the same lab call again/);
    expect(await waiting).toMatch(/^Not run: the office is restarting/);
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

describe('a browser check behind heavy runs (#618)', () => {
  it('starts beside 5 queued heavy runs, and lab_status gives the real position and why a job waits', async () => {
    const gates: (() => void)[] = [];
    const runner = { ...fakeRunner([], -1), run: () => new Promise<RunResult>((r) => gates.push(() => r({ code: 0, ms: 1, timedOut: false, tail: [], artifacts: [] }))) };
    const { lab: l } = lab(runner, () => null, undefined, { ...DEFAULT_TEST_LAB, totalJobs: 1 });
    const runs = [0, 1, 2, 3, 4].map((i) => l.submit(who(`h${i}`, `r${i}`, i), { kind: 'run', command: 'npm test' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(l.view().running.map((j) => j.agentId)).toEqual(['h0']);
    expect(l.status('h1')).toMatch(/Yours: npm test, position 1 in the heavy queue, waiting because the heavy slots are full: npm test running/);
    expect(l.status('h4')).toMatch(/position 4 in the heavy queue, waiting because the heavy slots are full/);
    const check = l.submit(who('c', 'r9', 9), shot('http://localhost:1/'));
    expect(l.view().running.map((j) => j.agentId)).toEqual(['h0', 'c']); // the kept slot: no heavy run blocks it
    // The browser lane is busy now: a second floor's check is ahead of one from a floor that already runs a job.
    const busyFloor = l.submit(who('d', 'r0', 0), shot('http://localhost:2/'));
    const freeFloor = l.submit(who('e', 'r8', 8), shot('http://localhost:3/'));
    expect(l.view().queue.filter((j) => j.kind === 'screenshot').map((j) => j.agentId)).toEqual(['d', 'e']);
    expect(l.status('e')).toMatch(/Yours: screenshot localhost:3\/ × 3, position 1 in the browser queue, waiting because the browser slots are full/);
    expect(l.status('d')).toMatch(/position 2 in the browser queue/);
    for (let i = 0; i < 4; i++) {
      runner.release();
      gates.splice(0).forEach((g) => g());
      await new Promise((r) => setTimeout(r, 0));
    }
    gates.splice(0).forEach((g) => g());
    expect(await check).toMatch(/^3 screenshots/);
    await Promise.all([busyFloor, freeFloor]);
    for (let i = 0; i < 6 && gates.length + l.view().queue.length + l.view().running.length; i++) {
      gates.splice(0).forEach((g) => g());
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(runs);
  });
});

describe('never silent while queued (#560)', () => {
  afterEach(() => vi.useRealTimers());
  const busy = () => {
    const runner = fakeRunner([], -1);
    const l = lab(runner, () => null, undefined, { ...DEFAULT_TEST_LAB, totalJobs: 1 }).lab;
    void l.submit(who('a'), shot('http://localhost:9/'));
    return { runner, l };
  };

  it('sends a heartbeat with the place and the reason every 20 s while a job waits, and stops once it ends', async () => {
    vi.useFakeTimers();
    const { runner, l } = busy();
    const beats: { position: number; message: string }[] = [];
    const ask = l.submit(who('b', 'r2', 2), shot('http://localhost:8/'), Date.now(), (b) => beats.push(b));
    await vi.advanceTimersByTimeAsync(19_000);
    expect(beats).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(beats).toEqual([{ position: 1, message: expect.stringMatching(/^Lab job \w+ queued: position 1 in the lab's browser queue \(the browser slots are full: screenshot localhost:9\/ × 3 running\)/) }]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(beats).toHaveLength(2);
    runner.release();
    await vi.advanceTimersByTimeAsync(0);
    runner.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.view().recent.map((j) => j.agentId)).toEqual(['b', 'a']); // started, and done
    await vi.advanceTimersByTimeAsync(60_000);
    expect(beats).toHaveLength(2);
    expect(await ask).toMatch(/^3 screenshots/);
  });

  it('keeps a call that waits 10 minutes behind 3 jobs hearing from the lab at least every 60 s, then answers it (#578)', async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const runner = fakeRunner([], -1);
    const l = lab(runner, () => null, undefined, { ...DEFAULT_TEST_LAB, totalJobs: 1 }).lab;
    const others = ['a', 'b', 'c'].map((id, i) => l.submit(who(id, `r${i}`, i), shot(`http://localhost:${i}/`)));
    const heard: number[] = [];
    const beats: { position: number; message: string }[] = [];
    const call = new AbortController();
    const ask = l.submit(who('d', 'r9', 9), shot('http://localhost:9/'), Date.now(), (b) => (heard.push(Date.now()), beats.push(b)), call.signal);
    expect(l.view().queue).toHaveLength(3); // b, c and d wait behind a
    let answer: string | null = null;
    void ask.then((t) => (answer = t));
    for (let min = 1; min <= 10; min++) {
      await vi.advanceTimersByTimeAsync(60_000);
      if (min % 3 === 0) runner.release(); // the jobs ahead, then d itself, each take minutes
    }
    runner.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(call.signal.aborted).toBe(false);
    expect(answer).toMatch(/^3 screenshots/);
    const times = [start, ...heard, Date.now()];
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(60_000);
    expect(beats.some((b) => b.position === 0 && /^Lab job \w+ running: screenshot localhost:9\/ × 3, \d+ s so far/.test(b.message))).toBe(true); // also while it runs
    expect(beats.some((b) => b.position > 0)).toBe(true);
    await Promise.all(others);
  });

  it("drops a queued job whose caller has gone, so it holds no one's place (#578)", async () => {
    const { runner, l } = busy();
    const call = new AbortController();
    const ask = l.submit(who('b', 'r2', 2), shot('http://localhost:8/'), Date.now(), () => undefined, call.signal);
    expect(l.view().queue).toHaveLength(1);
    call.abort();
    expect(l.view().queue).toEqual([]);
    expect(await ask).toMatch(/^Not run: the call was cut off/);
    runner.release();
  });

  it('answers at once with the place and when to retry when the caller cannot take progress, and queues nothing', () => {
    const { runner, l } = busy();
    expect(() => l.submit(who('b', 'r2', 2), shot('http://localhost:8/'), Date.now(), null)).toThrow(/^Queued, position 1 in the lab's browser queue \(the browser slots are full: screenshot localhost:9\/ × 3 running\): nothing ran\. Retry in \d+ s\.$/);
    expect(l.view().queue).toEqual([]);
    runner.release();
  });

  it('runs at once without progress when the lab is free', async () => {
    const { lab: l } = lab(fakeRunner([]));
    expect(await l.submit(who('a'), shot('http://localhost:1/'), Date.now(), null)).toMatch(/^3 screenshots/);
  });

  it("turns the MCP call's progress token into progress notifications, and asks for a stream only when there is one", async () => {
    const sent: unknown[] = [];
    const beat = labProgress({ _meta: { progressToken: 'p1' }, sendNotification: async (n: unknown) => void sent.push(n) });
    beat!({ position: 2, message: 'Queued: position 2' });
    beat!({ position: 1, message: 'Queued: position 1' });
    expect(sent).toEqual([
      { method: 'notifications/progress', params: { progressToken: 'p1', progress: 1, message: 'Queued: position 2' } },
      { method: 'notifications/progress', params: { progressToken: 'p1', progress: 2, message: 'Queued: position 1' } },
    ]);
    expect(labProgress({ _meta: {}, sendNotification: async () => undefined })).toBeNull();
    expect(labProgress(undefined)).toBeNull();
    expect(progressStream({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lab_run', _meta: { progressToken: 3 } } })).toBe(true);
    expect(progressStream({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lab_run' } })).toBe(false);
    expect(progressStream({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe(false);
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

  it("tells the office about the lab's own failures, for IT's tickets (#542), and not about the code's", async () => {
    const troubles: unknown[] = [];
    const { lab: l } = lab(fakeRunner([], 0, [{ code: 137, tail: ['Killed'] }, { code: 1, tail: ['1 failed'] }]));
    (l as unknown as { host: TestLabHost }).host.trouble = (t) => troubles.push(t);
    await l.submit(who('a'), { kind: 'run', command: 'npm test' });
    await l.submit(who('a'), { kind: 'run', command: 'npm test' });
    expect(troubles).toEqual([{ agent: 'A', job: expect.any(String), problem: 'oom', detail: 'npm test: exit code 137' }]);
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

  it('stops a run over its memory limit as a LAB ERROR, and never lets the shared browser grow into an OOM kill (#578)', async () => {
    expect(labProblem({ code: null, tail: [], oomMb: 4200 })).toBe('oom');
    const runs: number[] = [];
    const runner = fakeRunner([], 0, [{ code: null, oomMb: 4200 }]);
    const ran = runner.run.bind(runner);
    runner.run = (o) => (runs.push(o.maxMb), ran(o));
    const { lab: l } = lab(runner);
    expect(await l.submit(who('a'), { kind: 'run', command: 'npx playwright test' })).toMatch(/: used 4200 MB, over the lab's 4096 MB limit, and was stopped after 1 s\.\nLAB ERROR \(oom\)/);
    expect(runs).toEqual([4096]);

    vi.useFakeTimers();
    const slow = fakeRunner([], -1);
    let closed = 0;
    let mb = 900;
    slow.browserMb = async () => mb;
    slow.close = async () => {
      closed++;
      slow.release();
    };
    const { lab: l2, views } = lab(slow);
    const ask = l2.submit(who('a'), shot('http://localhost:1/'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(closed).toBe(0);
    mb = LAB_BROWSER_KILL_MB + 100;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(closed).toBeGreaterThan(0);
    expect(await ask).toMatch(new RegExp(`^LAB ERROR \\(oom\\): the lab's browser used ${LAB_BROWSER_KILL_MB + 100} MB`));
    expect(views.at(-1)!.recent[0]).toMatchObject({ ok: false, summary: 'lab error: oom' });
    vi.useRealTimers();
  });

  it('shares one browser cache', () => {
    expect(browsersPath({ PLAYWRIGHT_BROWSERS_PATH: '/srv/pw' }, '/home/m', 'linux')).toBe('/srv/pw');
    expect(browsersPath({}, '/home/m', 'linux')).toBe(path.join('/home/m', '.cache', 'ms-playwright'));
    expect(browsersPath({ LOCALAPPDATA: 'C:\\L' }, 'C:\\U', 'win32')).toBe(path.join('C:\\L', 'ms-playwright'));
  });
});

describe("a finished job's kept result (#562)", () => {
  const home = (agentId: string) => ({ ...who(agentId), worktree: path.join(os.tmpdir(), `labkeep-${process.pid}-${Math.random().toString(36).slice(2)}`, agentId) });

  it('is readable through lab_result after the caller disconnected before the job ended', async () => {
    const runner = fakeRunner([], -1);
    const { lab: l } = lab(runner);
    const me = home('a');
    const call = new AbortController();
    void l.submit(me, shot('http://localhost:1/'), Date.now(), undefined, call.signal);
    await Promise.resolve();
    const id = l.view().running[0].id;
    expect(l.result(me, id)).toMatch(/is running/);
    call.abort(); // the MCP client gave up after 300 s of silence
    runner.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(l.view().running).toHaveLength(0);
    expect(l.result(me, id)).toContain(`Lab job ${id}: screenshot localhost:1/ × 3, ended 0 min ago (passed: 3 shots, 0 errors).\n3 screenshots`);
    const kept = JSON.parse(fs.readFileSync(path.join(me.worktree, '.lab', id, 'result.json'), 'utf8'));
    expect(kept).toMatchObject({ id, callerGone: true, ok: true, artifacts: [path.join(me.worktree, '.lab', id, '375.png'), expect.any(String), expect.any(String)] });
    expect(fs.readFileSync(path.join(me.worktree, '.lab', '.gitignore'), 'utf8')).toBe('*\n');
    expect(l.status('a', me.worktree)).toMatch(new RegExp(`Your finished jobs.*\n {2}${id}: screenshot localhost:1/ × 3, passed`));
    expect(() => l.result(home('b'), id)).toThrow(/No result for lab job/); // another agent's worktree has none
  });

  it("answers a retry of the same request after a cut-off call with the kept result, once, instead of running it again", async () => {
    const log: string[] = [];
    const { lab: l } = lab(fakeRunner(log));
    const me = home('a');
    const call = new AbortController();
    call.abort();
    await l.submit(me, { kind: 'run', command: 'npm test' }, Date.now(), undefined, call.signal);
    const again = await l.submit(me, { kind: 'run', command: 'npm test' });
    expect(again).toMatch(/^Your earlier call was cut off; this is its job's result, not run again/);
    expect(again).toMatch(/npm test: exit code 1/);
    expect(log).toHaveLength(1);
    await l.submit(me, { kind: 'run', command: 'npm test' }); // asked again: runs afresh
    await l.submit(me, { kind: 'run', command: 'npm run build' }); // another request never reuses
    expect(log).toHaveLength(3);
    // Not after 30 minutes, and not when the first answer was delivered.
    await l.submit(me, { kind: 'run', command: 'npm run lint' }, Date.now(), undefined, call.signal);
    await l.submit(me, { kind: 'run', command: 'npm run lint' }, Date.now() + 31 * 60_000);
    expect(log).toHaveLength(5);
  });

  it('joins a retry to the same job while it still runs for a caller that is gone', async () => {
    const runner = fakeRunner([], -1);
    const { lab: l } = lab(runner);
    const me = home('a');
    const call = new AbortController();
    void l.submit(me, shot('http://localhost:1/'), Date.now(), undefined, call.signal);
    call.abort();
    const again = l.submit(me, shot('http://localhost:1/'));
    expect(l.view().running.length + l.view().queue.length).toBe(1);
    await Promise.resolve();
    runner.release();
    expect(await again).toMatch(/^3 screenshots/);
  });

  it('keeps a day of results, the newest 20, and leaves other folders alone', () => {
    const now = 100 * 3600_000;
    const rs = Array.from({ length: 23 }, (_, i) => ({ id: `j${i}`, endedAt: now - i * 60_000 }));
    expect(expiredResults([...rs, { id: 'old', endedAt: now - 25 * 3600_000 }], now)).toEqual(['j20', 'j21', 'j22', 'old']);
    const wt = home('a').worktree;
    fs.mkdirSync(path.join(wt, '.lab', 'notours'), { recursive: true });
    const base = { kind: 'run' as const, title: 't', key: 'k', ok: true, summary: 's', report: 'r', artifacts: [], queuedAt: 0, startedAt: 0, callerGone: false };
    for (const r of rs) saveResult(wt, { ...base, ...r }, [], now);
    expect(fs.readdirSync(path.join(wt, '.lab')).sort()).toEqual(['.gitignore', 'notours', ...rs.slice(0, 20).map((r) => r.id)].sort());
  });

  it('treats the same arguments in any order as the same request', () => {
    expect(requestKey({ kind: 'run', command: 'npm test', branch: undefined })).toBe(requestKey({ command: 'npm test', kind: 'run' }));
    expect(requestKey({ kind: 'run', command: 'npm test' })).not.toBe(requestKey({ kind: 'run', command: 'npm run build' }));
  });
});

describe('the lab tools', () => {
  it('validate their input and answer in plain text', async () => {
    const asked: unknown[] = [];
    const tools = createLabTools({ submit: async (i) => (asked.push(i), 'ok'), status: () => 'Lab: 0 running, 0 waiting', result: (id) => `job ${id}` });
    expect(await tools.call('lab_status', {})).toBe('Lab: 0 running, 0 waiting');
    expect(await tools.call('lab_result', { job_id: 'mw1' })).toBe('job mw1');
    for (const d of tools.defs.filter((x) => x.name !== 'lab_status' && x.name !== 'lab_result')) expect(d.description).toMatch(/cut off.*lab_result.*instead of asking again/);
    expect(await tools.call('lab_screenshot', { url: 'http://localhost:5678/', viewports: [390, 1280], theme: 'dark' })).toBe('ok');
    expect(asked[0]).toEqual({ kind: 'screenshot', url: 'http://localhost:5678/', preview: undefined, viewports: [390, 1280], profile: 'desktop', theme: 'dark', graphics: undefined, waitFor: undefined, actions: [], fullPage: false });
    expect(await tools.call('lab_run', { command: 'npm test' })).toBe('ok');
    const refused = createLabTools({ submit: () => Promise.reject(new Error('the queue is full')), status: () => '', result: () => '' });
    expect(await refused.call('lab_run', { command: 'npm test' })).toBe('Refused: the queue is full');
    const signals: (AbortSignal | undefined)[] = [];
    const call = new AbortController();
    const bound = createLabTools({ submit: async (_i, _p, signal) => (signals.push(signal), 'ok'), status: () => '', result: () => '' });
    await bound.defs.find((d) => d.name === 'lab_run')!.handler({ command: 'npm test' } as never, { signal: call.signal } as never);
    expect(signals).toEqual([call.signal]); // the call's own, so the lab knows when its caller is gone (#562)
  });
});

describe('the demo lab', () => {
  it('draws real PNGs for its fake screenshots', async () => {
    expect(fakeShot(4, 3, false).subarray(1, 4).toString()).toBe('PNG');
    const out = path.join(os.tmpdir(), `demolab-${process.pid}`, '.lab', 'j1');
    const r = await demoLabRunner().screenshot({ url: 'http://x/', profile: 'desktop', theme: 'light', graphics: 'lab', outDir: out, viewports: [390], actions: [], fullPage: false });
    expect(r.shots[0].file).toBe(path.join(out, 'desktop-390-light.png'));
  });
});

describe('settings and prompts', () => {
  it('keeps valid settings and clamps counts', () => {
    expect(testLabSettings(DEFAULT_TEST_LAB, { enabled: false, browserJobs: 9, heavyJobs: 'x' })).toEqual({ enabled: false, browserJobs: 4, heavyJobs: 1, totalJobs: 1 });
    expect(testLabSettings(DEFAULT_TEST_LAB, { totalJobs: 3 }).totalJobs).toBe(3);
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
