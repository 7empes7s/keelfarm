import AxeBuilder from '@axe-core/playwright';
import { crc32, deflateSync } from 'node:zlib';
import { devices, type Locator, type Page } from '@playwright/test';
import { HALF_D, MANAGER_DESK } from '../client/src/world/layout';
import { GROUPS, sectionsIn, type Where } from '../client/src/ui/consoleNavRules';
import { enterOffice, expect, startAt, test, type SavedView } from './helpers';
import { telegramViews } from './telegramViews';

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
const AT_ELEVATOR: SavedView = { floor: 0, x: 0, z: HALF_D - 1.4, yaw: Math.PI, pitch: 0.6 }; // at the frame's lintel: the doors aren't the interactable
const dialog = (page: Page, name: RegExp) => page.getByRole('dialog', { name });
const PHONES = [360, 390, 430, 1280];
// The 3D office boots WebGL: two widths are enough there; pocket mode is what phones get, and it's checked at all four.
const OFFICE = [390, 1280];
// Pocket mode's own tabs also at its medium layout and a big desktop (#104).
const POCKET = [360, 390, 430, 900, 1280, 1920];

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

const starts = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

/** Pocket mode's Settings: back to the list if a section is open, then a section (#102). */
async function pocketSection(root: Locator, label: string) {
  const back = root.getByRole('button', { name: 'Back to settings' });
  if (await back.isVisible()) await back.click();
  await root.getByRole('button', { name: starts(label) }).click();
  await expect(root.getByRole('region', { name: label })).toBeVisible();
}

/** The 3D office's console: a top tab, then a section in its side menu (#102). */
async function officeSection(root: Locator, group: string, label: string) {
  await root.locator('.cn-groups').getByRole('tab', { name: new RegExp(group) }).click();
  const t = root.locator('.cn-menu').getByRole('tab', { name: starts(label) });
  await t.click();
  await expect(t).toHaveAttribute('aria-selected', 'true');
}

/** The agent window's details, opened from the header if they're closed, then one of their tabs (#117). */
async function agentTab(root: Locator, tab: string) {
  const who = root.locator('.aw-who');
  if ((await who.getAttribute('aria-expanded')) !== 'true') await who.click();
  await root.locator('#aw-details').getByRole('tab', { name: tab, exact: true }).click();
}

/** Every section of the console, as views. */
const consoleSections = (where: Where): View[] =>
  GROUPS.flatMap((g) =>
    sectionsIn(g.id, where).map((s) => ({ name: `${g.label} › ${s.label}`, go: (root: Locator) => (where === 'pocket' ? pocketSection(root, s.label) : officeSection(root, g.label, s.label)) })),
  );

/** Settings → Floors & repos, then one of Add a project's modes (#91). */
const addProject = (mode: string): View => ({
  name: `Add a project: ${mode}`,
  go: async (root) => {
    await pocketSection(root, 'Floors & repos');
    await root.getByRole('button', { name: mode }).click();
  },
});

/** Mission control with the costs' first waste group (#106) or the Rounds card's first cause (#188) open. */
const wasteGroup = (where: Where, rounds = false): View => ({
  name: `Mission control: a ${rounds ? 'rounds cause' : 'waste group'} open`,
  go: async (root) => {
    await (where === 'pocket' ? pocketSection(root, 'Mission control') : officeSection(root, 'Company', 'Mission control'));
    const group = root.locator(rounds ? '#ops-card-rounds .costs-group-head' : '#costs-waste ~ .costs-groups .costs-group-head').first();
    await group.scrollIntoViewIfNeeded();
    await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'true');
  },
});

