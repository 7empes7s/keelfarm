import { expect, overflowProblems, test } from './helpers';

// The IT department (#524): its chat answers from it_run, its proposals come as cards with Run / Not now, and its
// setup saves the account and model it runs on. At a phone's width and a computer's.

for (const width of [390, 1280]) {
  test(`IT department: chat answers from it_run, cards with Run / Not now, setup saves, at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1#ceo/it-dept');
    const chat = page.getByRole('region', { name: /^IT chat with / });
    await expect(chat).toBeVisible();

    const box = chat.getByRole('textbox', { name: /^Message / });
    await box.fill('How much disk is free?');
    await chat.getByRole('button', { name: 'Send' }).click();
    await expect(chat.locator('.bubble-row').filter({ hasText: 'How much disk is free?' })).toBeVisible();
    await expect(chat).toContainText(/free of 150G/, { timeout: 30_000 });
    const state = await (await page.request.get('/api/state')).json();
    expect(state.itDesk.log.some((e: { argv: string[] }) => e.argv.join(' ') === 'df -h')).toBe(true);

    await chat.getByRole('button', { name: /Free up space/ }).click();
    const card = chat.locator('.it-card').filter({ hasText: 'journalctl --vacuum-size=500M' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Not now' })).toBeVisible();
    expect(await overflowProblems(page.locator('body'))).toEqual([]);
    await chat.locator('.it-card').filter({ hasText: 'docker image prune -af' }).getByRole('button', { name: 'Not now' }).click();
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(chat.locator('.it-card')).toHaveCount(0);
    await expect(chat).toContainText(/Checked after `journalctl --vacuum-size=500M`/, { timeout: 30_000 });

    const setup = page.getByRole('region', { name: 'The IT department' });
    await setup.getByLabel('Account').selectOption('claude-apikey');
    await expect.poll(async () => (await (await page.request.get('/api/state')).json()).settings.itDept.account).toBe('claude-apikey');
    if (width >= 900) {
      await setup.getByLabel("IT's model").selectOption('claude-haiku-5-5');
      await expect.poll(async () => (await (await page.request.get('/api/state')).json()).settings.itDept.model).toBe('claude-haiku-5-5');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

// IT monitoring (#525): the Health card lists each check with its state; a low disk wakes IT, whose recommendation's
// first option runs from the card and the before/after comes back in the chat.
for (const width of [390, 1280]) {
  test(`IT department: Health lists checks, a recommendation runs from its card, at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1#ceo/it-dept');
    const health = page.getByRole('region', { name: 'Health' });
    await expect(health).toBeVisible();
    await health.getByRole('button', { name: 'Simulate low disk' }).click();
    const checks = health.getByRole('list', { name: 'Health checks' });
    await expect(checks.locator('.it-check-bad').filter({ hasText: 'Disk' })).toBeVisible({ timeout: 30_000 });
    await expect(checks.locator('.it-check').filter({ hasText: 'Services' })).toBeVisible();
    const card = health.getByRole('article', { name: /^Recommendation: Disk/ });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole('button', { name: /^Run option/ })).toHaveCount(3);
    expect(await overflowProblems(page.locator('body'))).toEqual([]);
    await card.getByRole('button', { name: 'Run option 1: Remove unused Docker images' }).click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('region', { name: /^IT chat with / })).toContainText(/Before: .*\(bad\) → after: .*\(good\)/, { timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
