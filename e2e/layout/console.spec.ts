import type { Where } from '../../client/src/ui/consoleNavRules';
import { expect, test } from '../helpers';
import { telegramViews } from '../telegramViews';
import { checkScreens, consoleSections, dialog, office, OFFICE, consoleSection, pocketSection, type Screen, type View } from './helpers';

// Settings, the console and their sections: pocket mode's Settings and the 3D office's manager's console (#102).

/** Settings → Floors & repos, then one of Add a project's modes (#91). */
const addProject = (mode: string): View => ({
  name: `Add a project: ${mode}`,
  go: async (root) => {
    await pocketSection(root, 'Floors & repos');
    await root.getByRole('button', { name: mode }).click();
  },
});

/** A section with its first expandable row tapped open: Mission control's waste groups (#106), objectives' progress (#140). */
const tapOpen = (name: string, group: string, section: string, row: string) => (where: Where): View => ({
  name,
  go: async (root) => {
    await (where === 'pocket' ? pocketSection(root, section) : consoleSection(root, group, section));
    const head = root.locator(row).first();
    await head.scrollIntoViewIfNeeded();
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
  },
});
const wasteGroup = (where: Where, rounds = false): View =>
  tapOpen(`Mission control: a ${rounds ? 'rounds cause' : 'waste group'} open`, 'Company', 'Mission control', rounds ? '#ops-card-rounds .costs-group-head' : '#costs-waste ~ .costs-groups .costs-group-head')(where);
const objectiveProgress = tapOpen('Charter: an objective’s progress listed', 'Company', 'Charter', '.cs-objective .pb-tap');

/** Charter, then its editor (#105). */
const charterEditor: View = {
  name: 'Charter editor',
  go: async (root) => {
    await pocketSection(root, 'Charter');
    await root.getByRole('button', { name: 'Edit', exact: true }).click();
  },
};

const SCREENS: Screen[] = [
  {
    name: 'pocket console',
    widths: [360, 390, 430, 768, 1280, 1440], // the phone's list, then the desktop's top tabs and sections row (#199)
    open: async (page) => {
      await page.request.put('/api/notify/telegram', { data: { token: `123456:${'A'.repeat(35)}` } }); // shows Telegram's settings (demo bot)
      await page.goto('/?pocket=1');
      await page.getByRole('button', { name: 'Settings and notifications' }).click();
      return dialog(page, /Settings/);
    },
    tabs: ['', ...consoleSections('pocket'), wasteGroup('pocket'), wasteGroup('pocket', true), charterEditor, objectiveProgress('pocket'), ...telegramViews(['on', 'off', 'error', 'on'], (r) => pocketSection(r, 'Notifications')), addProject('A folder on this computer'), addProject('A GitHub repo'), addProject('Something new')],
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
