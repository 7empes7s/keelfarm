import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { HALF_D, MANAGER_DESK } from '../client/src/world/layout';
import { enterOffice, expect, startAt, test, type SavedView } from './helpers';

// The design system's layout rules (docs/design.md), checked per screen, width and colour scheme: nothing wider than the
// viewport, every button on screen, unobstructed and at least 44px, no destructive action one tap away, and axe clean.
// Each screen in SCREENS opens its dialog (or page) and names the views to walk through.

/** A tab, by its accessible name (a regex source; '' is the screen as it opened), or a named step that gets there. */
type View = string | { name: string; go: (root: Locator) => Promise<void> };

interface Screen {
  name: string;
  widths: number[];
  /** Opens the screen; returns its dialog. */
  open: (page: Page) => Promise<Locator>;
  /** The views to visit, or [] for a screen with one. */
  tabs: View[];
}

const AT_DESK: SavedView = { floor: 0, x: MANAGER_DESK.x, z: MANAGER_DESK.z + MANAGER_DESK.d / 2 + 0.8, yaw: 0, pitch: -0.6 };
const ON_FLOOR_1: SavedView = { floor: 1, x: 0, z: 0, yaw: 0, pitch: 0 }; // the phone's Kanban shortcut is for this floor
const AT_ELEVATOR: SavedView = { floor: 0, x: 0, z: HALF_D - 1.6, yaw: Math.PI, pitch: 0 };
const dialog = (page: Page, name: RegExp) => page.getByRole('dialog', { name });
const PHONES = [360, 390, 430, 1280];
// The 3D office boots WebGL: two widths are enough there; pocket mode is what phones get, and it's checked at all four.
const OFFICE = [390, 1280];

/** Pocket mode on one of its tabs; the page is the screen. */
async function pocket(page: Page, tab: string) {
  await page.goto(`/?pocket=1&tab=${tab}`);
  const root = page.locator('.pocket');
  await expect(root.locator('.pk-tab-on')).toBeVisible();
  return root;
}

/** Inside the 3D office, past the tour, standing at `spot`. */
async function office(page: Page, spot: SavedView = AT_DESK) {
  await startAt(page, spot);
  await page.goto('/?pocket=0');
  await enterOffice(page, { loaded: true });
  const skipTour = page.getByRole('button', { name: 'Skip tour' }); // a fresh office starts the tour
  if (await skipTour.isVisible()) await skipTour.dispatchEvent('click'); // the canvas would take a real click
}

/** The phone's Company tab, then one of its panel shortcuts. */
async function fromPhone(page: Page, button: RegExp, name: RegExp, spot?: SavedView) {
  await office(page, spot);
  await page.keyboard.press('p');
  const phone = dialog(page, /Your phone/);
  await phone.getByRole('tab', { name: 'Company' }).click();
  await phone.getByRole('button', { name: button }).click();
  return dialog(page, name);
}

/** A game from the phone's Games tab (tapping Games again goes back to the list). */
const game = (name: string): View => ({
  name,
  go: async (root) => {
    await root.getByRole('tab', { name: 'Games' }).click();
    await root.getByRole('button', { name: new RegExp(name) }).click();
  },
});

