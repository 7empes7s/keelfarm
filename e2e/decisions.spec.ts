import { expect, test } from './helpers';

// The chat's "Waiting on you" tray (#114, #183) on a phone: its cards snap whole into view, one per page, a clear
// question each, and tapping one opens it in full. The demo seeds the manager's own case: two long questions about the
// same GitHub payment, the older one replaced.

test('the decisions tray shows each long question whole at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  const root = page.locator('.pocket');
  await expect(root.locator('.pk-tab-on')).toBeVisible();
  const tray = root.getByRole('region', { name: 'Waiting on you' });
  await expect(tray).toBeVisible();
  const row = tray.locator('.decision-row');
  const cards = row.locator('.decision-card');
  await expect(tray.getByText('I fixed the payment or skip Windows CI for now?')).toBeAttached();
  await expect(tray.getByText(/Raised the limit or/)).toHaveCount(0); // replaced by the newer one
  const n = await cards.count();
  expect(n).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < n; i++) {
    await row.evaluate((el, i) => el.scrollTo({ left: i * el.clientWidth + 37, behavior: 'instant' }), i); // a nudge off the snap point
    await expect(tray.locator('.decision-pages')).toContainText(`${i + 1} of ${n}`);
    const [r, c] = [(await row.boundingBox())!, (await cards.nth(i).boundingBox())!];
    expect(c.x).toBeGreaterThanOrEqual(r.x - 1);
    expect(c.x + c.width).toBeLessThanOrEqual(r.x + r.width + 1);
    const q = (await cards.nth(i).locator('.decision-q').innerText()).trim();
    expect(q).toMatch(/^[\p{Lu}\p{N}]/u); // no "- What you need to do:", no word cut in half
    for (const b of await cards.nth(i).locator('.decision-option').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await row.evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' }));
  await cards.first().locator('.decision-q').click();
  const sheet = page.getByRole('dialog', { name: /Waiting on you/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.decision-option').first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
});
