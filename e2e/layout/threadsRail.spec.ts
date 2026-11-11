import { expect, test } from '../helpers';

// The threads column beside the docked chat (#396): it folds to a rail and back, remembered after a reload, and while
// the Threads sheet is open it steps aside, so one list is on screen.
test('the threads column folds to a rail and steps aside for the Threads sheet at 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?pocket=1');
  const dock = page.locator('.pk-dock');
  const column = dock.getByRole('navigation', { name: 'Threads' });
  await expect(column.getByRole('button', { name: /New thread/ })).toBeVisible();
  await column.getByRole('button', { name: 'Hide the threads' }).click();
  const show = column.getByRole('button', { name: /^Show the threads/ });
  await expect(show).toBeVisible();
  expect((await column.boundingBox())!.width).toBeLessThan(60);
  await page.reload();
  await expect(show).toBeVisible();
  await show.click();
  await expect(column.getByRole('button', { name: 'Hide the threads' })).toBeVisible();

  await dock.getByRole('button', { name: 'Threads and search' }).click();
  const sheet = page.getByRole('dialog', { name: /^Threads$/ });
  await expect(sheet).toBeVisible();
  await expect(column).toBeHidden();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(column.getByRole('button', { name: 'Hide the threads' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
