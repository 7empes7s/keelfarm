import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers';
import { buttonRowProblems } from '../buttonRows';
import { pocket } from './helpers';

// The Company page at every width the page itself gets (#223): the chat open or closed and the browser's zoom only
// change that width. Whole "What's new" tiles, side cards at their own height, the callout on one line, Board and Team
// on one row, one status row at most, and no sideways scroll.

/** Problems on the Company page as it is now. */
async function companyProblems(root: Locator): Promise<string[]> {
  const out = await root.evaluate((el) => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    const main = el.querySelector('.pk-main')!;
    if (main.scrollWidth > main.clientWidth + 1) out.push(`the page's column scrolls sideways (${main.scrollWidth} > ${main.clientWidth})`);
    for (const row of el.querySelectorAll('.pk-floor .fb-row')) {
      const r = row.getBoundingClientRect();
      for (const tile of row.querySelectorAll('.fb-card')) {
        const t = tile.getBoundingClientRect();
        const inside = t.left >= r.left - 1 && t.right <= r.right + 1;
        const outside = t.left >= r.right - 1 || t.right <= r.left + 1;
        if (!inside && !outside) out.push(`a "What's new" tile is cut off (${Math.round(t.left)}–${Math.round(t.right)} in ${Math.round(r.left)}–${Math.round(r.right)})`);
      }
    }
    // a side card no taller than what's in it plus its padding: never stretched to its neighbours
    for (const card of el.querySelectorAll<HTMLElement>('.pk-company-side > *')) {
      const box = card.getBoundingClientRect();
      if (!box.height) continue;
      const range = document.createRange();
      range.selectNodeContents(card);
      const content = range.getBoundingClientRect();
      const css = getComputedStyle(card);
      if (box.height <= (parseFloat(css.minHeight) || 0) + 1) continue; // a 44px target centres its label
      const room = parseFloat(css.paddingBottom) + parseFloat(css.borderBottomWidth) + 4;
      if (box.bottom - content.bottom > room) out.push(`side card .${card.className.split(' ')[0]} is ${Math.round(box.bottom - content.bottom)}px taller than its content`);
    }
    const callout = el.querySelector('.pk-callout');
    const label = callout?.querySelector('.pk-callout-text');
    if (callout && label && callout.getBoundingClientRect().width >= 400) {
      const range = document.createRange();
      range.selectNodeContents(label);
      const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
      if (lines.size > 1) out.push(`the callout's label takes ${lines.size} lines`);
      const go = callout.querySelector('.pk-callout-go')!;
      if (go.getClientRects().length !== 1 || go.getBoundingClientRect().height > 30) out.push('"Approvals ›" splits from its chevron');
    }
    for (const card of el.querySelectorAll('.pk-floor')) {
      if (card.getBoundingClientRect().width < 340) continue;
      const [board, team] = [...card.querySelectorAll('.pk-floor-foot .btn')].map((b) => b.getBoundingClientRect());
      const text = card.querySelector('.pk-floor-foot > .muted')!.getBoundingClientRect();
      if (Math.abs(board.top - team.top) > 1 || text.bottom < board.top || text.top > board.bottom) out.push('a floor card\'s footer wraps onto two rows');
      for (const label of card.querySelectorAll<HTMLElement>('.pk-stage-label'))
        if (label.scrollWidth > label.clientWidth + 1) out.push(`the "${label.textContent}" chip is cut off`);
    }
    if (el.querySelectorAll('.pk-status .pk-banner').length > 1) out.push('more than one status row');
    return out;
  });
  return [...out, ...(await buttonRowProblems(root.locator('.pk-page').first()))];
}

/** Company, the chat docked or hidden (remembered per device), at this viewport. */
async function company(page: Page, width: number, chat: boolean) {
  await page.addInitScript((open) => localStorage.setItem('cubefarm:pocket-chat', open ? '1' : '0'), chat);
  await page.setViewportSize({ width, height: 900 });
  const root = await pocket(page, 'company');
  await expect(root.locator('.pk-floor').first()).toBeVisible();
  await page.waitForTimeout(300); // the floors' columns follow their measured width
  return root;
}

const mainWidth = (root: Locator) => root.locator('.pk-main').evaluate((m) => m.getBoundingClientRect().width);

for (const width of [1280, 1440, 1920])
  for (const chat of [true, false])
    test(`Company at ${width}px, chat ${chat ? 'open' : 'closed'}`, async ({ page }) => {
      const root = await company(page, width, chat);
      expect(await companyProblems(root)).toEqual([]);
    });

// The page's own widths: the viewport, with the chat closed, sized so the column beside the rail is this wide.
for (const target of [900, 1000, 1100, 1250, 1400, 1600, 1800])
  test(`Company with ${target}px of page width`, async ({ page }) => {
    let root = await company(page, target + 100, false);
    const rail = target + 100 - (await mainWidth(root));
    await page.setViewportSize({ width: Math.round(target + rail), height: 900 });
    root = await pocket(page, 'company');
    await page.waitForTimeout(300);
    expect(Math.abs((await mainWidth(root)) - target)).toBeLessThan(2);
    expect(await companyProblems(root)).toEqual([]);
    // from 1100px the side column sits beside the floors, below it the cards are a strip above them
    const side = (await root.locator('.pk-company-side').boundingBox())!;
    const floors = (await root.locator('.pk-company-floors').boundingBox())!;
    if (target >= 1100) expect(side.x).toBeGreaterThan(floors.x + floors.width - 1);
    else expect(side.y + side.height).toBeLessThanOrEqual(floors.y + 1);
  });

test('Company at 390px', async ({ page }) => {
  const root = await company(page, 390, false);
  expect(await companyProblems(root)).toEqual([]);
});
