import type { Page } from '@playwright/test';
import { enterOffice, expect, TOUR_SEEN_KEY, test } from './helpers';
import { stepsFor, type Track } from '../client/src/ui/tourSteps';

// The tour and What's new (#121): each track's steps point at a control on screen, and What's new replays only the
// steps this device hasn't seen.

/** This device has seen `ids` (once: the page may save more as the test goes). */
async function seen(page: Page, ids: string[] | null) {
  await page.addInitScript(
    ([key, v]) => {
      if (sessionStorage.getItem('tour-test')) return;
      sessionStorage.setItem('tour-test', '1');
      if (v === null) localStorage.removeItem(key);
      else localStorage.setItem(key, v);
    },
    [TOUR_SEEN_KEY, ids && JSON.stringify(ids)] as const,
  );
}

/** Walks the whole tour, checking each step's ring sits on a control that's on screen (after its Try it, if it needs one). */
async function walk(page: Page, track: Track) {
  const steps = stepsFor(track);
  const card = page.getByRole('region', { name: 'Tour' });
  for (const [i, s] of steps.entries()) {
    await expect(card.locator('.tour-count')).toContainText(`${i + 1}/${steps.length}`);
    await expect(card.locator('.tour-title')).toHaveText(s.title);
    if (s.targets && track !== 'office') {
      const ring = page.locator('.tour-ring');
      if (!(await ring.isVisible()) && s.tryIt) await card.getByRole('button', { name: /^👆/ }).click();
      await expect(ring, `${s.id} points at a control`).toBeVisible();
      await page.keyboard.press('Escape'); // closes what a Try it opened
      await page.keyboard.press('Escape');
    }
    await card.getByRole('button', { name: i === steps.length - 1 ? 'Finish' : /^(Next|Skip step)/ }).click();
  }
  await expect(card).toBeHidden();
}

for (const [track, width] of [
  ['phone', 390],
  ['desk', 1280],
] as const) {
  test(`pocket mode's ${track} tour points at every control, then nothing is new`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.request.patch('/api/settings', { data: { tutorialStep: 0 } });
    await seen(page, null);
    await page.goto('/?pocket=1&tab=company');
    await page.getByRole('region', { name: 'Take the tour' }).getByRole('button', { name: 'Start' }).click();
    await walk(page, track);
    await page.reload();
    await expect(page.locator('.pk-tab-on')).toBeVisible();
    await expect(page.getByRole('region', { name: "What's new" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("What's new replays only the steps this device hasn't seen, and the ⓘ brings them back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.patch('/api/settings', { data: { tutorialStep: -1 } });
  await seen(
    page,
    stepsFor('phone')
      .map((s) => s.id)
      .filter((id) => id !== 'bell' && id !== 'costs'),
  );
  await page.goto('/?pocket=1&tab=company');
  const card = page.getByRole('region', { name: "What's new" });
  await expect(card).toContainText('2 new things since you last looked');
  await card.getByRole('button', { name: 'Show me' }).click();
  const replay = page.locator('.tour');
  await expect(replay.locator('.tour-count')).toContainText('1/2');
  await expect(replay.locator('.tour-title')).toHaveText('Notifications');
  await replay.getByRole('button', { name: 'Open the bell' }).click();
  await expect(page.getByRole('dialog', { name: /Notifications/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await replay.getByRole('button', { name: /^Next/ }).click();
  await expect(replay.locator('.tour-title')).toHaveText('Where the plan goes');
  await replay.getByRole('button', { name: 'Done' }).last().click();
  await expect(replay).toBeHidden();
  await expect(card).toBeHidden();
  // nothing new now; the ⓘ replays the newest steps
  await page.getByRole('button', { name: /What can I do on Company/ }).click();
  await page.getByRole('button', { name: "✨ What's new" }).click();
  await expect(replay.locator('.tour-count')).toBeVisible();
});

test('the 3D office tour has Try it, and its What\'s new card waits for the panels to close', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.request.patch('/api/settings', { data: { tutorialStep: stepsFor('office').findIndex((s) => s.id === 'bell') } });
  await seen(page, null);
  await enterOffice(page);
  const card = page.getByRole('region', { name: 'Tour' });
  await expect(card.locator('.tour-title')).toHaveText('Notifications');
  await expect(page.locator('.tour-ring')).toBeVisible(); // around the HUD's bell
  await card.getByRole('button', { name: 'Open the bell' }).click();
  await expect(card.locator('.tour-title')).toHaveText('Ask the CEO'); // done: it moved on by itself
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Start a /plan' }).click();
  await expect(page.getByRole('dialog', { name: /Your phone/ }).locator('textarea')).toHaveValue(/^Plan the next milestone for floor \d+: $/); // filled, not sent
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Skip tour' }).click();
  await expect(card).toBeHidden();
  await expect(page.getByRole('region', { name: "What's new" })).toHaveCount(0); // skipping counts as seen
});
