import { test, expect } from './helpers';
import { CHAT_PAGE } from '../shared/chatPage';

// The CEO chat in pages (#145), on a phone at 4× CPU slowdown with the demo's 500-message thread: it opens on the
// latest page fast, typing a reply stays responsive (INP), and scrolling up loads older pages without a jump.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('the 500-message chat opens fast, types smoothly and loads older pages without a jump', async ({ page }) => {
  await page.goto('/?pocket=1&tab=company');
  await expect(page.locator('.pocket .pk-tab-on')).toBeVisible();
  const pages: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/ceo/messages?')) pages.push(r.url());
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // Opening the chat (the 2 key, as a tab tap): from the press to its bubbles on screen.
  const openMs = await page.evaluate(async () => {
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', key: '2' }));
    while (!document.querySelector('.chat-log [data-msg]')) await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return performance.now() - t0;
  });
  const log = page.locator('.chat-log');
  // The latest page (plus what arrived live since), and no older page fetched on opening.
  expect(await log.locator('[data-msg]').count()).toBeLessThan(CHAT_PAGE + 10);
  await page.waitForTimeout(500);
  expect(pages, 'older pages fetched on opening').toEqual([]);
  expect(openMs, 'opening the chat').toBeLessThan(500);

  // Typing with the reply bar open: the slowest key's interaction stays under 200 ms.
  // A touch screen hides the hover buttons until they have focus (hold or swipe there): the keyboard's way in.
  await log.locator('.bubble-row').last().getByRole('button', { name: 'Reply to this message' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-reply')).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { slowest: number };
    w.slowest = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.slowest = Math.max(w.slowest, e.duration);
    }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
  });
  await page.keyboard.type('Sounds good, go ahead with the plan', { delay: 30 });
  await page.waitForTimeout(500);
  const inp = await page.evaluate(() => (window as unknown as { slowest: number }).slowest);
  expect(inp, 'slowest keystroke (ms)').toBeLessThan(200);

  // Scrolling to the top loads the page before; the message that was first stays where it was.
  for (let pages = 1; pages <= 2; pages++) {
    const before = await log.locator('[data-msg]').count();
    const top = await log.evaluate((el) => {
      el.scrollTop = 0;
      const first = el.querySelector<HTMLElement>('[data-msg]')!;
      return { id: first.dataset.msg, y: first.getBoundingClientRect().top };
    });
    await expect.poll(() => log.locator('[data-msg]').count()).toBeGreaterThan(before);
    const after = await log.evaluate((el, id) => el.querySelector<HTMLElement>(`[data-msg="${id}"]`)!.getBoundingClientRect().top, top.id);
    expect(Math.abs(after - top.y), 'no jump when a page goes in above').toBeLessThan(4);
  }
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

test('the ⋯ menu hides a CEO message and deletes one of mine, each with Undo', async ({ page }) => {
  await page.goto('/?pocket=1&tab=chat');
  const log = page.locator('.chat-log');
  const menu = page.locator('.chat-menu');
  for (const [row, label, notice] of [
    [log.locator('.bubble-row:not(.bubble-row-me)').last(), 'Hide', 'Message hidden'],
    [log.locator('.bubble-row-me').last(), 'Delete', 'Message deleted'],
  ] as const) {
    const id = await row.getAttribute('data-msg');
    await row.getByRole('button', { name: 'Message actions' }).focus();
    await page.keyboard.press('Enter');
    await menu.getByRole('button', { name: label }).click();
    await expect(log.locator(`[data-msg="${id}"]`)).toHaveCount(0);
    await expect(page.locator('.chat-undo')).toContainText(notice);
    await page.locator('.chat-undo').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.chat-undo')).toHaveCount(0);
    await expect(log.locator(`[data-msg="${id}"]`)).toHaveCount(1);
  }
});
