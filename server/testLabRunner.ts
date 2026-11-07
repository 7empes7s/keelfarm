// The test lab's runner (#56): one long-lived headless browser (Playwright, from the Playwright MCP the office already
// pins, driving the installed Google Chrome) with a fresh context per request, and heavy commands in the floor's lab
// checkout (a desk of its own, never an agent's worktree or the office's folder). server/testLab.ts queues the jobs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { hasChrome } from './browser.ts';
import { endGroup, installDesk, killTree } from './deps.ts';
import { LAB_PREVIEW_PORT } from './portLanes.ts';
import { git } from './exec.ts';
import { prepareDesk } from './workspace.ts';
import { BROWSER_INSTALL_MIN_MB, browsersPath, labFile, labUrl, type BrowserOpts, type CheckResult, type LabAction, type LabRunner, type LabStep, type PageIssues, type RunResult } from './testLab.ts';
import type { LabProfile } from '../shared/testLab.ts';

/** The floor desk the lab's heavy commands run in (kept by the desk sweep). */
export const LAB_SLUG = 'testlab';
const LAB_BRANCH = 'testlab/checkout';
const STEP_MS = 10_000;
const SETTLE_MS = 5_000;
const TAIL = 200;
/** Report folders a run's artifacts are listed from. */
const ARTIFACT_DIRS = ['test-results', 'playwright-report', 'coverage'];

