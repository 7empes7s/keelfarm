import { expect, test } from '@playwright/test';

// Expected 503 on the first upload: this spec checks recovery, so it doesn't use helpers.ts's no-HTTP-errors fixture.
for (const width of [390, 1280]) {
  test(`retry keeps upload progress and restored draft attachments at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    let attempts = 0;
    await page.route('**/api/files', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, json: { error: 'Upload interrupted. Try again.' } });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return route.fulfill({ json: { id: '0123456789abcdef01234567', name: 'plan.txt', type: 'text/plain', size: 4, from: 'manager', at: Date.now(), keep: false } });
    });
    await page.goto('/?pocket=1&tab=chat');
    await page.locator('.chat-input input[type="file"]:not([capture])').setInputFiles({ name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('plan') });
    const retry = page.getByRole('button', { name: 'Retry the upload of plan.txt' });
    await expect(retry).toBeVisible();
    const size = (await retry.boundingBox())!;
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
    await retry.click();
    await expect(page.getByRole('progressbar', { name: 'Uploading plan.txt' })).toBeVisible();
    await expect(page.locator('.attach-item .small.muted')).toHaveText('4 B');
    await page.reload();
    await expect(page.locator('.attach-item')).toHaveCount(1);
    await expect(page.locator('.attach-item')).toContainText('plan.txt');
    await expect(page.locator('.attach-item .small.muted')).toHaveText('4 B');
    expect(attempts).toBe(2);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
