import { expect, test } from '../helpers';
import { pocket } from './helpers';

// The CEO chat's screen audit (#514): one test per bug it fixed.

// A long chat unread: the CEO's tab badge says 99+ and stays on its icon.
test('at 390px a chat with hundreds unread says 99+ on its badge (#514)', async ({ page }) => {
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((data) => {
      if (typeof data !== 'string') return ws.send(data);
      const ev = JSON.parse(data);
      if (ev.type === 'snapshot') {
        const last = ev.data.messages.at(-1);
        ev.data.messages.push(...Array.from({ length: 150 }, (_, i) => ({ id: last.id + 1 + i, from: 'ceo', text: `Update ${i}`, at: Date.now() - 1000 + i })));
        ev.data.phoneReadAt = 0;
      }
      ws.send(JSON.stringify(ev));
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await pocket(page, 'company');
  const badge = page.locator('.pk-tabs .pk-tab').filter({ hasText: /Morgan|CEO/ }).locator('.badge-dot');
  await expect(badge).toHaveText('99+');
  const [b, icon] = await Promise.all([badge.boundingBox(), badge.locator('xpath=..').boundingBox()]);
  expect(b!.x + b!.width).toBeLessThanOrEqual(390);
  expect(b!.x).toBeLessThan(icon!.x + icon!.width); // still on its icon
});

// The Company thread's bar cuts its title and floors to one line: a tap shows them whole, another folds them back.
test('the Company thread bar shows its whole title and floors on a tap at 390px (#514)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const root = await pocket(page, 'chat');
  const bar = root.locator('.thread-bar .thread-project');
  await expect(bar).toHaveAttribute('aria-expanded', 'false');
  const meta = bar.locator('.thread-project-meta');
  const cut = (el: Element) => el.scrollWidth > el.clientWidth + 1;
  const name = bar.locator('.thread-project-name');
  expect((await name.evaluate(cut)) || (await meta.evaluate(cut))).toBe(true); // the demo's thread is long enough to cut
  await bar.click();
  await expect(bar).toHaveAttribute('aria-expanded', 'true');
  expect(await name.evaluate(cut)).toBe(false);
  expect(await meta.evaluate(cut)).toBe(false);
  await bar.click();
  await expect(bar).toHaveAttribute('aria-expanded', 'false');
});
