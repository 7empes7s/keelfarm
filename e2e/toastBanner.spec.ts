import type { Locator, Page, WebSocketRoute } from '@playwright/test';
import { expect, test } from './helpers';
import { dialog, office } from './layout/helpers';

// Toasts drop in at the top like a phone's banner (#521): while the manager types in the CEO chat, a success, an error
// and a notice toast come in at the top, the composer keeps its focus and its text, a tap beside them reaches what's
// under them, and they go with a swipe up or ✕. In pocket mode (the chat on a phone, docked on a computer) and in the
// 3D office's phone, at a phone's width and a computer's.

/** Our toasts only (the demo's own come and go): returns the sender for the page's websocket. */
async function ownToasts(page: Page) {
  let client: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    client = ws;
    const server = ws.connectToServer();
    server.onMessage((data) => {
      if (typeof data === 'string' && JSON.parse(data).type === 'toast') return;
      ws.send(data);
    });
  });
  return (ev: object) => client!.send(JSON.stringify({ type: 'toast', ...ev }));
}

const NOTICE = { id: 'e2e-banner', kind: 'ceo', at: Date.now(), level: 'info', title: 'From the CEO', text: 'A word about floor 1', read: false };

async function check(page: Page, send: (ev: object) => void, composer: Locator) {
  await composer.click();
  await composer.fill('half a thought');
  send({ level: 'success', text: 'Merged #12' });
  send({ level: 'error', text: 'The push failed' });
  send(NOTICE);
  const toasts = page.locator('.toasts');
  await expect(toasts.locator('.notice-toast')).toBeVisible();
  await expect(toasts.locator('.toast-error')).toBeVisible();
  await expect(toasts.locator('.notice-more'), 'two show, the rest collapse').toHaveText('+1 more');
  await page.waitForTimeout(800); // useToastSpot's next tick

  const vh = await page.evaluate(() => innerHeight);
  for (const el of await toasts.locator(':scope > *').all()) {
    const r = (await el.boundingBox())!;
    expect(r.y, 'on screen').toBeGreaterThanOrEqual(0);
    expect(r.y + r.height, 'in the top part of the screen').toBeLessThanOrEqual(vh / 2);
  }
  const [stack, input] = [(await toasts.boundingBox())!, (await composer.boundingBox())!];
  expect(stack.y + stack.height, 'above the composer').toBeLessThanOrEqual(input.y);
  await expect(composer, 'the keyboard stays up').toBeFocused();
  await expect(composer).toHaveValue('half a thought');

  // between two toasts: whatever is under them takes the tap
  const gap = await toasts.evaluate((el) => {
    const [a, b] = [...el.children].map((c) => c.getBoundingClientRect());
    const x = a.left + a.width / 2;
    const y = (a.bottom + b.top) / 2;
    return el.contains(document.elementFromPoint(x, y));
  });
  expect(gap, 'the gap between toasts is not theirs').toBe(false);

  // swiped up (a touch drag), the error goes; ✕ takes the notice away
  const error = toasts.locator('.toast-error');
  const e = (await error.boundingBox())!;
  const at = { pointerType: 'touch', pointerId: 7, isPrimary: true, bubbles: true, clientX: e.x + e.width / 2 };
  await error.dispatchEvent('pointerdown', { ...at, clientY: e.y + e.height / 2 });
  await error.dispatchEvent('pointermove', { ...at, clientY: e.y + e.height / 2 - 80 });
  await error.dispatchEvent('pointerup', { ...at, clientY: e.y + e.height / 2 - 80 });
  await expect(error).toHaveCount(0);
  await toasts.locator('.notice-toast').getByRole('button', { name: 'Dismiss' }).click();
  await expect(toasts.locator('.notice-toast')).toHaveCount(0);
}

for (const width of [390, 1280]) {
  test(`pocket mode at ${width}px: toasts drop in at the top and never get in the way of typing (#521)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    const send = await ownToasts(page);
    await page.goto(`/?pocket=1&tab=${width === 390 ? 'chat' : 'company'}`); // on a computer the chat is docked
    const composer = page.locator('.pocket .chat-input textarea').first();
    await expect(composer).toBeVisible();
    await check(page, send, composer);
    if (width === 1280) {
      send({ level: 'success', text: 'Beside the chat' });
      const [t, dock] = await Promise.all([page.locator('.toasts .toast-success').boundingBox(), page.locator('.pk-dock').boundingBox()]);
      expect(t!.x + t!.width, 'left of the docked chat').toBeLessThanOrEqual(dock!.x);
    }
  });

  test(`the 3D office's phone at ${width}px: toasts drop in at the top and never get in the way of typing (#521)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    const send = await ownToasts(page);
    await office(page);
    await page.getByTitle(/^Your phone/).click();
    const phone = dialog(page, /Your phone/);
    if (!(await phone.locator('.chat-input').isVisible())) await phone.locator('.phone-tab').first().click(); // it opens on Team when a team change waits there
    await check(page, send, phone.locator('.chat-input textarea'));
  });
}
