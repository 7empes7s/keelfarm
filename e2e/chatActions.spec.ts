import { type Page } from '@playwright/test';
import { expect, test } from './helpers';

// The CEO chat's composer (#81): one row of +, the message box, the mic and Send (or Stop); the rest behind the +,
// and the chat's buttons in pocket mode's header.

/** A 1x1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function managerTexts(page: Page): Promise<string[]> {
  const state = await (await page.request.get('/api/state')).json();
  return (state.messages as { from: string; text: string }[]).filter((m) => m.from === 'manager').map((m) => m.text);
}

const plus = (page: Page) => page.getByRole('button', { name: /^More: attach/ });
const sheet = (page: Page) => page.getByRole('dialog', { name: /Add to your message/ });
const box = (page: Page) => page.locator('.chat-input textarea');

async function chat(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  await expect(box(page)).toBeVisible();
}

for (const width of [360, 390, 430]) {
  test(`at ${width}px the composer is one row: +, the box, the mic and Send or Stop`, async ({ page }) => {
    await chat(page, width);
    const row = await page.locator('.chat-input').evaluate((form) =>
      [...form.children]
        .filter((x) => (x as HTMLElement).offsetParent !== null)
        .map((x) => {
          const r = x.getBoundingClientRect();
          return { what: x.matches('textarea') ? 'box' : (x.getAttribute('aria-label') ?? x.textContent ?? '').trim().slice(0, 12), top: r.top, bottom: r.bottom, w: r.width, h: r.height };
        }),
    );
    expect(row.map((x) => x.what)).toEqual([expect.stringMatching(/^More/), 'box', expect.anything(), expect.stringMatching(/^(Send|Stop)/)]);
    const [first, ...rest] = row;
    for (const x of rest) expect(x.top < first.bottom && x.bottom > first.top, `${x.what} on the first one's line`).toBe(true);
    for (const x of row) if (x.what !== 'box') expect(Math.min(x.w, x.h), `${x.what} is at least 44px`).toBeGreaterThanOrEqual(43.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    console.log(`chat log at ${width}x844: ${await page.locator('.chat-log').evaluate((el) => Math.round(el.getBoundingClientRect().height))}px`);
  });
}

test('the + sheet attaches a file, Esc closes it, and focus goes back to the +', async ({ page }) => {
  await chat(page);
  await plus(page).click();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  await expect(plus(page)).toBeFocused();
  await expect(page.locator('.pocket')).toBeVisible();

  await plus(page).click();
  const chooser = page.waitForEvent('filechooser');
  await sheet(page).getByRole('button', { name: /Photo or file/ }).click();
  await (await chooser).setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByRole('list', { name: 'Files to send' })).toBeVisible();
});

test.describe('on a touch screen', () => {
  test.use({ isMobile: true, hasTouch: true });
  test('the + sheet opens the camera', async ({ page }) => {
    await chat(page);
    await plus(page).click();
    const chooser = page.waitForEvent('filechooser');
    await sheet(page).getByRole('button', { name: /Camera/ }).click();
    await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('list', { name: 'Files to send' })).toBeVisible();
  });
});

test('Research this sends the typed text with the research prefix, once there is text', async ({ page }) => {
  await chat(page);
  await plus(page).click();
  await expect(sheet(page).getByRole('button', { name: /Research this/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await box(page).fill('Which charting library?');
  await plus(page).click();
  await sheet(page).getByRole('button', { name: /Research this/ }).click();
  await expect.poll(async () => (await managerTexts(page)).at(-1)).toBe('Research: Which charting library?');
  await expect(box(page)).toHaveValue('');
});

test('a quick prompt sends, and the top bar opens conversations, search, artifacts and files', async ({ page }) => {
  await chat(page);
  await plus(page).click();
  await sheet(page).getByRole('button', { name: "What's everyone working on?" }).click();
  await expect.poll(async () => (await managerTexts(page)).at(-1)).toBe("What's everyone working on?");

  const head = page.locator('.pk-head');
  await head.getByRole('button', { name: 'Conversations and search' }).click();
  const conversations = page.getByRole('dialog', { name: 'Conversations' });
  await expect(conversations.getByRole('searchbox', { name: 'Search conversations' })).toBeVisible();
  await conversations.getByRole('button', { name: /remembers/ }).click();
  await expect(page.getByRole('dialog', { name: /remembers/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // The demo CEO's reply carries an artifact; a sent file shows in Files.
  await expect(head.getByRole('button', { name: /^Artifacts \(\d+\)$/ })).toBeVisible({ timeout: 30_000 });
  await head.getByRole('button', { name: /^Artifacts/ }).click();
  await expect(page.getByRole('dialog', { name: /Artifacts/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.request.post('/api/files', { headers: { 'Content-Type': 'image/png', 'X-File-Name': 'f.png' }, data: PNG });
  await head.getByRole('button', { name: /^Files \(\d+\)$/ }).click();
  await expect(page.getByRole('dialog', { name: /^Files/ })).toBeVisible();
});