const SCREENS: Screen[] = [
  {
    name: 'pocket console',
    widths: [360, 390, 430, 1280],
    open: async (page) => {
      await page.request.put('/api/notify/telegram', { data: { token: `123456:${'A'.repeat(35)}` } }); // shows Telegram's settings (demo bot)
      await page.goto('/?pocket=1');
      await page.getByRole('button', { name: 'Settings and notifications' }).click();
      return dialog(page, /Settings/);
    },
    tabs: ['Floors', 'CEO', 'Team', 'Office', 'Tools & skills', 'Mission control', 'This device'],
  },
  {
    name: "manager's console",
    widths: OFFICE,
    open: async (page) => {
      await office(page);
      await page.keyboard.press('e');
      return dialog(page, /Manager's console/);
    },
    tabs: ['Floors', 'Mission control', 'CEO', 'Team', 'Issues', 'Settings', 'Tools & skills', 'Time-lapse', 'Accessibility'],
  },
  { name: 'pocket company', widths: PHONES, open: (page) => pocket(page, 'company'), tabs: [] },
  { name: 'pocket chat', widths: PHONES, open: (page) => pocket(page, 'chat'), tabs: [] },
  { name: 'pocket kanban', widths: PHONES, open: (page) => pocket(page, 'kanban'), tabs: [] },
  { name: 'pocket team', widths: PHONES, open: (page) => pocket(page, 'team'), tabs: [] },
  { name: 'pocket approvals', widths: PHONES, open: (page) => pocket(page, 'approvals'), tabs: [] },
  {
    name: 'terminal view',
    widths: PHONES,
    open: async (page) => {
      const root = await pocket(page, 'team');
      await root.getByRole('button', { name: 'Terminal', exact: true }).first().click();
      return page.getByRole('dialog');
    },
    tabs: [],
  },
  {
    name: 'app viewer',
    widths: PHONES,
    open: async (page) => {
      const root = await pocket(page, 'kanban');
      await root.getByTitle("Open this floor's running app").click();
      return page.getByRole('dialog');
    },
    tabs: [],
  },
  {
    name: 'start screen',
    widths: OFFICE,
    open: async (page) => {
      await page.goto('/?pocket=0');
      const root = page.locator('.start');
      await expect(root.getByRole('button', { name: 'Enter the office' })).toBeEnabled();
      return root;
    },
    tabs: [],
  },
  {
    name: 'phone',
    widths: OFFICE,
    open: async (page) => {
      await office(page);
      await page.keyboard.press('p');
      return dialog(page, /Your phone/);
    },
    tabs: ['', 'Team', 'Company', 'Games', game('Cubetris'), game('Cable Snake'), game('Desk Pet')],
  },
  {
    name: 'HUD',
    widths: OFFICE,
    open: async (page) => {
      await office(page);
      return page.locator('.hud');
    },
    tabs: [],
  },
  { name: 'kanban', widths: OFFICE, open: (page) => fromPhone(page, /Kanban/, /GitHub/, ON_FLOOR_1), tabs: [] },
  { name: 'floor list', widths: OFFICE, open: (page) => fromPhone(page, /Floor list/, /Floor|Lobby/), tabs: [] },
  { name: 'help', widths: OFFICE, open: (page) => fromPhone(page, /Help/, /How the office works/), tabs: ['The office', 'Controls'] },
  {
    name: 'catalogue',
    widths: OFFICE,
    open: async (page) => {
      await office(page);
      await page.getByTitle(/^Coins:/).dispatchEvent('click'); // a real click waits for the pill to be "stable", which it never is here
      return dialog(page, /catalogue/i);
    },
    tabs: [],
  },
  {
    name: 'elevator',
    widths: OFFICE,
    open: async (page) => {
      await office(page, AT_ELEVATOR);
      await page.keyboard.press('e');
      return dialog(page, /Elevator/);
    },
    tabs: [],
  },
];

/** Labels starting with an action that's hard to undo ("Remove Telegram"): outside a ⋯ menu they mean one tap does it. */
const DANGER = /^\W*(let .+ go|disconnect|close\b|clear desk|clear saved clips|remove\b|delete\b).*$/i;

/** Problems in what the dialog shows now; empty when it follows the rules. */
async function layoutProblems(root: Locator): Promise<string[]> {
  const problems = await root.evaluate((el, danger) => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    const name = (b: Element) => (b.getAttribute('aria-label') || (b as HTMLElement).innerText || b.getAttribute('title') || b.tagName).trim().slice(0, 40);
    // Wider than the viewport, unless it's inside a box that scrolls sideways on purpose (the tab strip, a data table).
    const scroller = (x: Element) => {
      for (let p = x.parentElement; p && p !== el; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
      return false;
    };
    for (const x of el.querySelectorAll('*')) {
      const r = x.getBoundingClientRect();
      if (r.width > vw + 1 && !scroller(x)) out.push(`${x.tagName.toLowerCase()}.${x.className} is ${Math.round(r.width)}px wide`);
    }
    const re = new RegExp(danger, 'i');
    for (const b of el.querySelectorAll<HTMLElement>('button')) {
      if (!b.checkVisibility({ visibilityProperty: true })) continue;
      if (b.closest('[role="menu"]')) continue;
      if (re.test(b.innerText) && !b.hasAttribute('data-decision')) out.push(`"${name(b)}" is a destructive action one tap away`);
    }
    return out;
  }, DANGER.source);

  // Each button scrolled into view in turn, then measured and hit-tested where it landed: one round trip for all.
  problems.push(
    ...(await root.evaluate((el) => {
      const out: string[] = [];
      for (const x of el.querySelectorAll<HTMLElement>('button')) {
        if (!x.checkVisibility({ visibilityProperty: true }) || x.closest('[role="menu"]')) continue; // closed <details> too
        x.scrollIntoView({ block: 'center', inline: 'nearest' }); // the centre, clear of sticky headers
        const box = x.getBoundingClientRect();
        const name = (x.getAttribute('aria-label') || x.innerText || x.getAttribute('title') || `button.${x.className} in .${x.parentElement?.className}`).trim().slice(0, 60);
        const vw = document.documentElement.clientWidth;
        if (box.left < -1 || box.right > vw + 1 || box.top < -1 || box.bottom > innerHeight + 1) out.push(`"${name}" can't be scrolled fully into the viewport (${Math.round(box.left)},${Math.round(box.top)}–${Math.round(box.right)},${Math.round(box.bottom)} of ${vw}x${innerHeight})`);
        else {
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          if (!hit || (hit !== x && !x.contains(hit))) out.push(`"${name}" is covered by ${hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : 'nothing'}`);
        }
        if (box.width < 43.5 || box.height < 43.5) out.push(`"${name}" is ${Math.round(box.width)}x${Math.round(box.height)}px, under 44x44`);
      }
      return out;
    })),
  );
  return problems;
}

/** The first ⋯ menu on the tab: it opens inside the viewport, danger items come last, and Esc closes only the menu. */
async function menuProblems(page: Page, root: Locator): Promise<string[]> {
  const trigger = root.locator('button[aria-haspopup="menu"]:visible').first();
  if (!(await trigger.count())) return [];
  const out: string[] = [];
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  for (const item of await menu.getByRole('menuitem').all()) {
    const box = (await item.boundingBox())!;
    const vw = page.viewportSize()!;
    if (box.x < -1 || box.x + box.width > vw.width + 1 || box.y < -1 || box.y + box.height > vw.height + 1) out.push(`menu item "${await item.innerText()}" is outside the viewport`);
    if (box.height < 43.5) out.push(`menu item "${await item.innerText()}" is ${Math.round(box.height)}px tall`);
  }
  const order = await menu.evaluate((m) => [...m.querySelectorAll('[role="menuitem"]:not(.ds-menu-cancel), [role="separator"]')].filter((x) => x.getClientRects().length).map((x) => (x.getAttribute('role') === 'separator' ? 'sep' : x.hasAttribute('data-danger') ? 'danger' : 'safe')));
  const firstDanger = order.indexOf('danger');
  if (firstDanger > 0 && order.slice(0, firstDanger).includes('safe') && order[firstDanger - 1] !== 'sep') out.push('the danger section has no separator');
  if (order.slice(firstDanger < 0 ? order.length : firstDanger).includes('safe')) out.push('a safe item follows the danger section');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(root).toBeVisible(); // Esc closed the menu, not the panel
  return out;
}

async function axeProblems(page: Page, root: Locator): Promise<string[]> {
  await root.evaluate((el) => el.setAttribute('data-layout-under-test', ''));
  const { violations } = await new AxeBuilder({ page }).include('[data-layout-under-test]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  // LAYOUT_DEBUG=1 lists every failing node with axe's reason (the colours and ratio for contrast).
  if (process.env.LAYOUT_DEBUG) return violations.flatMap((v) => v.nodes.map((n) => `axe ${v.id}: ${n.target.join(' ')} ${n.any[0]?.message ?? ''}`));
  return violations.map((v) => `axe ${v.id}: ${v.help} (${v.nodes.length}× e.g. ${v.nodes[0]?.target.join(' ')})`);
}

for (const screen of SCREENS) {
  for (const width of screen.widths) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${screen.name} at ${width}px, ${scheme}`, async ({ page }) => {
        test.setTimeout(300_000); // every tab of a screen, on software rendering
        await page.setViewportSize({ width, height: width < 800 ? 844 : 800 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        // Toasts come and go on their own (the demo's agents keep finishing work): they aren't part of the layout.
        await page.addInitScript(() =>
          document.addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: '.toasts { display: none !important; }' }))),
        );
        const root = await screen.open(page);
        await expect(root).toBeVisible();
        const problems: string[] = [];
        for (const tab of screen.tabs.length ? screen.tabs : ['']) {
          if (typeof tab !== 'string') await tab.go(root);
          else if (tab) {
            const t = root.getByRole('tab', { name: new RegExp(tab) });
            await t.scrollIntoViewIfNeeded();
            await t.click();
            await expect(t).toHaveAttribute('aria-selected', 'true');
          }
          if (tab) await page.waitForTimeout(300); // lazy tabs and settled layout
          const name = typeof tab === 'string' ? tab : tab.name;
          const at = name ? `${name}: ` : '';
          for (const p of [...(await layoutProblems(root)), ...(await menuProblems(page, root)), ...(await axeProblems(page, root))]) problems.push(at + p);
        }
        expect(problems).toEqual([]);
      });
    }
  }
}