// Just what the lab uses of Playwright: the package comes in through @playwright/mcp, so its types aren't ours to import.
interface PwLocator {
  first(): PwLocator;
  waitFor(o: { state: 'visible'; timeout: number }): Promise<void>;
  textContent(o: { timeout: number }): Promise<string | null>;
}
interface PwPage {
  on(ev: 'console', fn: (m: { type(): string; text(): string }) => void): void;
  on(ev: 'pageerror', fn: (e: Error) => void): void;
  on(ev: 'requestfailed', fn: (r: { method(): string; url(): string; failure(): { errorText: string } | null }) => void): void;
  goto(url: string, o: { timeout: number; waitUntil: 'load' }): Promise<unknown>;
  waitForLoadState(state: 'networkidle', o: { timeout: number }): Promise<void>;
  click(sel: string, o: { timeout: number }): Promise<void>;
  fill(sel: string, text: string, o: { timeout: number }): Promise<void>;
  waitForSelector(sel: string, o: { timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  locator(sel: string): PwLocator;
  getByText(text: string): PwLocator;
  evaluate(expression: string): Promise<unknown>;
  addScriptTag(o: { path: string }): Promise<unknown>;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  mouse: { wheel(x: number, y: number): Promise<void> };
}
interface PwContext {
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}
interface PwBrowser {
  newContext(o: Record<string, unknown>): Promise<PwContext>;
  on(ev: 'disconnected', fn: () => void): void;
  close(): Promise<void>;
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** A browser context for a profile at a width: desktop, an Android phone, or an iPhone (Chromium emulating it). */
function contextOptions(profile: LabProfile, width: number, theme: 'light' | 'dark'): Record<string, unknown> {
  const w = Math.max(240, Math.min(3840, Math.round(width)));
  if (profile === 'desktop') return { viewport: { width: w, height: 800 }, colorScheme: theme };
  const mobile = { viewport: { width: w, height: Math.round(w * 2.16) }, isMobile: true, hasTouch: true, colorScheme: theme };
  return profile === 'iphone' ? { ...mobile, deviceScaleFactor: 3, userAgent: IPHONE_UA } : { ...mobile, deviceScaleFactor: 2.625 };
}

function chromium(): { launch(o: Record<string, unknown>): Promise<PwBrowser> } {
  const req = createRequire(createRequire(import.meta.url).resolve('@playwright/mcp/package.json'));
  return (req('playwright-core') as { chromium: { launch(o: Record<string, unknown>): Promise<PwBrowser> } }).chromium;
}

/** Every lab process (and the start-up install) uses one browser cache. */
const BROWSERS = browsersPath(process.env, os.homedir(), process.platform);

/**
 * Installs Playwright's Chromium into the shared cache with the Playwright at `cli` (argv before `install chromium`),
 * niced, and only when memory allows; resolves whether it worked. Already installed is a quick no-op.
 */
function installChromium(cwd: string, cli: string[]): Promise<boolean> {
  if (os.freemem() / (1024 * 1024) < BROWSER_INSTALL_MIN_MB) return Promise.resolve(false);
  const argv = [...cli, 'install', 'chromium'];
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS };
  const child =
    process.platform === 'win32'
      ? path.isAbsolute(argv[0])
        ? spawn(argv[0], argv.slice(1), { cwd, env, windowsHide: true, stdio: 'ignore' })
        : spawn('cmd.exe', ['/d', '/s', '/c', argv.join(' ')], { cwd, env, windowsHide: true, stdio: 'ignore' }) // npx is a .cmd shim
      : spawn('nice', ['-n', '19', ...argv], { cwd, env, windowsHide: true, detached: true, stdio: 'ignore' });
  return new Promise((resolve) => {
    const timer = setTimeout(() => void killTree(child), 15 * 60_000);
    child.once('error', () => resolve(false));
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/** playwright-core's CLI: its package.json is exported, cli.js isn't, so it's found beside the package.json. */
export function playwrightCli(resolve: (id: string) => string = createRequire(createRequire(import.meta.url).resolve('@playwright/mcp/package.json')).resolve): string {
  return path.join(path.dirname(resolve('playwright-core/package.json')), 'cli.js');
}

/** At office start: the browser floors' Playwright suites need, installed once per machine so no session has to. Never throws. */
async function warmLabBrowser(): Promise<boolean> {
  try {
    return await installChromium(os.tmpdir(), [process.execPath, playwrightCli()]);
  } catch {
    return false;
  }
}

const clean = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, ''); // eslint-disable-line no-control-regex

export function createLabRunner(): LabRunner {
  let browser: Promise<PwBrowser> | null = null;
  let up = false;

  const shared = () => {
    browser ??= chromium()
      .launch({ headless: true, ...(hasChrome() ? { channel: 'chrome' } : {}), args: ['--disable-dev-shm-usage'] })
      .then((b) => {
        up = true;
        b.on('disconnected', () => {
          up = false;
          browser = null;
        });
        return b;
      })
      .catch((err: Error) => {
        browser = null;
        throw new Error(`The lab's browser could not start: ${err.message.split('\n')[0]}. Install Google Chrome, or run npx cubefarm doctor.`);
      });
    return browser;
  };

  /** A fresh context and page; what goes wrong on the page is collected into `issues`. */
  async function withPage<T>(o: BrowserOpts, width: number, issues: PageIssues, fn: (page: PwPage) => Promise<T>): Promise<T> {
    const ctx = await (await shared()).newContext(contextOptions(o.profile, width, o.theme));
    try {
      const page = await ctx.newPage();
      const add = (list: string[], x: string) => void (list.includes(x) || list.length >= 50 || list.push(x));
      page.on('console', (m) => m.type() === 'error' && add(issues.consoleErrors, m.text()));
      page.on('pageerror', (e) => add(issues.pageErrors, e.message));
      page.on('requestfailed', (r) => add(issues.failedRequests, `${r.method()} ${r.url()}: ${r.failure()?.errorText ?? 'failed'}`));
      await page.goto(o.url, { timeout: 30_000, waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined); // an app still loading its scripts
      return await fn(page);
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }

  async function act(page: PwPage, a: LabAction) {
    if (a.do === 'click') await page.click(a.selector ?? 'body', { timeout: STEP_MS });
    else if (a.do === 'type') await (a.selector ? page.fill(a.selector, a.text ?? '', { timeout: STEP_MS }) : page.keyboard.type(a.text ?? ''));
    else if (a.do === 'press') await page.keyboard.press(a.text ?? 'Enter');
    else if (a.do === 'scroll') await page.mouse.wheel(0, a.y ?? 600);
    else if (a.selector) await page.waitForSelector(a.selector, { timeout: STEP_MS });
    else await page.waitForTimeout(Math.min(a.ms ?? 500, STEP_MS));
  }

  /** One check step: null when it passed, else why not. */
  async function step(page: PwPage, s: LabStep, base: string, issues: PageIssues): Promise<string | null> {
    switch (s.do) {
      case 'goto':
        await page.goto(labUrl(new URL(s.url ?? '/', base).toString()), { timeout: 30_000, waitUntil: 'load' });
        return null;
      case 'expect_visible':
        await page.locator(s.selector ?? 'body').first().waitFor({ state: 'visible', timeout: STEP_MS });
        return null;
      case 'expect_text': {
        if (!s.selector) {
          await page.getByText(s.text ?? '').first().waitFor({ state: 'visible', timeout: STEP_MS });
          return null;
        }
        const text = (await page.locator(s.selector).first().textContent({ timeout: STEP_MS })) ?? '';
        return text.includes(s.text ?? '') ? null : `found "${text.slice(0, 120)}"`;
      }
      case 'no_horizontal_scroll': {
        const over = Number(await page.evaluate('document.documentElement.scrollWidth - window.innerWidth'));
        return over > 1 ? `the page scrolls sideways by ${over}px` : null;
      }
      case 'no_console_errors': {
        const errs = [...issues.consoleErrors, ...issues.pageErrors];
        return errs.length ? `${errs.length} errors, first: ${errs[0].slice(0, 160)}` : null;
      }
      case 'viewport_scale': {
        const scale = Number(await page.evaluate('window.visualViewport ? window.visualViewport.scale : 1'));
        return Math.abs(scale - (s.value ?? 1)) < 0.01 ? null : `visualViewport.scale is ${scale}`;
      }
      case 'axe': {
        let axe: string;
        try {
          axe = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
        } catch {
          return "axe-core isn't installed with this office";
        }
        await page.addScriptTag({ path: axe });
        const found = (await page.evaluate(`axe.run(${JSON.stringify(s.selector ?? 'body')}, { resultTypes: ['violations'] }).then((r) => r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ' (' + v.nodes.length + ')'))`)) as string[];
        return found.length ? `serious violations: ${found.slice(0, 5).join(', ')}` : null;
      }
      default:
        await act(page, { ...s, do: s.do, y: s.y ?? s.value, ms: s.ms ?? s.value });
        return null;
    }
  }

  return {
    browserUp: () => up,

    async screenshot(o) {
      fs.mkdirSync(o.outDir, { recursive: true });
      fs.writeFileSync(path.join(o.outDir, '..', '.gitignore'), '*\n'); // .lab/ never shows up in git status
      const issues: PageIssues = { consoleErrors: [], pageErrors: [], failedRequests: [] };
      const shots: { label: string; file: string }[] = [];
      for (const width of o.viewports) {
        const label = `${o.profile}-${width}-${o.theme}`;
        const file = labFile(o.outDir, `${label}.png`);
        await withPage(o, width, issues, async (page) => {
          if (o.waitFor) await page.waitForSelector(o.waitFor, { timeout: STEP_MS });
          for (const a of o.actions) await act(page, a);
          await page.screenshot({ path: file, fullPage: o.fullPage });
        });
        shots.push({ label, file });
      }
      return { shots, ...issues };
    },

    async check(o) {
      fs.mkdirSync(o.outDir, { recursive: true });
      fs.writeFileSync(path.join(o.outDir, '..', '.gitignore'), '*\n');
      const issues: PageIssues = { consoleErrors: [], pageErrors: [], failedRequests: [] };
      const steps: CheckResult['steps'] = [];
      await withPage(o, o.viewport, issues, async (page) => {
        for (const [i, s] of o.steps.entries()) {
          const name = [s.do, s.selector, s.text ?? s.url].filter(Boolean).join(' ');
          const why = await step(page, s, o.url, issues).catch((err: Error) => err.message.split('\n')[0]);
          if (!why) {
            steps.push({ step: name, ok: true });
            continue;
          }
          const shot = labFile(o.outDir, `fail-${i + 1}.png`);
          const saved = await page.screenshot({ path: shot }).then(() => true, () => false);
          steps.push({ step: name, ok: false, detail: why, ...(saved ? { shot } : {}) });
        }
      });
      return { steps, ...issues };
    },

    async checkout(o) {
      const dir = await prepareDesk(o.fullName, { defaultBranch: o.defaultBranch }, LAB_SLUG, LAB_BRANCH);
      // The requester's committed HEAD straight from their worktree (no push needed), or a branch from GitHub.
      await git(o.branch ? ['fetch', 'origin', o.branch] : ['fetch', o.worktree, 'HEAD'], { cwd: dir, timeoutMs: 180_000 });
      await git(['checkout', '--force', '-B', LAB_BRANCH, 'FETCH_HEAD'], { cwd: dir });
      await git(['clean', '-fdx', '-e', 'node_modules'], { cwd: dir });
      const lines: string[] = [];
      const deps = await installDesk(dir, { log: (l) => lines.push(...l), installing: () => undefined });
      if (deps === 'failed') throw new Error(`Installing dependencies in the lab failed: ${lines.slice(-3).join(' ')}`);
      return dir;
    },

    run(o) {
      const started = Date.now();
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(ANTHROPIC_|CLAUDE|SWARM_)/i.test(k)) env[k] = v;
      // A demo office the run boots (an e2e suite) keeps its previews in the lab's block, off the live office's (#227).
      Object.assign(env, { CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', PLAYWRIGHT_BROWSERS_PATH: BROWSERS, SWARM_PREVIEW_PORT: String(LAB_PREVIEW_PORT) });
      const [cmd, ...args] = o.argv;
      // Arguments are plain words (testLab.ts labCommand), so joining them for cmd.exe needs no quoting.
      const child =
        process.platform === 'win32'
          ? spawn('cmd.exe', ['/d', '/s', '/c', o.argv.join(' ')], { cwd: o.dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
          : spawn(cmd.includes('/') ? path.join(o.dir, cmd) : cmd, args, { cwd: o.dir, env, windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const tail: string[] = [];
      let partial = '';
      let silent = false;
      let quiet: ReturnType<typeof setTimeout> | undefined;
      const hush = () => {
        clearTimeout(quiet);
        if (o.silenceMs === null) return;
        quiet = setTimeout(() => {
          silent = true;
          void killTree(child);
        }, o.silenceMs);
      };
      hush();
      const take = (d: Buffer) => {
        hush();
        const parts = clean(partial + d.toString()).split('\n');
        partial = parts.pop() ?? '';
        tail.push(...parts);
        if (tail.length > TAIL) tail.splice(0, tail.length - TAIL);
      };
      child.stdout?.on('data', take);
      child.stderr?.on('data', take);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        void killTree(child);
      }, o.timeoutMs);
      return new Promise<RunResult>((resolve) => {
        const end = (code: number | null) => {
          clearTimeout(timer);
          clearTimeout(quiet);
          endGroup(child);
          if (partial) tail.push(partial);
          resolve({ code, ms: Date.now() - started, tail: tail.slice(-TAIL), timedOut, silent, artifacts: artifacts(o.dir) });
        };
        child.on('error', (err) => {
          tail.push(err.message);
          end(null);
        });
        child.on('close', (code) => end(code));
      });
    },

    installBrowser: (dir) => installChromium(dir, ['npx', 'playwright']),
    warm: warmLabBrowser,

    async close() {
      const b = browser;
      browser = null;
      up = false;
      if (b) await (await b.catch(() => null))?.close().catch(() => undefined);
    },
  };
}

/** Files under the checkout's report folders, relative to it (at most 50). */
function artifacts(dir: string): string[] {
  const out: string[] = [];
  for (const d of ARTIFACT_DIRS) {
    const root = path.join(dir, d);
    const names = fs.existsSync(root) ? (fs.readdirSync(root, { recursive: true }) as string[]) : [];
    for (const n of names) if (out.length < 50 && fs.statSync(path.join(root, n)).isFile()) out.push(path.join(d, n));
  }
  return out;
}
