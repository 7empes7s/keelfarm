// Kanban columns fold (#154): a phone opens with the Backlog and Merged folded, so In progress is on the first screen
// even behind 30 issues, and the manager's choice survives a reload; side by side, a folded column is a narrow strip.
import type { Page } from '@playwright/test';
import { expect, test } from './helpers';

/** Pocket mode's Kanban tab. */
async function kanban(page: Page) {
  await page.goto('/?pocket=1&tab=kanban');
  const root = page.locator('.pocket');
  await expect(root.locator('.pk-tab-on')).toBeVisible();
  return root;
}

test('a phone folds the Backlog: In progress on the first screen, the choice kept', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await (await page.request.get('/api/state')).json();
  const repo = state.repos[0] as { id: string; issues: unknown[] };
  for (let i = repo.issues.length; i < 30; i++) await page.request.post(`/api/repos/${encodeURIComponent(repo.id)}/issues`, { data: { title: `Backlog filler ${i}`, body: '' } });
  const root = await kanban(page);
  const head = (cls: string) => root.locator(`.${cls} .kcol-head`);
  await expect(head('kcol-backlog')).toHaveAttribute('aria-expanded', 'false');
  await expect(head('kcol-merged')).toHaveAttribute('aria-expanded', 'false');
  await expect(head('kcol-progress')).toHaveAttribute('aria-expanded', 'true');
  await expect(head('kcol-progress')).toBeInViewport();
  await expect(head('kcol-qa')).toBeInViewport();
  expect(Number(await head('kcol-backlog').locator('.count').innerText())).toBeGreaterThanOrEqual(30);
  await expect(head('kcol-backlog').locator('.kcol-summary')).toContainText(/ready/);
  const box = (await head('kcol-backlog').boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);

  await head('kcol-backlog').click();
  await expect(head('kcol-backlog')).toHaveAttribute('aria-expanded', 'true');
  await expect(root.locator('.kcol-backlog .kcard').first()).toBeVisible();
  await page.reload();
  await expect(head('kcol-backlog')).toHaveAttribute('aria-expanded', 'true');

  // the jump row stays on top and opens the column it goes to
  const jump = root.getByRole('navigation', { name: 'Kanban columns' });
  await jump.getByRole('button', { name: /^Merged/ }).click();
  await expect(head('kcol-merged')).toHaveAttribute('aria-expanded', 'true');
  await expect(head('kcol-merged')).toBeInViewport();
  await expect(jump).toBeInViewport();
  expect(await page.evaluate(() => [...document.querySelectorAll('html, .pk-main')].every((el) => el.scrollWidth <= el.clientWidth))).toBe(true);
});

test('side by side, a folded column is a narrow strip', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  const root = await kanban(page);
  const backlog = root.locator('.kcol-backlog');
  await expect(backlog.locator('.kcol-head')).toHaveAttribute('aria-expanded', 'true');
  await expect(root.getByRole('navigation', { name: 'Kanban columns' })).toHaveCount(0);
  await backlog.locator('.kcol-head').click();
  await expect(backlog.locator('.kcol-head')).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await backlog.boundingBox())!.width).toBeLessThan(60);
  await expect(backlog.locator('.kcol-head')).toContainText('Backlog');
  const progress = (await root.locator('.kcol-progress').boundingBox())!;
  expect(progress.y).toBeLessThan(400); // still beside it, not under it
  await backlog.locator('.kcol-head').click();
  await expect.poll(async () => (await backlog.boundingBox())!.width).toBeGreaterThan(150);
});
