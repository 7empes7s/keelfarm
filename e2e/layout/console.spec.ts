import type { Where } from '../../client/src/ui/consoleNavRules';
import { expect, test } from '../helpers';
import { telegramViews } from '../telegramViews';
import { checkScreens, consoleSections, dialog, office, OFFICE, officeSection, pocketSection, type Screen, type View } from './helpers';

// Settings, the console and their sections: pocket mode's Settings and the 3D office's manager's console (#102).

/** Settings → Floors & repos, then one of Add a project's modes (#91). */
const addProject = (mode: string): View => ({
  name: `Add a project: ${mode}`,
  go: async (root) => {
    await pocketSection(root, 'Floors & repos');
    await root.getByRole('button', { name: mode }).click();
  },
});

/** Mission control with the costs' first waste group open (#106). */
const wasteGroup = (where: Where): View => ({
  name: 'Mission control: a waste group open',
  go: async (root) => {
    await (where === 'pocket' ? pocketSection(root, 'Mission control') : officeSection(root, 'Company', 'Mission control'));
    const group = root.locator('.costs-group-head').first();
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
    tabs: ['', ...consoleSections('pocket'), wasteGroup('pocket'), charterEditor, ...telegramViews(['on', 'off', 'error', 'on'], (r) => pocketSection(r, 'Notifications')), addProject('A folder on this computer'), addProject('A GitHub repo'), addProject('Something new')],
  },
  {
    name: "manager's console",
    widths: OFFICE,
    open: async (page) => {
      await office(page);
      await page.keyboard.press('e');
      return dialog(page, /Manager's console/);
    },
    tabs: [...consoleSections('office'), wasteGroup('office')],
  },
];

checkScreens(SCREENS);

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
