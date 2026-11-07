import { devices, type Page } from '@playwright/test';
import { expect, test } from './helpers';

// No forced reload after an office update (#216): a draft and its attachment stay put while the office comes back on
// a new commit, the header offers "New version · Update", the next tab change loads it with the draft kept, and an
// outbox a killed page left behind is sent once.

/** A 1x1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** Marks this page: the mark is gone once it reloads. */
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { __page: number }).__page = 1));
const marked = (page: Page) => page.evaluate(() => (window as unknown as { __page?: number }).__page === 1);

/** Writes the chat's outbox as a page killed mid-send leaves it (drafts.ts's IndexedDB store). */
function seedOutbox(page: Page, outbox: object[]) {
  return page.evaluate(
    (outbox) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('cubefarm-drafts', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const t = req.result.transaction('kv', 'readwrite');
          t.objectStore('kv').put(outbox, 'outbox');
          t.oncomplete = () => (req.result.close(), resolve());
          t.onerror = () => reject(t.error);
        };
      }),
    outbox,
  );
}

test.describe('an office update', () => {
  test.use({ isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent, viewport: { width: 390, height: 844 } });

  test('keeps the draft and its file, offers the new version, and loads it on the next tab change', async ({ page }) => {
    await page.goto('/?pocket=1&tab=chat');
    const box = page.locator('.chat-input textarea');
    await page.locator('.chat-input input[type="file"]:not([capture])').setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.attach-item .small.muted')).toHaveCount(1); // uploaded
    await box.fill('Half-written message about the update');
    await mark(page);

    await page.request.post('/api/demo/office-update');
    const pill = page.getByRole('button', { name: 'New version · Update' });
    await expect(pill).toBeVisible();
    expect(await marked(page), 'no reload').toBe(true);
    await expect(box).toHaveValue('Half-written message about the update');
    await expect(page.locator('.attach-item')).toHaveCount(1);

    // The pill waits while there's a draft, and says so.
    await pill.click();
    await expect(page.getByText(/you have an unsent message/)).toBeVisible();
    expect(await marked(page)).toBe(true);

    // A tab change is the safe moment: the new version loads there, and the draft is still there.
    await page.locator('.pk-tabs').getByRole('button', { name: 'Company' }).click();
    await expect.poll(() => marked(page).catch(() => false)).toBe(false);
    await expect(page.locator('.pk-tab-on')).toContainText('Company');
    await expect(pill).toBeHidden();
    await page.locator('.pk-tabs [data-tour="chat"]').click();
    await expect(page.locator('.chat-input textarea')).toHaveValue('Half-written message about the update');
    await expect(page.locator('.attach-item')).toHaveCount(1);
  });

  test('sends what a killed page left in the outbox once, and not what the office already has', async ({ page }) => {
    await page.goto('/?pocket=1&tab=chat');
    await expect(page.locator('.chat-input textarea')).toBeVisible();
    // One send reached the office before the page died; the other never left.
    await page.request.post('/api/ceo/message', { data: { text: 'Arrived before the crash', clientId: 'e2e-arrived' } });
    const at = Date.now();
    await seedOutbox(page, [
      { key: 1, clientId: 'e2e-arrived', text: 'Arrived before the crash', at, delivery: 'sending' },
      { key: 2, clientId: 'e2e-lost', text: 'Lost in the crash', at, delivery: 'sending' },
    ]);
    await page.reload();
    const log = page.locator('.chat-log');
    await expect(log.getByText('Lost in the crash', { exact: true })).toHaveCount(1);
    await expect(log.getByText('Arrived before the crash', { exact: true })).toHaveCount(1);
    await page.waitForTimeout(1500); // a duplicate would have arrived by now
    await expect(log.getByText('Lost in the crash', { exact: true })).toHaveCount(1);
    await expect(log.getByText('Arrived before the crash', { exact: true })).toHaveCount(1);
  });
});
