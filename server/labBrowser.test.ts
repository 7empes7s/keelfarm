// The lighter QA browser (#301): the same checks for less memory. Launch flags, the restart rule, the full-quality pass
// running alone, the browser's process tree in the health accounting, and the QA line for a PR that changes 3D code.
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEST_LAB } from '../shared/testLab.ts';
import { heldNote } from '../shared/health.ts';
import { demoPrDiff } from './demoReads.ts';
import { admission, browserTreeMb } from './health.ts';
import { fullQualityLine, needsFullQualityPass } from './qaPrompt.ts';
import { LAB_BROWSER_MAX_MB, labInitScript, labLaunchArgs, pickNext, restartBrowser, TestLab, type LabRunner, type Requester } from './testLab.ts';
import { createLabTools } from './testLabTools.ts';

describe("the lab browser's flags and restarts", () => {
  it('runs fewer processes: two renderers at most, GPU and network in the browser, no zygotes; keeps the /dev/shm fix', () => {
    const args = labLaunchArgs();
    expect(args).toEqual(['--disable-dev-shm-usage', '--renderer-process-limit=2', '--in-process-gpu', '--no-zygote', '--enable-features=CDPScreenshotNewSurface,NetworkServiceInProcess2']);
    // Playwright's own --enable-features would be replaced by ours (the last one counts): its feature stays on.
    expect(args.find((a) => a.startsWith('--enable-features='))).toContain('CDPScreenshotNewSurface');
  });

  it('restarts after a full-quality pass, and once the browser outgrows the limit, never under another job', () => {
    expect(LAB_BROWSER_MAX_MB).toBe(1200);
    expect(restartBrowser({ full: true, rssMb: null, busy: false })).toBe(true);
    expect(restartBrowser({ full: false, rssMb: 1300, busy: false })).toBe(true);
    expect(restartBrowser({ full: false, rssMb: 700, busy: false })).toBe(false);
    expect(restartBrowser({ full: false, rssMb: null, busy: false })).toBe(false);
    expect(restartBrowser({ full: false, rssMb: 1300, busy: true })).toBe(false);
  });

  it('flags pages for the light profile, and gives a desktop full pass the High preset', () => {
    expect(labInitScript('lab', 'phone')).toBe('window.__swarmLabGfx = true;');
    expect(labInitScript('full', 'desktop')).toContain("'cubefarm:graphics', 'high'");
    expect(labInitScript('full', 'iphone')).toBe(''); // a phone's real settings are Auto, capped by its profile
  });
});

describe('a full-quality pass runs alone (#301)', () => {
  const job = (id: string, kind: 'screenshot' | 'run', queuedAt: number, alone = false) => ({ id, kind, repoId: id, queuedAt, alone });
  const limits = { browser: 1, heavy: 1 };

  it('waits for the lab to empty, holding back new work meanwhile, then goes first', () => {
    const full = job('full', 'screenshot', 5, true);
    const later = job('b', 'screenshot', 9);
    expect(pickNext([full, later], [job('run', 'run', 1)], limits, new Map())).toEqual([]);
    expect(pickNext([later, full], [], limits, new Map())).toEqual([full]);
  });

  it('lets nothing else start while it runs', () => {
    expect(pickNext([job('b', 'screenshot', 2), job('r', 'run', 3)], [job('full', 'screenshot', 1, true)], limits, new Map())).toEqual([]);
  });

  it('restarts the browser after it, and passes graphics through to the runner', async () => {
    const log: string[] = [];
    const runner: LabRunner = {
      browserUp: () => true,
      async screenshot(o) {
        log.push(`shot ${o.graphics}`);
        return { shots: [{ label: 'desktop-1280-light-full', file: path.join(o.outDir, 'a.png') }], consoleErrors: [], pageErrors: [], failedRequests: [] };
      },
      check: async () => ({ steps: [], consoleErrors: [], pageErrors: [], failedRequests: [] }),
      checkout: async () => '',
      run: async () => ({ code: 0, ms: 0, timedOut: false, tail: [], artifacts: [] }),
      installBrowser: async () => true,
      warm: async () => true,
      browserMb: async () => (log.push('measured'), 300),
      close: async () => void log.push('restart'),
    };
    const lab = new TestLab({ runner: () => runner, settings: () => DEFAULT_TEST_LAB, refusal: () => null, forbidden: () => [], previewUrl: async () => 'http://x/', shot: () => undefined, emit: () => undefined });
    const who: Requester = { agentId: 'q', agent: 'Q', repoId: 'r', floor: 1, fullName: 'o/r', defaultBranch: 'main', worktree: path.join(os.tmpdir(), 'labdesk', 'q'), pr: 3, labCommands: [] };
    const base = { kind: 'screenshot' as const, url: 'http://localhost:5660/', viewports: [1280], profile: 'desktop' as const, theme: 'light' as const, actions: [], fullPage: false };
    const light = await lab.submit(who, base);
    expect(light).toContain('Lab graphics profile');
    const full = await lab.submit(who, { ...base, graphics: 'full' });
    expect(full).toContain('Full-quality pass');
    expect(log).toEqual(['shot lab', 'measured', 'shot full', 'restart']);
  });

  it("is a lab tool option, light by default", async () => {
    const asked: unknown[] = [];
    const tools = createLabTools({ submit: async (i) => (asked.push(i), 'ok'), status: () => '' });
    await tools.call('lab_screenshot', { url: 'http://localhost:1/', graphics: 'full' });
    await tools.call('lab_browser_check', { url: 'http://localhost:1/', steps: [{ do: 'no_console_errors' }] });
    expect(asked.map((a) => (a as { graphics?: string }).graphics)).toEqual(['full', undefined]);
  });
});

