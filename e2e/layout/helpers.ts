import AxeBuilder from '@axe-core/playwright';
import { crc32, deflateSync } from 'node:zlib';
import { devices, type Locator, type Page } from '@playwright/test';
import { HALF_D, MANAGER_DESK } from '../../client/src/world/layout';
import { GROUPS, sectionsIn, type Where } from '../../client/src/ui/consoleNavRules';
import { enterOffice, expect, type SavedView, startAt, test } from '../helpers';

// The design system's layout rules (docs/design.md), checked per screen, width and colour scheme: nothing wider than the
// viewport, every button on screen, unobstructed and at least 44px, no destructive action one tap away, and axe clean.
// Each screen in SCREENS opens its dialog (or page) and names the views to walk through.

/** A tab, by its accessible name (a regex source; '' is the screen as it opened), or a named step that gets there. */
export type View = string | { name: string; go: (root: Locator) => Promise<void> };

export interface Screen {
  name: string;
  widths: number[];
  /** Opens the screen; returns its dialog. */
  open: (page: Page) => Promise<Locator>;
  /** The views to visit, or [] for a screen with one. */
  tabs: View[];
}

const AT_DESK: SavedView = { floor: 0, x: MANAGER_DESK.x, z: MANAGER_DESK.z + MANAGER_DESK.d / 2 + 0.8, yaw: 0, pitch: -0.6 };
export const ON_FLOOR_1: SavedView = { floor: 1, x: 0, z: 0, yaw: 0, pitch: 0 }; // the phone's Kanban shortcut is for this floor
export const AT_ELEVATOR: SavedView = { floor: 0, x: 0, z: HALF_D - 1.4, yaw: Math.PI, pitch: 0.6 }; // at the frame's lintel: the doors aren't the interactable
export const dialog = (page: Page, name: RegExp) => page.getByRole('dialog', { name });
export const PHONES = [360, 390, 430, 1280];
// The 3D office boots WebGL: two widths are enough there; pocket mode is what phones get, and it's checked at all four.
export const OFFICE = [390, 1280];
// Pocket mode's own tabs also at its medium layout and a big desktop (#104).
export const POCKET = [360, 390, 430, 900, 1280, 1920];

/** Pocket mode on one of its tabs; the page is the screen. */
export async function pocket(page: Page, tab: string) {
  await page.goto(`/?pocket=1&tab=${tab}`);
  const root = page.locator('.pocket');
  await expect(root.locator('.pk-tab-on')).toBeVisible();
  return root;
}

/** Inside the 3D office, past the tour, standing at `spot`. */
export async function office(page: Page, spot: SavedView = AT_DESK) {
  await startAt(page, spot);
  await page.goto('/?pocket=0');
  await enterOffice(page, { loaded: true });
  const skipTour = page.getByRole('button', { name: 'Skip tour' }); // a fresh office starts the tour
  if (await skipTour.isVisible()) await skipTour.dispatchEvent('click'); // the canvas would take a real click
}

/** The phone's Company tab, then one of its panel shortcuts. */
export async function fromPhone(page: Page, button: RegExp, name: RegExp, spot?: SavedView) {
  await office(page, spot);
  await page.keyboard.press('p');
  const phone = dialog(page, /Your phone/);
  await phone.getByRole('tab', { name: 'Company' }).click();
  await phone.getByRole('button', { name: button }).click();
  return dialog(page, name);
}

/** A game from the phone's Games tab (tapping Games again goes back to the list). */
export const game = (name: string): View => ({
  name,
  go: async (root) => {
    await root.getByRole('tab', { name: 'Games' }).click();
    await root.getByRole('button', { name: new RegExp(name) }).click();
  },
});

const starts = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

/** Pocket mode's Settings: back to the list if a section is open, then a section (#102). */
export async function pocketSection(root: Locator, label: string) {
  const back = root.getByRole('button', { name: 'Back to settings' });
  if (await back.isVisible()) await back.click();
  await root.getByRole('button', { name: starts(label) }).click();
  await expect(root.getByRole('region', { name: label })).toBeVisible();
}

/** The 3D office's console: a top tab, then a section in its side menu (#102). */
export async function officeSection(root: Locator, group: string, label: string) {
  await root.locator('.cn-groups').getByRole('tab', { name: new RegExp(group) }).click();
  const t = root.locator('.cn-menu').getByRole('tab', { name: starts(label) });
  await t.click();
  await expect(t).toHaveAttribute('aria-selected', 'true');
}

/** The agent window's details, opened from the header if they're closed, then one of their tabs (#117). */
export async function agentTab(root: Locator, tab: string) {
  const who = root.locator('.aw-who');
  if ((await who.getAttribute('aria-expanded')) !== 'true') await who.click();
  await root.locator('#aw-details').getByRole('tab', { name: tab, exact: true }).click();
}

