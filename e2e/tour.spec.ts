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

/**
 * Where the ring is against the step's controls (#408): the target it rings (±2 px of its rect, the ring's 4 px pad
 * aside), on screen, not covered and not one of the card's own buttons. Null when there's no ring.
 */
async function ringOn(page: Page, targets: readonly string[]) {
  return page.evaluate((ids) => {
    const ring = document.querySelector('.tour-ring');
    if (!ring) return null;
    const r = ring.getBoundingClientRect();
    for (const id of ids)
      for (const el of document.querySelectorAll(`[data-tour="${id}"]`)) {
        const t = el.getBoundingClientRect();
        const off = Math.max(Math.abs(r.left + 4 - t.left), Math.abs(r.top + 4 - t.top), Math.abs(r.width - 8 - t.width), Math.abs(r.height - 8 - t.height));
        if (off > 2) continue;
        // its visible part's middle: only the tour's own card, which moves out of a small control's way, may be over it
        const [top, bottom] = [Math.max(0, t.top), Math.min(innerHeight, t.bottom)];
        const hit = document.elementFromPoint(t.left + t.width / 2, (top + bottom) / 2);
        return { id, inCard: !!el.closest('.tour'), covered: !hit || (!el.contains(hit) && !hit.closest('.tour')), onScreen: bottom - top > 0 && t.left >= 0 && t.right <= innerWidth };
      }
    return { id: null };
  }, targets);
}

/** Walks the whole tour: each step's ring sits on its control, on the page the step opened. */
async function walk(page: Page, track: Track, from = 0) {
  const steps = stepsFor(track);
  const card = page.getByRole('region', { name: 'Tour' });
  for (const [i, s] of steps.entries()) {
    if (i < from) continue;
    await expect(card.locator('.tour-count')).toContainText(`${i + 1}/${steps.length}`);
    await expect(card.locator('.tour-title')).toHaveText(s.title);
    if (s.targets) {
      // the office's walk-through points at the HUD, which a panel may cover: there the card is centred instead
      if (track === 'office') await expect(page.locator('.tour-ring').or(page.locator('.tour-dim'))).toBeVisible();
      else await expect(page.locator('.tour-ring'), `${s.id} has a ring`).toBeVisible();
      await page.waitForTimeout(400); // a page the step opened settles
      const on = await ringOn(page, s.targets);
      if (on) expect(on, `${s.id}'s ring is on its control`).toEqual({ id: expect.any(String), inCard: false, covered: false, onScreen: true });
      else await expect(card).toHaveClass(/tour-at-center/);
    }
    await card.getByRole('button', { name: i === steps.length - 1 ? 'Finish' : /^(Next|Skip step)/ }).click();
  }
  await expect(card).toBeHidden();
  await expect(page.locator('.tour-ring, .tour-dim')).toHaveCount(0);
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
    // Done puts back the page it started on
    await expect(page.locator('.pk-tab-on')).toHaveText(/Company/);
    await expect(page.locator('.pk-settings')).toHaveCount(0);
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
  await page.getByRole('button', { name: "What's new" }).click();
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
  await expect(card.locator('.tour-title')).toHaveText('Sound and captions'); // done: it moved on by itself
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: /^(Next|Skip step)/ }).click();
  await expect(card.locator('.tour-title')).toHaveText('Ask the CEO');
  await card.getByRole('button', { name: 'Start a /plan' }).click();
  await expect(page.getByRole('dialog', { name: /Your phone/ }).locator('textarea')).toHaveValue(/^Plan the next milestone for floor \d+: $/); // filled, not sent
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Skip tour' }).click();
  await expect(card).toBeHidden();
  await expect(page.getByRole('region', { name: "What's new" })).toHaveCount(0); // skipping counts as seen
});

test("the 3D office tour's rings sit on their controls, and Finish puts back what was open", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const from = stepsFor('office').findIndex((s) => s.id === 'search');
  await page.request.patch('/api/settings', { data: { tutorialStep: from } });
  await seen(page, null);
  await enterOffice(page);
  await walk(page, 'office', from);
  await expect(page.getByRole('dialog')).toHaveCount(0); // the chat and console it opened are closed again
});