describe("the lab browser's memory in the health accounting (#301)", () => {
  const proc = (pid: number, ppid: number, rssMb: number, cmd = '') => ({ pid, ppid, rssMb, cmd });

  it("sums the office's Playwright browser and every process under it, nothing else", () => {
    const procs = [
      proc(10, 1, 300, 'node server/index.ts'),
      proc(20, 10, 200, '/opt/google/chrome/chrome --headless --remote-debugging-pipe --renderer-process-limit=2'),
      proc(21, 20, 1600, '/opt/google/chrome/chrome --type=renderer'),
      proc(22, 21, 260, '/opt/google/chrome/chrome --type=utility'),
      proc(30, 10, 500, 'npm run build'),
      proc(31, 30, 900, 'chrome --remote-debugging-pipe'), // an e2e run's own browser, not the lab's
    ];
    expect(browserTreeMb(procs, 10)).toBe(2060);
    expect(browserTreeMb(procs.filter((p) => p.pid < 20 || p.pid >= 30), 10)).toBeNull();
  });

  it('names the test browser in the waiting-for-memory reason and note', () => {
    const memory = { availableMb: 1000, totalMb: 7745, swapFreeMb: 0, swapTotalMb: 0, load: 1, cpus: 4, at: 0 };
    const why = admission({ kind: 'build', memory, estimateMb: 1536, headroomMb: 1536, reservedMb: 0, browserMb: 2560 });
    expect(why).toContain("Of what's used, the test browser is using 2.5 GB.");
    expect(admission({ kind: 'build', memory, estimateMb: 1536, headroomMb: 1536, reservedMb: 0, browserMb: null })).not.toContain('test browser');
    expect(heldNote({ tasks: 2, freeMb: 1000, needMb: 3072, browserMb: 2560 })).toBe('⏳ 2 tasks waiting for memory · 1.0 GB free, 3.0 GB needed · the test browser is using 2.5 GB');
    expect(heldNote({ tasks: 1, freeMb: 1000, needMb: 3072, browserMb: 40 })).toBe('⏳ 1 task waiting for memory · 1.0 GB free, 3.0 GB needed');
  });
});

describe('a PR that changes 3D code needs a full-quality pass (#301)', () => {
  it('goes by the changed files', () => {
    expect(needsFullQualityPass(['client/src/world/sky/DayLights.tsx'])).toBe(true);
    expect(needsFullQualityPass(['server/swarm.ts', 'client/src/world/materials.ts'])).toBe(true);
    expect(needsFullQualityPass(['client/src/ui/HUD.tsx'])).toBe(true);
    expect(needsFullQualityPass(['client/src\\world\\Desk.tsx'])).toBe(true); // Windows separators
    expect(needsFullQualityPass(['client/src/ui/Kanban.tsx', 'server/testLab.ts', 'docs/design.md'])).toBe(false);
  });

  it("puts the line in QA's instructions only when the lab is used and the PR is 3D", () => {
    expect(fullQualityLine(['client/src/world/Desk.tsx'], true)).toMatch(/graphics: "full".*without that pass the verdict is fail/);
    expect(fullQualityLine(['client/src/world/Desk.tsx'], false)).toBe('');
    expect(fullQualityLine(['server/swarm.ts'], true)).toBe('');
    expect(fullQualityLine(null, true)).toBe('');
  });

  it("shows in the demo: a visual feature's PR changes 3D code, others don't", () => {
    const files = (title: string) => demoPrDiff({ title, additions: 40, deletions: 4 }, false).files.map((f) => f.path);
    expect(needsFullQualityPass(files('Empty state illustration'))).toBe(true);
    expect(needsFullQualityPass(files('Keyboard shortcuts'))).toBe(false);
  });
});
