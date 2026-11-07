import type { Locator } from '@playwright/test';
import { expect, test } from '../helpers';
import { agentTab, checkScreens, dialog, PHONES, pocket, POCKET, type Screen } from './helpers';

// Pocket mode's tabs and sheets, and pocket mode on a desktop (#104).

const SCREENS: Screen[] = [
  { name: 'pocket company', widths: POCKET, open: (page) => pocket(page, 'company'), tabs: [] },
  { name: 'pocket team', widths: POCKET, open: (page) => pocket(page, 'team'), tabs: [] },
  { name: 'pocket approvals', widths: POCKET, open: (page) => pocket(page, 'approvals'), tabs: [] },
  {
    name: 'approvals: a design proposal (#209)',
    widths: POCKET,
    open: async (page) => {
      const root = await pocket(page, 'approvals');
      await root.getByRole('button', { name: /Todo list: flat rows or cards/ }).click();
      await expect(root.getByRole('region', { name: /Option B/ })).toBeVisible();
      return root;
    },
    tabs: [],
  },
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
    name: 'pocket notification centre',
    widths: PHONES,
    open: async (page) => {
      await (await pocket(page, 'company')).getByRole('button', { name: /^Notifications/ }).click();
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
];

checkScreens(SCREENS);

test('approvals: a PR low in the list opens at its top, Back returns to the list (#209)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const root = await pocket(page, 'approvals');
  const row = root.getByRole('button', { name: /Forecast in °F on request/ });
  await row.scrollIntoViewIfNeeded();
  const listTop = await root.locator('.pk-main').evaluate((el) => el.scrollTop);
  await row.click();
  await expect(root.getByRole('button', { name: '‹ Approvals' })).toBeInViewport();
  await root.getByRole('button', { name: '‹ Approvals' }).click();
  await expect(row).toBeInViewport();
  expect(await root.locator('.pk-main').evaluate((el) => el.scrollTop)).toBe(listTop);
});

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
