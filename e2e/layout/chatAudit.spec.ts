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

// The CEO's suggested replies were 30px pills: each is a 44px tap, its icon and words centred in it.
test("the CEO's suggestion chips are 44px taps with centred words at 390px (#514)", async ({ page }) => {
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((data) => {
      if (typeof data !== 'string') return ws.send(data);
      const ev = JSON.parse(data);
      if (ev.type === 'snapshot') ev.data.messages.push({ id: ev.data.messages.at(-1).id + 1, from: 'ceo', text: 'Shall I file it?', at: Date.now(), suggestions: ['File it', 'Not now'] });
      ws.send(JSON.stringify(ev));
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const root = await pocket(page, 'chat');
  const chips = root.locator('.suggestion-chip');
  await expect(chips).toHaveCount(2);
  for (const chip of await chips.all()) {
    const [box, icon] = await Promise.all([chip.boundingBox(), chip.locator('svg').boundingBox()]);
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
    expect(Math.abs(icon!.y + icon!.height / 2 - (box!.y + box!.height / 2))).toBeLessThan(2);
  }
});

// The 3D phone's chat kept four tools beside the CEO and cut their name to "Morg…": the name stays whole.
test("the 3D phone's chat shows the CEO's whole name at 390px (#514)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=0#phone/chat');
  await expect(page.locator('html')).toHaveAttribute('data-route-ready', '1', { timeout: 30_000 });
  const who = page.getByRole('dialog', { name: 'Your phone' }).locator('.chat-who');
  await expect(who).toBeVisible();
  const [name, box] = await Promise.all([who.locator('b').boundingBox(), who.boundingBox()]);
  expect(name!.x + name!.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5);
});
