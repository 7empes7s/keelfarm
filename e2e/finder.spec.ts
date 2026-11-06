import { enterOffice, expect, test } from './helpers';

// Finding things and learning the office (#109): the search palette, the guide, ⓘ sheets and empty states that teach.

test('the search finds a setting and runs an action from the phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1');
  await page.getByRole('button', { name: /Search everything/ }).click();
  const box = page.getByRole('combobox', { name: 'Search everything' });
  await box.fill('telegram');
  await page.getByRole('option', { name: /Turn on Telegram/ }).click();
  await expect(page.locator('.pk-console').getByRole('heading', { name: /Notifications/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Search everything/ }).click();
  await box.fill('ask the ceo to plan');
  await page.keyboard.press('Enter');
  await expect(page.locator('textarea')).toHaveValue(/^Plan the next milestone for/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Ctrl+K opens the search in the 3D office, and the guide ticks from the office', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterOffice(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Search everything' })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Guide: \d of 8 done/ }).click();
  const sheet = page.getByRole('dialog', { name: /Get the most out of the office/ });
  await expect(sheet.locator('[data-done="true"]').first()).toBeVisible(); // the demo's charters and experiments
  await expect(sheet.getByRole('button', { name: /^Do it/ }).first()).toBeVisible();
});

test("no empty list shows bare text: each says what, why and what's next", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=approvals');
  const empties = page.locator('[data-empty]');
  // the demo's boards and lists that start empty
  for (const tab of ['Approvals', 'Kanban']) {
    await page.locator('.pk-tabs').getByRole('button', { name: tab }).click();
    for (const e of await empties.all()) {
      await expect(e.locator('b')).not.toBeEmpty();
      await expect(e.getByRole('button')).toBeVisible();
    }
  }
  await expect(page.locator('.kempty, .pk-page').getByText(/^(Nothing here|None\. Nice\.|No projects yet\.)$/)).toHaveCount(0);
});