/** Every section of the console, as views. */
export const consoleSections = (where: Where): View[] =>
  GROUPS.flatMap((g) =>
    sectionsIn(g.id, where).map((s) => ({ name: `${g.label} › ${s.label}`, go: (root: Locator) => (where === 'pocket' ? pocketSection(root, s.label) : officeSection(root, g.label, s.label)) })),
  );

/** Labels starting with an action that's hard to undo ("Remove Telegram"): outside a ⋯ menu they mean one tap does it. */
const DANGER = /^\W*(let .+ go|disconnect|close\b|clear desk|clear saved clips|remove\b|delete\b).*$/i;

/** Problems in what the dialog shows now; empty when it follows the rules. */
async function layoutProblems(root: Locator): Promise<string[]> {
  const problems = await root.evaluate((el, danger) => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    const title = document.querySelector('.pk-head .pk-title');
    if (title && title.scrollWidth > title.clientWidth + 1) out.push(`the header's name "${title.textContent}" is cut off`);
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
        // a chat ref chip is a tag inside a sentence (WCAG 2.5.8's inline exception); its own checks are below (#100)
        if (!x.matches('.ref-chip') && (box.width < 43.5 || box.height < 43.5)) out.push(`"${name}" is ${Math.round(box.width)}x${Math.round(box.height)}px, under 44x44`);
        if (x.scrollWidth > x.clientWidth + 1) out.push(`"${name}"'s label is clipped (${x.scrollWidth} > ${x.clientWidth}px)`);
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

/** The light palette with the device in dark mode (#80): the screen's tokens and its own background stay light. */
async function lightProblems(root: Locator): Promise<string[]> {
  return root.evaluate((el) => {
    const out: string[] = [];
    const screen = el.closest('.ds-screen') ?? el.querySelector('.ds-screen') ?? el;
    const css = getComputedStyle(screen);
    const want: Record<string, string> = { '--ds-surface': '#fffdf6', '--ds-surface-sunken': '#f6f3ea', '--ds-text': '#1f1d2b' };
    for (const [token, value] of Object.entries(want)) if (css.getPropertyValue(token).trim().toLowerCase() !== value) out.push(`${token} is ${css.getPropertyValue(token).trim()}, not the light ${value}`);
    if (css.colorScheme.includes('dark')) out.push(`color-scheme is ${css.colorScheme}`);
    // .pocket is the sunken surface, a panel and the start card the paper; the phone's frame is dark plastic, its screen paper
    const surface = el.matches('.pocket') ? 'rgb(246, 243, 234)' : 'rgb(255, 253, 246)';
    const card = el.matches('.pocket, .panel') ? el : el.querySelector('.panel, .start-card, .phone-screen');
    if (card && getComputedStyle(card).backgroundColor !== surface) out.push(`.${card.className.split(' ')[0]}'s background is ${getComputedStyle(card).backgroundColor}, not the light ${surface}`);
    return out;
  });
}

async function axeProblems(page: Page, root: Locator): Promise<string[]> {
  await root.evaluate((el) => el.setAttribute('data-layout-under-test', ''));
  const { violations } = await new AxeBuilder({ page }).include('[data-layout-under-test]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  // LAYOUT_DEBUG=1 lists every failing node with axe's reason (the colours and ratio for contrast).
  if (process.env.LAYOUT_DEBUG) return violations.flatMap((v) => v.nodes.map((n) => `axe ${v.id}: ${n.target.join(' ')} ${n.any[0]?.message ?? ''}`));
  return violations.map((v) => `axe ${v.id}: ${v.help} (${v.nodes.length}× e.g. ${v.nodes[0]?.target.join(' ')})`);
}

/** One test per screen and width: opens it, walks its views and fails on anything that breaks the rules above. */
export function checkScreens(SCREENS: Screen[]) {
  for (const screen of SCREENS) {
    for (const width of screen.widths) {
      test(`${screen.name} at ${width}px`, async ({ page }) => {
        test.setTimeout(300_000); // every tab of a screen, on software rendering
        await page.setViewportSize({ width, height: width < 800 ? 844 : 800 });
        await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); // the device's dark mode changes nothing (#80)
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
          for (const p of [...(await lightProblems(root)), ...(await layoutProblems(root)), ...(await menuProblems(page, root)), ...(await axeProblems(page, root))]) problems.push(at + p);
        }
        expect(problems).toEqual([]);
      });
    }
  }
}

const SAFARI = devices['iPhone 15'].userAgent;
const CHROME_IOS = SAFARI.replace(/Version\/\S+/, 'CriOS/157.0.0.0');

/** A grey PNG, `width` x `height`: a phone screenshot's shape. */
export function png(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const rows = Buffer.alloc((width + 1) * height, 0x99);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0; // each row's filter byte
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

export const MODES = [
  { name: 'home-screen app', userAgent: SAFARI, standalone: true },
  { name: 'Chrome iOS', userAgent: CHROME_IOS, standalone: false },
];
