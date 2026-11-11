import type { Locator } from '@playwright/test';
import { expect, overflowProblems, test } from './helpers';

// The IT desk (#506) on a phone: the demo CEO checks the machine and puts two clean-ups on cards; Run runs one and its
// output comes to the chat, Not now drops the other.
test('IT desk cards: Run executes and posts the output, Not now dismisses, at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  expect((await page.request.post('/api/ceo/message', { data: { text: 'Check the machine and tell me where to gain space' } })).ok()).toBe(true);

  const desk = page.locator('.it-desk');
  const logs = desk.locator('.it-card').filter({ hasText: 'journalctl --vacuum-size=500M' });
  const images = desk.locator('.it-card').filter({ hasText: 'docker image prune -af' });
  await expect(logs).toBeVisible({ timeout: 30_000 });
  await expect(logs).toContainText('Old system logs take 3.9 GB');
  await expect(logs).toContainText('Low risk');
  await expect(images).toBeVisible();
  await expect(desk.getByRole('button', { name: 'Run all 2' })).toBeVisible();
  expect(await overflowProblems(page.locator('body'))).toEqual([]);

  await logs.getByRole('button', { name: 'Run' }).click();
  await expect(logs).toHaveCount(0);
  const posted = page.locator('.notice-card').filter({ hasText: 'Ran `journalctl --vacuum-size=500M`' }).last();
  await expect(posted).toBeVisible();
  await posted.locator('summary').click();
  await expect(posted.locator('pre')).toContainText('freed 3.4G');

  await images.getByRole('button', { name: 'Not now' }).click();
  await expect(desk).toHaveCount(0);
  const state = await (await page.request.get('/api/state')).json();
  expect(state.itDesk.waiting).toEqual([]);
  expect(state.itDesk.log.slice(0, 2).map((e: { argv: string[]; code: number | null }) => [e.argv[0], e.code])).toEqual([['docker', null], ['journalctl', 0]]);
});

// With the "Waiting on you" tray full, the IT desk strip gives way: the message box and every card's Run / Not now stay
// above the bottom bar, and its header folds it to one row.
test('IT desk strip never pushes the message box or its buttons under the bottom bar, with decisions waiting, at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  await expect(page.getByRole('region', { name: 'Waiting on you' })).toBeVisible();
  expect((await page.request.post('/api/ceo/message', { data: { text: 'Check the machine and tell me where to gain space' } })).ok()).toBe(true);
  const desk = page.locator('.it-desk');
  const cards = desk.locator('.it-card');
  await expect(cards).toHaveCount(2, { timeout: 30_000 });

  const bar = (await page.locator('.pk-tabs').boundingBox())!;
  const above = async (el: Locator) => {
    await expect(el).toBeInViewport();
    const b = (await el.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(bar.y + 1);
  };
  const box = page.locator('.chat-input').getByRole('textbox');
  await above(box);
  for (const card of await cards.all())
    for (const name of ['Run', 'Not now']) {
      const button = card.getByRole('button', { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await above(button);
      await button.click({ trial: true }); // nothing covers it
    }
  await above(box);
  expect(await overflowProblems(page.locator('body'))).toEqual([]);

  await desk.getByRole('button', { name: 'Hide the commands' }).click();
  await expect(cards).toHaveCount(0);
  await desk.getByRole('button', { name: 'Show the commands' }).click();
  await cards.filter({ hasText: 'docker image prune -af' }).getByRole('button', { name: 'Not now' }).click();
  await expect(cards).toHaveCount(1);
  await above(box);
});
