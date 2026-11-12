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

// Providers by what they do (#533): the capability tiles with their defaults and gaps, Cloudflare's guided add with the
// pre-filled token link and the Account ID, and the demo's fake Google sign-in lighting up four capabilities at once.
for (const width of [390, 1280]) {
  test(`the page opens on capabilities, guides a Cloudflare token and signs in with Google at ${width}px`, async ({ page }) => {
    const section = await providers(page, width);
    const caps = section.getByRole('region', { name: 'What the office can do' });
    await expect(caps.getByRole('region', { name: 'Text capability' })).toContainText('Default');
    await expect(caps.getByRole('region', { name: 'Text capability' })).toContainText('Fallback');
    await expect(caps.getByRole('region', { name: 'Publishing capability' })).toContainText('No publishing provider: add one');
    expect(await overflowProblems(section)).toEqual([]);

    // Cloudflare: the key kind in one line, the token page with its permissions, and the Account ID
    await section.getByRole('button', { name: 'Add provider' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add provider' });
    await sheet.getByRole('button', { name: /^Cloudflare/ }).click();
    const cf = page.getByRole('dialog', { name: 'Add Cloudflare' });
    await expect(cf).toContainText('not the Global API Key');
    const link = cf.getByRole('link', { name: /permissions filled in/ });
    expect(await link.getAttribute('href')).toContain('permissionGroupKeys');
    await cf.getByLabel('Account ID').fill('0123456789abcdef0123456789abcdef');
    expect(await link.getAttribute('href')).toContain('/0123456789abcdef0123456789abcdef/api-tokens');
    expect(await overflowProblems(cf)).toEqual([]);
    await cf.getByRole('button', { name: 'Close' }).click();

    // Google: the scopes in plain words, then the fake consent, and Text, Image, Video and Publishing light up together
    await caps.getByRole('region', { name: 'Publishing capability' }).getByRole('button', { name: 'Add publishing' }).click();
    await page.getByRole('dialog', { name: 'Add publishing' }).getByRole('button', { name: /Sign in with Google/ }).click();
    const google = page.getByRole('dialog', { name: 'Add Google' });
    await expect(google.getByRole('group', { name: 'What Google is asked for' })).toContainText('Upload videos to your YouTube channel');
    const popup = page.waitForEvent('popup');
    await google.getByRole('button', { name: 'Sign in with Google' }).click();
    await expect((await popup).getByRole('heading', { name: 'Signed in to Google' })).toBeVisible();
    for (const cap of ['Text', 'Image', 'Video', 'Publishing']) await expect(caps.getByRole('region', { name: `${cap} capability` })).toContainText('Google');
    await expect(caps.getByRole('region', { name: 'Publishing capability' })).not.toContainText('No publishing provider');

    await section.getByRole('button', { name: 'More for Google' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await page.getByRole('alertdialog', { name: 'Remove Google?' }).getByRole('button', { name: 'Remove' }).click();
    await expect(caps.getByRole('region', { name: 'Publishing capability' })).toContainText('No publishing provider: add one');
  });
}
