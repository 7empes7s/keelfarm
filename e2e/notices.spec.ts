import { expect, overflowProblems, test } from './helpers';
import { office, pocket } from './layout/helpers';

// The notification centre (#298): every notice a cell of its own with a visible edge, title and time on one line,
// unread ones marked, at a phone's width and a desktop's; Reply on the CEO's opens the chat.

for (const width of [390, 1280]) {
  test(`at ${width}px each notification is a separate cell and Reply opens the chat (#298)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const root = await pocket(page, 'company');
    await root.getByRole('button', { name: /^Notifications/ }).click();
    const centre = page.locator('.notice-centre');
    await expect(centre).toBeVisible();
    // the demo's mix: a CEO message, pacing, an office update and a PR that needs you
    for (const title of [/^Morgan/, 'Pacing new work', /^The office's update/, /needs you/]) await expect(centre.locator('.notice-row', { has: page.locator('.notice-title', { hasText: title }) }).first()).toBeVisible();

    const problems = await centre.evaluate((root) => {
      const out: string[] = [];
      const seen = (c: string) => c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c);
      for (const list of root.querySelectorAll('.notice-group ul')) {
        const css = getComputedStyle(list);
        const edged = parseFloat(css.borderTopWidth) > 0 && css.borderTopStyle !== 'none' && seen(css.borderTopColor);
        const rows = [...list.querySelectorAll(':scope > .notice-row')];
        rows.forEach((row, i) => {
          const name = row.querySelector('.notice-title')?.textContent;
          const r = getComputedStyle(row);
          const own = parseFloat(r.borderTopWidth) > 0 && r.borderTopStyle !== 'none' && seen(r.borderTopColor) && parseFloat(r.borderBottomWidth) > 0;
          if (!own && !edged) out.push(`${name}: no edge of its own or of its group`);
          if (i === 0) return;
          const prev = rows[i - 1].getBoundingClientRect();
          const gap = row.getBoundingClientRect().top - prev.bottom;
          const divider = parseFloat(r.borderTopWidth) >= 1 && r.borderTopStyle !== 'none' && seen(r.borderTopColor);
          if (!(own && gap >= 8) && !divider) out.push(`${name}: no divider or 8px gap from the one above (gap ${gap}px)`);
        });
      }
      for (const row of root.querySelectorAll('.notice-row')) {
        const title = row.querySelector('.notice-title')!.getBoundingClientRect();
        const time = row.querySelector('time')!.getBoundingClientRect();
        if (time.top >= title.bottom || time.bottom <= title.top) out.push(`${row.querySelector('.notice-title')?.textContent}: the time isn't on the title's line`);
      }
      return out;
    });
    expect(problems).toEqual([]);
    await expect(centre.locator('.notice-row.notice-unread .notice-dot').first()).toBeVisible();
    expect(await overflowProblems(centre)).toEqual([]);

    await centre.locator('.notice-row', { hasText: 'Morgan' }).first().getByRole('button', { name: 'Reply' }).click();
    await expect(page.getByPlaceholder(/Message .*…|Write your reply…/)).toBeVisible();
  });
}

// The bell's count (#499): fully visible beside the Sound button, with a few unread and with 99+, in pocket mode's
// header (compact and wide) and the 3D HUD's pills.
const unread = (n: number) => (data: string) => {
  const ev = JSON.parse(data);
  ev.data.notices = Array.from({ length: n }, (_, i) => ({ id: `e2e-${i}`, at: Date.now() - i, kind: 'ceo', level: 'info', title: `Note ${i}`, text: '', read: false }));
  return JSON.stringify(ev);
};
for (const where of ['pocket', 'office'] as const)
  for (const width of [390, 1280])
    for (const [count, shown] of [[3, '3'], [120, '99+']] as const)
      test(`${where} at ${width}px: the bell's count of ${shown} isn't under its neighbour (#499)`, async ({ page }) => {
        await page.routeWebSocket(/\/ws$/, (ws) => {
          const server = ws.connectToServer();
          server.onMessage((data) => {
            if (typeof data !== 'string') return ws.send(data);
            const ev = JSON.parse(data);
            if (ev.type === 'toast' && ev.id) return; // the demo's new notices would change the count
            ws.send(ev.type === 'snapshot' ? unread(count)(data) : data);
          });
        });
        await page.setViewportSize({ width, height: 844 });
        if (where === 'pocket') await pocket(page, 'company');
        else await office(page);
        const badge = page.locator('.notice-bell .badge-dot');
        await expect(badge).toHaveText(shown);
        const problem = await badge.evaluate((el) => {
          const b = el.getBoundingClientRect();
          if (b.left < 0 || b.top < 0 || b.right > innerWidth) return `off screen: ${JSON.stringify(b)}`;
          const next = el.closest('.notice-bell')!.nextElementSibling;
          const n = next?.getBoundingClientRect();
          const overlaps = n && n.width && b.right > n.left && b.left < n.right && b.bottom > n.top && b.top < n.bottom;
          if (!overlaps) return '';
          for (const [x, y] of [[b.left + 1, b.top + b.height / 2], [b.right - 1, b.top + b.height / 2], [b.left + b.width / 2, b.top + b.height / 2]]) {
            const top = document.elementFromPoint(x, y);
            if (!top || !el.contains(top)) return `covered at ${x},${y} by ${top?.outerHTML.slice(0, 80)}`;
          }
          return '';
        });
        expect(problem).toBe('');
      });