/** Charter, then its editor (#105). */
const charterEditor: View = {
  name: 'Charter editor',
  go: async (root) => {
    await pocketSection(root, 'Charter');
    await root.getByRole('button', { name: '✏️ Edit', exact: true }).click();
  },
};

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
    tabs: ['', ...consoleSections('pocket'), wasteGroup('pocket'), wasteGroup('pocket', true), charterEditor, ...telegramViews(['on', 'off', 'error', 'on'], (r) => pocketSection(r, 'Notifications')), addProject('A folder on this computer'), addProject('A GitHub repo'), addProject('Something new')],
  },
  {
    name: "manager's console",
    widths: OFFICE,
    open: async (page) => {
      await office(page);
      await page.keyboard.press('e');
      return dialog(page, /Manager's console/);
    },
    tabs: [...consoleSections('office'), wasteGroup('office'), wasteGroup('office', true)],
  },
  { name: 'pocket company', widths: POCKET, open: (page) => pocket(page, 'company'), tabs: [] },
  { name: 'pocket chat', widths: POCKET, open: (page) => pocket(page, 'chat'), tabs: [] },
  {
    // a CEO reply's action cards, idea card and artifact (#108), at the chat's smallest, normal and biggest text (#135)
    name: 'pocket chat cards',
    widths: POCKET,
    open: async (page) => {
      await page.request.post('/api/ceo/message', { data: { text: 'Plan the next milestone for floor 1' } });
      const root = await pocket(page, 'chat');
      await expect(root.locator('.idea-card')).toBeVisible({ timeout: 90_000 });
      await expect(root.locator('.action-card').first()).toBeVisible();
      return root;
    },
    tabs: [80, 100, 200].map((v) => ({
      name: `text ${v}%`, go: (root: Locator) => root.page().evaluate((chatText) => (window as unknown as { __swarmA11y: { set: (p: object) => void } }).__swarmA11y.set({ chatText }), v),
    })),
  },
  {
    // the questions waiting on the manager, in the tray above the message box, open and collapsed (#114)
    name: 'pocket chat decisions',
    widths: POCKET,
    open: async (page) => {
      const root = await pocket(page, 'chat');
      await expect(root.getByRole('region', { name: 'Waiting on you' })).toBeVisible();
      return root;
    },
    tabs: ['', { name: 'collapsed', go: (root) => root.getByRole('button', { name: /^Hide the/ }).click() }],
  },
  {
    // the phone's chat with every button it can have (its own 🔍, 📄, 📎 and hands-free), the header's name still whole (#109)
    name: 'pocket chat header',
    widths: [360, 390, 430],
    open: async (page) => {
      await page.request.post('/api/files', { headers: { 'Content-Type': 'image/png', 'X-File-Name': 'f.png' }, data: png(40, 40) });
      await page.request.post('/api/ceo/message', { data: { text: 'Plan the next milestone for floor 1' } });
      const root = await pocket(page, 'chat');
      await expect(root.getByRole('button', { name: /^Artifacts \(\d+\)$/ })).toBeVisible({ timeout: 90_000 });
      await expect(root.getByRole('button', { name: /^Files \(\d+\)$/ })).toBeVisible();
      await expect(root.getByRole('button', { name: /search/i })).toHaveCount(1); // the chat's own, not two 🔍 side by side
      return root;
    },
    tabs: [],
  },
  { name: 'pocket kanban', widths: POCKET, open: (page) => pocket(page, 'kanban'), tabs: [] },
  { name: 'pocket team', widths: POCKET, open: (page) => pocket(page, 'team'), tabs: [] },
  { name: 'pocket approvals', widths: POCKET, open: (page) => pocket(page, 'approvals'), tabs: [] },
  {
    name: 'search palette (#109)',
    widths: PHONES,
    open: async (page) => {
      const root = await pocket(page, 'company');
      await root.getByRole('button', { name: /Search everything/ }).click();
      await page.getByRole('combobox', { name: 'Search everything' }).fill('floor');
      return page.getByRole('dialog', { name: /Search everything/ });
    },
    tabs: [],
  },
  {
    name: 'ⓘ sheet (#109)',
    widths: PHONES,
    open: async (page) => {
      const root = await pocket(page, 'kanban');
      await root.getByRole('button', { name: /What can I do on Kanban/ }).click();
      return page.getByRole('dialog', { name: /Kanban/ });
    },
    tabs: [],
  },
  {
    name: 'pocket tour (#121)',
    widths: [390, 1280],
    open: async (page) => {
      await page.request.patch('/api/settings', { data: { tutorialStep: 0 } });
      const root = await pocket(page, 'company');
      await root.getByRole('region', { name: 'Take the tour' }).getByRole('button', { name: 'Start' }).click();
      return page.getByRole('region', { name: 'Tour' });
    },
    tabs: [],
  },
  {
    name: '3D office tour (#121)',
    widths: OFFICE,
    open: async (page) => {
      await page.request.patch('/api/settings', { data: { tutorialStep: 0 } });
      await enterOffice(page);
      return page.getByRole('region', { name: 'Tour' });
    },
    tabs: [],
  },
  {
    name: 'pocket notification centre',
    widths: PHONES,
    open: async (page) => {
      await (await pocket(page, 'company')).getByRole('button', { name: /^Notifications/ }).click();
      return dialog(page, /Notifications/);
    },
    tabs: [],
  },
  {
    name: 'notification centre',
    widths: OFFICE,
    open: async (page) => {
      await office(page);
      await page.locator('.hud-status .notice-bell').click(); // a real click: it fails while anything covers the bell
      await expect(page.locator('.notice-centre')).toBeVisible();
      return dialog(page, /Notifications/);
    },
    tabs: [],
  },
  {
    // the agent window (#117): the header row, then its details' tabs (a sheet on phones, a side panel at 1280)
    name: 'terminal view',
    widths: [360, 375, 390, 430, 1280],
    open: async (page) => {
      const root = await pocket(page, 'team');
      await root.getByRole('button', { name: 'Terminal', exact: true }).first().click();
      return page.getByRole('dialog');
    },
    tabs: ['', ...(['Now', 'Profile', 'Setup'] as const).map((t) => ({ name: `details › ${t}`, go: (root: Locator) => agentTab(root, t) }))],
  },
  {
    // their chat (#120): the conversation, a group of steps opened, then the terminal again
    name: 'agent chat',
    widths: [390, 1280],
    open: async (page) => {
      const root = await pocket(page, 'team');
      await root.getByRole('button', { name: 'Terminal', exact: true }).first().click();
      const d = page.getByRole('dialog');
      await d.getByRole('button', { name: 'Chat', exact: true }).click();
      return d;
    },
    tabs: [
      '',
      {
        name: 'a step open',
        go: async (root) => {
          const step = root.locator('.ac-steps > summary').first(); // an agent who hasn't started yet has none
          if (await step.count()) await step.click();
        },
      },
      { name: 'terminal', go: (root) => root.getByRole('button', { name: 'Terminal', exact: true }).click() },
    ],
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
    name: 'app viewer, Desktop on a phone (#131)',
    widths: [360, 390, 430],
    open: async (page) => {
      const root = await pocket(page, 'kanban');
      await root.getByTitle("Open this floor's running app").click();
      const viewer = page.getByRole('dialog');
      await viewer.getByRole('button', { name: 'More for the app' }).click();
      await page.getByRole('menuitem', { name: /Desktop width/ }).click();
      await expect(viewer.getByText('Turn your phone sideways for the desktop view')).toBeVisible();
      return viewer;
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
  { name: 'map room (#137)', widths: OFFICE, open: (page) => fromPhone(page, /Map room/, /Map room/), tabs: [] },
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
      await page.waitForTimeout(2000); // a few frames to aim at it on software WebGL
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
        // a tapback badge is a small pill whose ::after takes the 44px tap (#193)
        if (x.matches('.reaction')) {
          if (box.height > 28) out.push(`tapback "${name}" is ${Math.round(box.height)}px tall, over 28`);
        } else if (!x.matches('.ref-chip') && (box.width < 43.5 || box.height < 43.5)) out.push(`"${name}" is ${Math.round(box.width)}x${Math.round(box.height)}px, under 44x44`);
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

// ---------- pocket mode on a desktop (#104) ----------

for (const [width, height] of [
  [900, 800],
  [1280, 800],
  [1920, 1080],
]) {
  test(`pocket mode at ${width}px has the rail, and the chat beside the pages when wide`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const root = await pocket(page, 'company');
    const rail = await root.locator('.pk-tabs').boundingBox();
    expect(rail!.height).toBeGreaterThan(height / 2); // a rail down the side, not a bar at the bottom
    await expect(root.locator('.pk-dock')).toHaveCount(width >= 1024 ? 1 : 0);
    await page.keyboard.press('/');
    await expect(root.locator('.pk-dock textarea')).toBeFocused();
    await root.locator('.pk-dock textarea').press('3'); // typed, not a shortcut
    await expect(root.locator('.pk-tab-on', { hasText: 'Company' })).toBeVisible();
    await root.locator('.pk-dock textarea').blur();
    await page.keyboard.press('3');
    await expect(root.locator('.pk-tab-on', { hasText: 'Kanban' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

// ---------- pocket mode's viewport on an iPhone (#73) ----------
// The chat column: the message box sits on the tabs, the conversation fills the rest and shows the newest message, and
// the header is padded for the notch once, in Safari's home-screen app and in Chrome iOS's tab, keyboard or not.

const SAFARI = devices['iPhone 15'].userAgent;
const CHROME_IOS = SAFARI.replace(/Version\/\S+/, 'CriOS/157.0.0.0');
let seeded = false;

/** A grey PNG, `width` x `height`: a phone screenshot's shape. */
function png(width: number, height: number) {
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

/** 20 messages and a tall screenshot in the chat, once per run. */
async function seedChat(page: Page) {
  if (seeded) return;
  seeded = true;
  const file = await (await page.request.post('/api/files', { headers: { 'Content-Type': 'image/png', 'X-File-Name': 'tall.png' }, data: png(400, 1300) })).json();
  for (let i = 1; i <= 20; i++) await page.request.post('/api/ceo/message', { data: { text: `Message ${i}: how is the busiest floor doing?` } });
  await page.request.post('/api/ceo/message', { data: { text: 'This is what the chat looks like', files: [file.id] } });
  await page.request.post('/api/phone/read', { data: { at: Date.now() + 60_000 } }); // opens at the end, not at a "New messages" divider
}

/** What's wrong with the chat column right now. */
async function chatProblems(page: Page, when: string): Promise<string[]> {
  await page.waitForTimeout(400); // the viewport's next frame, and the log following it
  const out = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const input = box('.chat-input');
    const tabs = box('.pk-tabs');
    const log = box('.chat-log');
    const newest = document.querySelector('.chat-log')!.lastElementChild!.getBoundingClientRect();
    const probe = Object.assign(document.createElement('div'), { style: 'position:fixed;padding-top:env(safe-area-inset-top)' });
    document.body.append(probe);
    const safeTop = parseFloat(getComputedStyle(probe).paddingTop);
    probe.remove();
    const headPad = parseFloat(getComputedStyle(document.querySelector('.pk-head')!).paddingTop);
    const problems: string[] = [];
    const floor = tabs.height ? tabs.top : innerHeight; // typing, the tab bar steps aside (#152): the box sits on the bottom
    if (!tabs.height && !document.documentElement.hasAttribute('data-typing')) problems.push('the tabs are hidden');
    if (Math.abs(input.bottom - floor) > 1) problems.push(`${Math.round(floor - input.bottom)}px between the message box and the ${tabs.height ? 'tabs' : 'screen bottom'}`);
    if (tabs.height && (tabs.bottom > innerHeight + 1 || tabs.bottom < innerHeight - 1)) problems.push(`the tabs end at ${Math.round(tabs.bottom)}, the screen at ${innerHeight}`);
    if (log.height <= innerHeight / 2) problems.push(`the conversation is ${Math.round(log.height)}px of ${innerHeight}`);
    if (newest.bottom > log.bottom + 1 || newest.bottom < log.top) problems.push('the newest message is out of view');
    if (Math.abs(headPad - Math.max(8, safeTop)) > 0.5) problems.push(`the header's top padding is ${headPad}px for a ${safeTop}px safe area`);
    if (visualViewport!.scale !== 1) problems.push(`zoomed to ${visualViewport!.scale}`);
    return problems;
  });
  return out.map((p) => `${when}: ${p}`);
}

const IPHONES = [
  { name: 'iPhone 15', width: 393, height: 852 },
  { name: 'iPhone 16 Pro', width: 402, height: 874 },
  { name: 'iPhone 16 Pro Max', width: 440, height: 956 },
];
const MODES = [
  { name: 'home-screen app', userAgent: SAFARI, standalone: true },
  { name: 'Chrome iOS', userAgent: CHROME_IOS, standalone: false },
];

for (const mode of MODES) {
  test.describe(`pocket chat on an iPhone, ${mode.name}`, () => {
    test.use({ isMobile: true, hasTouch: true, userAgent: mode.userAgent });
    for (const phone of IPHONES) {
      test(`${phone.name}: the message box sits on the tabs`, async ({ page }) => {
        await page.setViewportSize({ width: phone.width, height: phone.height });
        if (mode.standalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
        await seedChat(page);
        await page.goto('/?pocket=1&tab=chat');
        await expect(page.locator('.chat-input')).toBeVisible();
        expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('maximum-scale=1');
        const problems = await chatProblems(page, 'opened');

        // The keyboard: the page shrinks while a field has focus, then grows back when it goes away.
        const box = page.locator('.chat-input textarea');
        await page.setViewportSize({ width: phone.width, height: Math.round(phone.height * 0.55) });
        await box.focus();
        problems.push(...(await chatProblems(page, 'keyboard open')).filter((p) => !p.includes('conversation is')));
        await box.blur();
        await page.setViewportSize({ width: phone.width, height: phone.height });
        problems.push(...(await chatProblems(page, 'keyboard closed')));

        await page.locator('.chat-input input[type="file"][capture]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png(40, 80) });
        problems.push(...(await chatProblems(page, 'a photo attached')).filter((p) => !p.includes('conversation is'))); // the tray takes its room
        await page.getByRole('button', { name: /^(Remove|Cancel the upload)/ }).first().click();
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        problems.push(...(await chatProblems(page, 'back to the app')));
        expect(problems).toEqual([]);
      });
    }
  });
}

// The open decisions' tray (#114) sits above the message box, and steps aside to one pill while the manager types.
for (const width of [390, 1280]) {
  test(`the decisions tray never covers the message box at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const root = await pocket(page, 'chat');
    const tray = root.getByRole('region', { name: 'Waiting on you' });
    await expect(tray).toBeVisible();
    const above = async (what: Locator) => ((await what.boundingBox())!.y + (await what.boundingBox())!.height) <= (await root.locator('.chat-input').boundingBox())!.y + 1;
    expect(await above(tray)).toBe(true);
    await root.locator('.chat-input textarea').fill('About something else');
    await expect(tray).toBeHidden();
    const pill = root.getByRole('button', { name: /decisions? waiting$/ });
    await expect(pill).toBeVisible();
    expect(await above(pill)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

// The other full-screen views take the same height: from the top of the screen to its bottom, nothing left over.
for (const width of [360, 390, 430]) {
  test(`pocket full-screen views fill a ${width}px iPhone`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?pocket=1');
    await page.getByRole('button', { name: 'Settings and notifications' }).click();
    const panel = dialog(page, /Settings/);
    await expect(panel.getByRole('button', { name: /^Floors & repos/ })).toBeVisible();
    await expect.poll(async () => (await panel.boundingBox())?.y).toBe(0);
    const box = (await panel.boundingBox())!;
    expect(Math.abs(box.y + box.height - 844)).toBeLessThanOrEqual(1);
  });
}

// A Settings section's back bar stays pinned flush under the header while the section scrolls: nothing shows above or
// beside it (#91, #102).
for (const width of [360, 390, 430]) {
  test(`pocket Settings' back bar covers the scrolled content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?pocket=1');
    await page.getByRole('button', { name: 'Settings and notifications' }).click();
    const panel = dialog(page, /Settings/);
    await pocketSection(panel, 'Floors & repos');
    const gaps = await panel.evaluate((el) => {
      const body = el.querySelector('.panel-body')!;
      body.scrollTop = 400;
      const view = body.getBoundingClientRect();
      const row = el.querySelector('.cn-back-bar')!.getBoundingClientRect();
      return { top: Math.round(row.top - view.top), left: Math.round(row.left - view.left), right: Math.round(view.right - row.right) };
    });
    expect(gaps).toEqual({ top: 0, left: 0, right: 0 });
  });
}

// ---------- chat chips and Kanban cards (#100) ----------

// Ref chips are boxes in the sentence: one line high (never taller than two lines of the text), nothing clipped or
// sticking out of the bubble, a box that doesn't fit moving to the next line whole.
for (const width of PHONES) {
  test(`chat chips sit in the sentence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await (await page.request.get('/api/state')).json();
    const [a, b] = (state.agents as { name: string; role: string }[]).filter((x) => x.role !== 'ceo');
    const text = `Could @${a.name} pair with @${b.name} on floor 1 today and tell me how it went? (#100)`;
    await page.request.post('/api/ceo/message', { data: { text } });
    await page.goto('/?pocket=1&tab=chat');
    const bubble = page.locator('.bubble-text', { hasText: '(#100)' }).last();
    await expect(bubble.locator('.ref-chip')).toHaveCount(3);
    const problems = await bubble.evaluate((el) => {
      const out: string[] = [];
      const line = parseFloat(getComputedStyle(el).lineHeight);
      const box = el.getBoundingClientRect();
      for (const chip of el.querySelectorAll<HTMLElement>('.ref-chip')) {
        const r = chip.getBoundingClientRect();
        const name = chip.innerText.trim();
        if (chip.getClientRects().length > 1) out.push(`"${name}" breaks across lines`);
        if (r.height > 2 * line) out.push(`"${name}" is ${Math.round(r.height)}px tall, over two ${line}px lines`);
        if (chip.scrollWidth > chip.clientWidth + 1) out.push(`"${name}" is clipped (${chip.scrollWidth} > ${chip.clientWidth}px)`);
        if (r.left < box.left - 1 || r.right > box.right + 1) out.push(`"${name}" sticks out of the bubble`);
        const status = chip.querySelector('.ref-chip-status')?.getBoundingClientRect();
        if (status && Math.abs(status.top + status.height / 2 - (r.top + r.height / 2)) > 1.5) out.push(`"${name}"'s status isn't centred`);
      }
      return out;
    });
    expect(problems).toEqual([]);
  });
}

// A code block (#200): a 150-character command wraps whole inside its card, Copy in the header above it, never over it.
for (const width of [360, 390, 1280]) {
  test(`chat code blocks are readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1&tab=chat');
    const block = page.locator('.md-code-shell').filter({ hasText: 'merge.ts server/swarm/qa.ts' }).last();
    await expect(block.locator('.md-code-lang')).toHaveText('Terminal');
    const problems = await block.evaluate((el) => {
      const out: string[] = [];
      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
      const pre = el.querySelector('pre')!;
      const code = pre.getBoundingClientRect();
      const copy = el.querySelector('.md-copy')!.getBoundingClientRect();
      if (pre.scrollWidth > pre.clientWidth + 1) out.push(`the command is cut off (${pre.scrollWidth} > ${pre.clientWidth}px)`);
      if (copy.bottom > code.top + 0.5) out.push('Copy overlaps the code');
      if (el.getBoundingClientRect().right > vw + 1) out.push('the block sticks out of the screen');
      return out;
    });
    expect(problems).toEqual([]);
  });
}

// Every card at every column width, from the desktop board's narrowest to a phone's one column: nothing in it wider
// than the card, no button's label clipped.
for (const width of [390, 1280]) {
  test(`Kanban cards fit their columns at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1&tab=kanban');
    await expect(page.locator('.kcol-progress .kcard button').first()).toBeVisible({ timeout: 30_000 }); // an agent's card, with Terminal
    const problems: string[] = [];
    for (const col of [210, 250, 320]) {
      if (col > width - 40) continue;
      problems.push(
        ...(await page.evaluate((col) => {
          const out: string[] = [];
          for (const k of document.querySelectorAll<HTMLElement>('.kanban')) k.style.gridTemplateColumns = `repeat(5, ${col}px)`;
          for (const card of document.querySelectorAll<HTMLElement>('.kcard')) {
            const r = card.getBoundingClientRect();
            const name = card.querySelector('.kcard-title')?.textContent?.trim().slice(0, 30);
            if (card.scrollWidth > card.clientWidth + 1) out.push(`${col}px: "${name}" overflows its card (${card.scrollWidth} > ${card.clientWidth}px)`);
            for (const b of card.querySelectorAll<HTMLElement>('button')) {
              const br = b.getBoundingClientRect();
              if (b.scrollWidth > b.clientWidth + 1) out.push(`${col}px: "${b.innerText.trim()}" on "${name}" is clipped`);
              if (br.right > r.right + 1 || br.left < r.left - 1) out.push(`${col}px: "${b.innerText.trim()}" on "${name}" sticks out of the card`);
            }
          }
          return out;
        }, col)),
      );
    }
    expect(problems).toEqual([]);
  });
}

// ---------- the preview's desktop view on a phone (#131) ----------
// Desktop on an upright iPhone shows the rotate hint once; turned sideways the viewer goes edge to edge at desktop
// width with a floating ✕ and ⋯ (no office tabs or header), and upright again it's the viewer, in both iOS modes.

for (const mode of MODES) {
  test.describe(`the app viewer turned sideways, ${mode.name}`, () => {
    test.use({ isMobile: true, hasTouch: true, userAgent: mode.userAgent });
    test('Desktop: hint once, edge to edge sideways, the viewer again upright', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize({ width: 390, height: 844 });
      if (mode.standalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
      const root = await pocket(page, 'kanban');
      await root.getByTitle("Open this floor's running app").click();
      const viewer = page.getByRole('dialog');
      const pickDesktop = async () => {
        await viewer.getByRole('button', { name: 'More for the app' }).click();
        await page.getByRole('menuitem', { name: /Desktop width/ }).click();
      };
      await pickDesktop();
      const hint = viewer.getByText('Turn your phone sideways for the desktop view');
      await expect(hint).toBeVisible();
      await viewer.getByRole('button', { name: 'Got it' }).click();
      await expect(hint).toBeHidden();

      await page.setViewportSize({ width: 844, height: 390 });
      await expect(page.locator('.panel-app-immersive')).toBeVisible();
      const panel = (await page.locator('.panel-app-immersive').boundingBox())!;
      expect([panel.x, panel.y, panel.width, panel.height]).toEqual([0, 0, 844, 390]);
      await expect(viewer.locator('.panel-head')).toBeHidden();
      await expect(page.locator('.pk-tabs')).not.toBeInViewport({ ratio: 0.01 }); // covered: nothing of the office shows
      const frame = (await viewer.locator('.app-frame').boundingBox())!;
      expect(Math.round(frame.width)).toBe(844); // 1280 CSS px scaled to the screen
      expect(await viewer.locator('.app-frame').evaluate((f) => (f as HTMLElement).offsetWidth)).toBe(1280);
      await expect(viewer.getByRole('button', { name: 'Close' }).last()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.panel-app-immersive')).toHaveCount(0);
      await expect(viewer.locator('.panel-head')).toBeVisible();
      await pickDesktop();
      await expect(hint).toBeHidden(); // once
      expect(errors).toEqual([]);
    });

    test('⋯ Full screen goes edge to edge upright, and ‹ Back leaves it', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const root = await pocket(page, 'kanban');
      await root.getByTitle("Open this floor's running app").click();
      const viewer = page.getByRole('dialog');
      await viewer.getByRole('button', { name: 'More for the app' }).click();
      await page.getByRole('menuitem', { name: /Full screen/ }).click();
      await expect(page.locator('.panel-app-immersive')).toBeVisible();
      await page.getByRole('button', { name: 'Leave full screen' }).click();
      await expect(page.locator('.panel-app-immersive')).toHaveCount(0);
      await expect(viewer).toBeVisible();
    });
  });
}
