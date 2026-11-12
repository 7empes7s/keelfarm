import type { Page, TestInfo } from '@playwright/test';
import { enterOffice, expect, test, TUTORIALS_INVITE_KEY } from './helpers';
import { TUTORIALS, type Tutorial } from '../client/src/ui/tutorials';

// The task tutorials (#517): each one runs from its first step to Done on demo data, every step moving on only after
// its action (a tap on the ringed control, or a sent message), Resume after a reload continuing at the same step, and
// the hub and Get started offering them. Each step's screenshot is kept in the test's output for QA, never committed.

const KEY = 'cubefarm:tutorials';

/** This device's tutorial progress at the first load (null: none yet), and whether Get started was put off. */
async function progress(page: Page, value: object | null, invited = true) {
  await page.addInitScript(
    ([key, v, inviteKey, inv]) => {
      if (sessionStorage.getItem('tut-test')) return;
      sessionStorage.setItem('tut-test', '1');
      if (v === null) localStorage.removeItem(key);
      else localStorage.setItem(key, v);
      if (inv) localStorage.setItem(inviteKey, '1');
      else localStorage.removeItem(inviteKey);
    },
    [KEY, value && JSON.stringify(value), TUTORIALS_INVITE_KEY, invited] as const,
  );
}

const card = (page: Page) => page.locator('.tour-task');

/** Taps a control inside the step's ring, as the manager would: its first visible enabled button, fold or field. */
async function useRingedControl(page: Page) {
  const found = await page.evaluate(() => {
    document.querySelector('[data-e2e-tap]')?.removeAttribute('data-e2e-tap');
    const sels = (document.querySelector('.tour-task')?.getAttribute('data-targets') ?? '').split('\n').filter(Boolean);
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, Math.max(0, r.top) / 2 + Math.min(innerHeight, r.bottom) / 2);
      return !!hit && (el.contains(hit) || hit.contains(el));
    };
    for (const sel of sels)
      for (const ring of document.querySelectorAll(sel)) {
        if (ring.closest('.tour')) continue;
        const controls = [ring, ...ring.querySelectorAll('button:not([disabled]), summary, select, input, label')].filter((el) => el.matches('button:not([disabled]), summary, select, input, label') && shown(el));
        if (controls[0]) {
          controls[0].setAttribute('data-e2e-tap', '1');
          return true;
        }
      }
    return false;
  });
  expect(found, 'a control to tap in the ring').toBe(true);
  await page.locator('[data-e2e-tap]').click();
  if (await page.getByRole('alertdialog').isVisible()) await page.keyboard.press('Escape'); // Merge anyway? asks first
}

/** Runs `t` from the step it's on to Done: each step waits for its action, then moves on. */
async function runThrough(page: Page, t: Tutorial, info: TestInfo, tag: string, from = 0) {
  for (const [i, s] of t.steps.entries()) {
    if (i < from) continue;
    const c = card(page);
    await expect(c).toHaveAttribute('data-step', s.id, { timeout: 30_000 });
    await expect(c.locator('.tour-count')).toContainText(`${i + 1}/${t.steps.length}`);
    await expect(page.locator('.tour-task-ring.tour-ring'), `${t.id}/${s.id} rings its control`).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(700); // the page settles; nothing has been done yet, so it must still be here
    await expect(c).toHaveAttribute('data-step', s.id);
    await expect(c).not.toHaveAttribute('data-done', '1');
    await page.screenshot({ path: info.outputPath(`${tag}-${t.id}-${i + 1}-${s.id}.png`) });
    if (s.done === 'sent') {
      const box = page.locator('.chat-input textarea').first();
      await box.fill(`${await box.inputValue()}a dark mode`);
      await box.press('Enter');
    } else await useRingedControl(page);
    await expect(c).toHaveAttribute('data-done', '1');
    if (s.stay) await c.getByRole('button', { name: /^(Next|Finish)/ }).click();
  }
  await expect(card(page)).toHaveAttribute('data-step', 'done');
  await page.screenshot({ path: info.outputPath(`${tag}-${t.id}-done.png`) });
  await card(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('.tour-task-ring')).toHaveCount(0);
}

/** Starts a tutorial from a ⓘ sheet's hub (pocket mode's Company tab). */
async function startFromHub(page: Page, title: string, verb: 'Start' | 'Resume' = 'Start') {
  await page.getByRole('button', { name: /What can I do on Company/ }).click();
  await page.locator('.info-sheet').getByRole('button', { name: `${verb} ${title}` }).click();
}

for (const [where, width] of [
  ['phone', 390],
  ['desktop', 1280],
] as const) {
  for (const t of TUTORIALS) {
    test(`pocket mode (${where}): ${t.title} runs from its first step to Done [${where}-${t.id}]`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await progress(page, null);
      await page.goto('/?pocket=1&tab=company');
      await startFromHub(page, t.title);
      await runThrough(page, t, info, where);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // the hub has it done
      await page.goto('/?pocket=1&tab=company');
      await page.getByRole('button', { name: /What can I do on Company/ }).click();
      await expect(page.locator(`.info-sheet [data-tutorial-row="${t.id}"]`)).toContainText(`${t.steps.length}/${t.steps.length}`);
      await expect(page.locator('.info-sheet').getByRole('button', { name: `Restart ${t.title}` })).toBeVisible();
    });
  }
}

test('Resume after a reload continues at the same step, and Back and Close work', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await progress(page, null);
  await page.goto('/?pocket=1&tab=company');
  const t = TUTORIALS.find((x) => x.id === 'running')!;
  await startFromHub(page, t.title);
  await expect(card(page)).toHaveAttribute('data-step', t.steps[0].id);
  await card(page).getByRole('button', { name: 'Skip step' }).click();
  await expect(card(page)).toHaveAttribute('data-step', t.steps[1].id);
  await card(page).getByRole('button', { name: /Back/ }).click();
  await expect(card(page)).toHaveAttribute('data-step', t.steps[0].id);
  await card(page).getByRole('button', { name: 'Skip step' }).click();
  await expect(card(page)).toHaveAttribute('data-step', t.steps[1].id);
  await page.reload();
  await expect(card(page)).toHaveAttribute('data-step', t.steps[1].id);
  // Close keeps the place: the hub resumes it there
  await card(page).getByRole('button', { name: 'Close' }).click();
  await expect(card(page)).toHaveCount(0);
  await page.goto('/?pocket=1&tab=company');
  await startFromHub(page, t.title, 'Resume');
  await runThrough(page, t, info, 'resume', 1);
});

test('the first launch offers Get started, and Not now puts it away', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.patch('/api/settings', { data: { tutorialStep: -1 } });
  await progress(page, null, false);
  await page.goto('/?pocket=1&tab=company');
  const invite = page.getByRole('region', { name: 'Get started' });
  await expect(invite).toBeVisible();
  await invite.getByRole('button', { name: 'Start' }).click();
  await expect(card(page)).toHaveAttribute('data-tutorial', 'start');
  await card(page).getByRole('button', { name: 'Close' }).click();
  await expect(invite).toHaveCount(0); // started: the hub has it now
  await page.goto('/?pocket=1&tab=company');
  await expect(page.getByRole('region', { name: 'Get started' })).toHaveCount(0);
});

test('the 3D office runs a tutorial end to end', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const t = TUTORIALS.find((x) => x.id === 'needs-you')!;
  await page.request.patch('/api/settings', { data: { tutorialStep: -1 } }); // the first-run tour is over
  await progress(page, { at: { [t.id]: { step: 0, done: false } }, running: t.id });
  await enterOffice(page);
  await runThrough(page, t, info, '3d');
});
