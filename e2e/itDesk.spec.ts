import type { Locator, Page } from '@playwright/test';
import { expect, overflowProblems, test } from './helpers';

// The IT desk (#506) on a phone: the demo CEO checks the machine and puts two clean-ups on cards; in the chat they wait
// behind one row's Review, in a sheet. Run runs one and its output comes to the chat, Not now drops the other.

const ask = async (page: Page) =>
  expect((await page.request.post('/api/ceo/message', { data: { text: 'Check the machine and tell me where to gain space' } })).ok()).toBe(true);

test('IT desk cards: Run executes and posts the output, Not now dismisses, at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  await ask(page);

  const strip = page.getByRole('region', { name: 'IT desk: commands waiting for you' });
  await expect(strip).toContainText('asks to run 2 commands', { timeout: 30_000 });
  await strip.getByRole('button', { name: 'Review' }).click();
  const sheet = page.getByRole('dialog', { name: /asks to run/ });
  const logs = sheet.locator('.it-card').filter({ hasText: 'journalctl --vacuum-size=500M' });
  const images = sheet.locator('.it-card').filter({ hasText: 'docker image prune -af' });
  await expect(logs).toContainText('Old system logs take 3.9 GB');
  await expect(logs).toContainText('Low risk');
  await expect(images).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Run all 2' })).toBeVisible();
  expect(await overflowProblems(page.locator('body'))).toEqual([]);

  await logs.getByRole('button', { name: 'Run' }).click();
  await expect(logs).toHaveCount(0);
  await images.getByRole('button', { name: 'Not now' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(strip).toHaveCount(0);

  const posted = page.locator('.notice-card').filter({ hasText: 'Ran `journalctl --vacuum-size=500M`' }).last();
  await expect(posted).toBeVisible();
  await posted.locator('summary').click();
  await expect(posted.locator('pre')).toContainText('freed 3.4G');
  const state = await (await page.request.get('/api/state')).json();
  expect(state.itDesk?.waiting ?? []).toEqual([]);
  expect(state.itDesk.log.slice(0, 2).map((e: { argv: string[]; code: number | null }) => [e.argv[0], e.code])).toEqual([['docker', null], ['journalctl', 0]]);
});

// The real case: the "Waiting on you" tray full (six or more) and left open. The IT desk row, the
// message box and every card's Run / Not now stay above the bottom bar.
test('IT desk never pushes the message box or its buttons under the bottom bar, with the decisions tray open, at 390px', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  const tray = page.getByRole('region', { name: 'Waiting on you' });
  await expect.poll(() => tray.locator('.decision-card').count(), { timeout: 90_000 }).toBeGreaterThanOrEqual(6);
  await ask(page);

  const bar = (await page.locator('.pk-tabs').boundingBox())!;
  const above = async (el: Locator) => {
    await expect(el).toBeInViewport();
    const b = (await el.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(bar.y + 1);
  };
  const strip = page.getByRole('region', { name: 'IT desk: commands waiting for you' });
  await expect(strip).toContainText('asks to run 2 commands', { timeout: 30_000 });
  const box = page.locator('.chat-input').getByRole('textbox');
  await above(box);
  await above(strip.getByRole('button', { name: 'Review' }));
  expect(await overflowProblems(page.locator('body'))).toEqual([]);

  const sheet = page.getByRole('dialog', { name: /asks to run/ });
  await strip.getByRole('button', { name: 'Review' }).click();
  await sheet.getByRole('button', { name: 'Close' }).click(); // × closes it, the row stays
  await expect(sheet).toHaveCount(0);
  await strip.getByRole('button', { name: 'Review' }).click();
  await sheet.locator('.it-card').filter({ hasText: 'docker image prune -af' }).getByRole('button', { name: 'Not now' }).click();
  await expect(sheet.locator('.it-card')).toHaveCount(1);
  await sheet.locator('.it-card').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(strip).toHaveCount(0);
  await expect(tray).toBeVisible(); // left open throughout
  await above(box);
});
