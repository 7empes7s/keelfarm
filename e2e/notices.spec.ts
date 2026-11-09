import { expect, overflowProblems, test } from './helpers';
import { pocket } from './layout/helpers';

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
