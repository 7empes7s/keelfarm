import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { colourStats, decodePng } from './png';
import { TOUR } from '../client/src/ui/tourSteps';

// What every e2e spec shares: the `test` that fails on console errors and failed requests, walking into the office,
// placing the player and looking at the 3D view. Specs import `test` and `expect` from here, not from Playwright.
// One spec file per feature: add a feature's tests to its own file, never to smoke.spec.ts.

export { expect };

export const VIEW_KEY = 'cubefarm:view'; // where the client remembers the player's spot (store.ts saveView)
export const TOUR_SEEN_KEY = 'cubefarm:tour-seen'; // the tour steps this device has seen (ui/tour.ts)
export const TUTORIALS_INVITE_KEY = 'cubefarm:tutorials-invite'; // "Not now" on Get started (ui/TaskTutorial.tsx)

export interface SavedView {
  floor: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

// Every test fails on a console error, an uncaught exception, or a request to the office that failed.
export const test = base.extend<{ page: Page }>({
  page: async ({ page, baseURL }, use) => {
    const problems: string[] = [];
    // Only the office itself is under test: stub anything external (the Google Fonts stylesheet) so the result
    // doesn't depend on the network.
    await page.route(
      (url) => !url.href.startsWith(baseURL!) && !url.protocol.startsWith('data'),
      (route) => route.fulfill({ status: 200, body: '' }),
    );
    // Every tour step counts as seen, so no "What's new" card sits over what a test looks at (tour.spec.ts clears it).
    await page.addInitScript(([key, ids]) => localStorage.getItem(key) === null && localStorage.setItem(key, ids), [TOUR_SEEN_KEY, JSON.stringify(TOUR.map((e) => e.id))] as const);
    // and Get started was put off, so its card doesn't either (tutorials.spec.ts clears it)
    await page.addInitScript((key) => localStorage.getItem(key) === null && localStorage.setItem(key, '1'), TUTORIALS_INVITE_KEY);
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    // a stubbed outside request (a preview's frame) cut off by the next page load isn't the office failing
    page.on('requestfailed', (r) => r.url().startsWith(baseURL!) && problems.push(`request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`));
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
    });
    await use(page);
    expect(problems, 'console errors or failed requests').toEqual([]);
  },
});

/**
 * Loads the office and walks in through the first-run flow (the setup wizard if it's up, else the start screen).
 * `loaded`: the page has the office open already, so it isn't loaded again (that would abort the lazy chunks the first
 * load is still fetching, which the fixture counts as failed requests).
 */
export async function enterOffice(page: Page, { loaded = false } = {}) {
  if (!loaded) await page.goto('/');
  const enter = page.getByRole('button', { name: 'Enter the office' });
  const skipSetup = page.getByRole('button', { name: /skip setup/i });
  await expect(enter.or(skipSetup)).toBeVisible();
  if (await skipSetup.isVisible()) await skipSetup.click();
  else {
    await expect(page.getByText(/DEMO MODE/)).toBeVisible();
    await expect(enter).toBeEnabled(); // it reads "Loading…" until the first snapshot arrives
    await enter.click();
  }
  await expect(enter).toBeHidden();
  await expect(phoneButton(page)).toBeVisible(); // the HUD only shows it once you're inside
}

export const phoneButton = (page: Page) => page.getByTitle('Your phone (P)');

/** Puts the player at `spot` when the office next loads: call it before enterOffice. */
export async function startAt(page: Page, spot: SavedView) {
  await page.addInitScript(([key, view]) => localStorage.setItem(key, view), [VIEW_KEY, JSON.stringify(spot)] as const);
}

export async function savedView(page: Page): Promise<SavedView | null> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), VIEW_KEY);
}

/**
 * The 3D view on its own: everything else on the page is hidden while it's captured. A page screenshot clipped to
 * the canvas, because an element screenshot first waits for frames in which it hasn't moved, and software WebGL
 * can take seconds per frame.
 */
export async function canvasColours(page: Page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('the canvas has no size');
  const png = await page.screenshot({ clip: box, caret: 'initial', style: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  return colourStats(decodePng(png));
}

/** Content past the right edge of the box it scrolls or clips in (#149): a finger drags such a panel sideways (the
 * panels' overflow-x: clip only stops the drag; this still finds the overflow). Only tables, code, tab strips, toolbars
 * and chip strips may scroll sideways in a box of their own. Names the box and its widest child. */
export async function overflowProblems(root: Locator): Promise<string[]> {
  return root.evaluate((el) => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    const sel = (x: Element) => x.tagName.toLowerCase() + [...x.classList].slice(0, 3).map((c) => `.${c}`).join('');
    const ownScroller = (c: Element, box: Element) => {
      for (let p = c.parentElement; p && p !== box; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true;
      return false;
    };
    const SIDEWAYS = 'table, pre, code, [role="tablist"]:not([aria-orientation="vertical"])';
    for (const x of [el, ...el.querySelectorAll('*')]) {
      if (x.scrollWidth <= x.clientWidth + 1 || x.clientWidth < 2 || !x.checkVisibility()) continue; // < 2: screen-reader text
      const css = getComputedStyle(x);
      if (css.overflowX === 'visible' || css.textOverflow === 'ellipsis' || x.matches(`input, textarea, select, canvas, .xterm *, ${SIDEWAYS}`) || x.closest('[role="toolbar"]')) continue;
      // a strip of chips that scrolls sideways and not up and down (quick replies, decisions): sideways is its job
      if ((css.overflowX === 'auto' || css.overflowX === 'scroll') && x.scrollHeight <= x.clientHeight + 1) continue;
      const edge = x.getBoundingClientRect().right - parseFloat(css.borderRightWidth);
      const past = [...x.querySelectorAll('*')].filter((c) => c.getBoundingClientRect().right > edge + 1 && c.checkVisibility() && !ownScroller(c, x));
      if (past.length && past.every((c) => c.closest(SIDEWAYS) && x.contains(c.closest(SIDEWAYS)))) continue;
      const widest = past.reduce<Element | null>((a, c) => (!a || c.getBoundingClientRect().right > a.getBoundingClientRect().right ? c : a), null);
      out.push(`${sel(x)} scrolls sideways (${x.scrollWidth} > ${x.clientWidth}px)${widest ? `: ${sel(widest)} ends ${Math.round(widest.getBoundingClientRect().right - edge)}px past it` : ''}`);
    }
    return out;
  });
}

/** A chat header tool (`name`: its button's exact name), or its ⋯ item where the header folded it (#588). */
export async function chatTool(root: Locator, name: string) {
  const button = root.getByRole('button', { name, exact: true });
  if (await button.isVisible()) return button.click();
  await root.getByRole('button', { name: /^More for the chat/ }).click();
  await root.page().getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
}

/** The chat's ⛶ (#201). */
export const fullScreenChat = (root: Locator) => chatTool(root, 'Full screen chat');
