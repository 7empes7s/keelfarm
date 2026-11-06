import type { Page } from '@playwright/test';
import { expect, test } from './helpers';

// The phone app back from the background (#93): iOS leaves a suspended app's /ws half-open, so nothing arrives and
// nothing closes. Coming back to the foreground must reconnect once and show what happened meanwhile, no reload.

declare global {
  interface Window {
    __wsOpened: number;
    __freezeWs: () => void;
  }
}

/** Counts /ws sockets, and lets the test silence the current ones: their messages stop, they never close. */
async function deadSockets(page: Page) {
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    const frozen = new Set<WebSocket>();
    const all: WebSocket[] = [];
    window.__wsOpened = 0;
    window.__freezeWs = () => all.forEach((ws) => frozen.add(ws));
    window.WebSocket = class extends Real {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(String(url)).pathname !== '/ws') return;
        window.__wsOpened++;
        all.push(this);
        // added before the page's own onmessage, so it can swallow the event
        this.addEventListener('message', (e) => frozen.has(this) && e.stopImmediatePropagation());
      }
    };
  });
}

test('back from the background, a silently dead socket reconnects once and the new message shows', async ({ page }) => {
  test.setTimeout(90_000);
  await deadSockets(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  await expect(page.locator('.chat-input textarea')).toBeVisible();
  await expect(page.locator('.pk-dot-on')).toBeVisible();
  expect(await page.evaluate(() => window.__wsOpened)).toBe(1);

  // The app goes to the background and its socket dies quietly; the CEO's chat goes on without it.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.__freezeWs();
  });
  const text = `While you were away ${Date.now()}`;
  const sent = await page.request.post('/api/ceo/message', { data: { text } });
  expect(sent.ok()).toBe(true);
  await page.waitForTimeout(21_000); // longer than a resume trusts a silent socket (RESUME_STALE_MS)
  await expect(page.getByText(text)).toHaveCount(0);

  // Back: every resume event fires together, as on a phone; one reconnect brings the message.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByText(text)).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.pk-dot-on')).toBeVisible();
  expect(await page.evaluate(() => window.__wsOpened)).toBe(2);
});
