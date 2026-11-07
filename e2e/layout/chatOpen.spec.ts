import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers';
import { checkScreens, consoleSections, pocket, type Screen } from './helpers';

// Desktop and tablet with the CEO chat open (#212): every main screen beside the docked chat (1280) or under its drawer
// (820), what a chat ref opens comes to the front of the console, and Esc closes only the top panel.

const WIDTHS = [1280, 820];

/** Pocket mode on `tab` with the chat open: docked at 1280, its drawer at 820. */
async function withChat(page: Page, tab: string) {
  const root = await pocket(page, tab);
  const dock = root.locator('.pk-dock');
  if (!(await dock.isVisible())) await root.locator('.pk-chat-btn').click();
  await expect(dock).toBeVisible();
  return root;
}

/** The work area beside the chat (1280: it never runs under the dock; 820: the drawer is over it and closes first). */
async function beside(page: Page, tab: string) {
  const root = await withChat(page, tab);
  if (page.viewportSize()!.width < 1024) await root.locator('.pk-dock').getByRole('button', { name: 'Hide the chat' }).click();
  return root.locator('.pk-work');
}

const SCREENS: Screen[] = [
  ...['company', 'kanban', 'team', 'approvals'].map((tab) => ({ name: `chat open: ${tab}`, widths: WIDTHS, open: (page: Page) => beside(page, tab), tabs: [] })),
  {
    name: 'chat open: console',
    widths: WIDTHS,
    open: async (page) => {
      const work = await beside(page, 'company');
      await page.locator('.pk-tab-console').click();
      return work.locator('.pk-settings');
    },
    tabs: consoleSections('pocket').slice(0, 4),
  },
  {
    name: 'chat open: terminal',
    widths: WIDTHS,
    open: async (page) => {
      const work = await beside(page, 'team');
      await work.getByRole('button', { name: 'Terminal', exact: true }).first().click();
      return work.locator('.pk-pane .panel');
    },
    tabs: [],
  },
];

checkScreens(SCREENS);

/** Whether `el` is what's on top at its centre, and how far it runs under the chat column (0: not at all). */
async function frontAndClear(el: Locator, dock: Locator) {
  const [box, chat] = await Promise.all([el.boundingBox(), dock.boundingBox()]);
  const top = await el.evaluate((x) => {
    const r = x.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && x.contains(hit);
  });
  return { top, under: chat && box ? Math.max(0, box.x + box.width - chat.x) : 0 };
}

/** The manager's own message naming an agent: its chip opens their window. */
async function agentChip(page: Page) {
  const state = await (await page.request.get('/api/state')).json();
  const a = (state.agents as { name: string; role: string }[]).find((x) => x.role !== 'ceo')!;
  await page.request.post('/api/ceo/message', { data: { text: `How is @${a.name} getting on? (#212)` } });
  return a.name;
}

for (const width of WIDTHS) {
  test(`a chat ref opens in front of the console at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const name = await agentChip(page);
    const root = await pocket(page, 'company');
    await root.locator('.pk-tab-console').click();
    await expect(root.locator('.pk-settings')).toBeVisible();
    const dock = root.locator('.pk-dock');
    if (!(await dock.isVisible())) await root.locator('.pk-chat-btn').click(); // the drawer at 820
    await dock.locator('.bubble-text', { hasText: '(#212)' }).last().getByRole('button', { name: new RegExp(name) }).click();
    const panel = root.locator('.pk-pane .panel');
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((x) => x.contains(document.activeElement))).toBe(true); // it has the focus
    const { top, under } = await frontAndClear(panel.locator('.panel-head'), dock);
    expect(top).toBe(true);
    if (width >= 1024) expect(under).toBe(0);
    else await expect(dock).toBeHidden(); // the drawer made way for it
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Esc closes the top panel only: the window, then the console
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(root.locator('.pk-settings')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(root.locator('.pk-settings')).toBeHidden();
    await expect(root).toBeVisible();
  });

  test(`the rail brings its page in front of the console at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const root = await pocket(page, 'company');
    await root.locator('.pk-tab-console').click();
    await expect(root.locator('.pk-settings')).toBeVisible();
    await root.locator('.pk-tabs').getByRole('button', { name: /Team/ }).click();
    await expect(root.locator('.pk-settings')).toBeHidden();
    const { top } = await frontAndClear(root.locator('.pk-main'), root.locator('.pk-tabs'));
    expect(top).toBe(true);
  });
}

test('Tab stays in an ⓘ sheet opened from the console', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const root = await pocket(page, 'company');
  await root.locator('.pk-tab-console').click();
  await root.locator('.pk-settings .info-btn').first().click();
  const sheet = page.locator('.info-sheet');
  await expect(sheet).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    expect(await sheet.evaluate((x) => x.contains(document.activeElement))).toBe(true);
  }
});

test('a second window replaces the first and leaves a back chip', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const root = await pocket(page, 'team');
  const terminals = root.locator('.pk-main').getByRole('button', { name: 'Terminal', exact: true });
  await terminals.nth(0).click();
  await expect(root.locator('.pk-pane .panel')).toBeVisible();
  await terminals.nth(1).click();
  const back = root.locator('.pk-back-chip');
  await expect(back).toBeVisible();
  const first = await back.innerText();
  await back.click();
  await expect(back).not.toHaveText(first); // the first is back, the second is now the chip
});

test('the docked chat resizes between 360 and 520 px and remembers it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const root = await withChat(page, 'company');
  const grip = root.getByRole('separator', { name: 'Chat width' });
  await grip.focus();
  await page.keyboard.press('Home');
  await expect(grip).toHaveAttribute('aria-valuenow', '520');
  expect(Math.round((await root.locator('.pk-dock').boundingBox())!.width)).toBe(520);
  await page.keyboard.press('End');
  await expect(grip).toHaveAttribute('aria-valuenow', '360');
  await page.reload();
  await expect(page.getByRole('separator', { name: 'Chat width' })).toHaveAttribute('aria-valuenow', '360');
});
