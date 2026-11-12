import type { Page } from '@playwright/test';
import { expect, overflowProblems, test } from './helpers';

// Settings → Providers' Rename and tags (#523): a key's name and tags saved on the server, the Used for filter, and
// each row's last test and Used by, on a phone and a desktop.

const OLD_NAME = 'Cerebras (CEREBRAS_API_KEY_PAID, LiteLLM litellm.env)';

/** Settings → Providers by its deep link (docs/deep-links.md), at a phone's or a desktop's width. */
async function providers(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?pocket=1#settings/providers');
  await page.waitForSelector('html[data-route-ready]');
  const section = page.locator('.pv-page');
  await expect(section).toBeVisible();
  await page.waitForLoadState('networkidle'); // lazy chunks in before the reload
  return section;
}

for (const width of [390, 1280]) {
  test(`a key is renamed and tagged, kept through a reload, and filtered by Used for at ${width}px`, async ({ page }) => {
    const added = await (await page.request.post('/api/providers', { data: { provider: 'cerebras', key: `csk-e2e-paid-${width}-00001234`, label: OLD_NAME } })).json();
    try {
      let section = await providers(page, width);
      await section.getByRole('button', { name: `More for ${OLD_NAME}` }).click();
      await page.getByRole('menuitem', { name: /Rename and tags/ }).click();
      const sheet = page.getByRole('dialog', { name: `Edit ${OLD_NAME}` });
      await sheet.getByLabel('Name').fill('Cerebras paid');
      await sheet.getByLabel('Tags').fill('inference');
      await expect(sheet.getByRole('radio', { name: /AI inference/ })).toBeChecked(); // its category's default
      await sheet.getByRole('button', { name: 'Save' }).click();
      await expect(sheet).toHaveCount(0);

      await page.reload();
      section = await providers(page, width);
      const card = section.locator('.pv-card').filter({ has: page.locator('.ds-row-title', { hasText: /^Cerebras paid$/ }) });
      await expect(card.locator('.chip', { hasText: 'inference' })).toBeVisible();
      await expect(card).toContainText('Last test: Live');
      await expect(card).toContainText('Used for: AI inference');
      await expect(card).toContainText('Used by: Nothing uses it yet');
      // every key's row says its last test and what uses it
      for (const row of await section.locator('.pv-group .pv-card').all()) await expect(row).toContainText('Used by:');

      await section.getByLabel('Used for').selectOption('operations');
      const titles = section.locator('.pv-card .ds-row-title');
      await expect(titles.filter({ hasText: /^Cloudflare$/ })).toBeVisible();
      await expect(titles.filter({ hasText: /^GitHub token$/ })).toBeVisible();
      await expect(titles.filter({ hasText: /^(OpenAI API|Cerebras paid|OpenRouter)$/ })).toHaveCount(0);
      for (const row of await section.locator('.pv-card').all()) await expect(row).toContainText(/Used for: (Operations|Both)/);
      // the dead old Cloudflare key beside the live one, removable in one tap (after a confirm)
      await expect(section.locator('.pv-card').filter({ hasText: 'Cloudflare (old)' }).getByRole('button', { name: 'Remove this dead one' })).toBeVisible();
      expect(await overflowProblems(section)).toEqual([]);
    } finally {
      await page.request.delete(`/api/providers/${added.id}`);
    }
  });
}
