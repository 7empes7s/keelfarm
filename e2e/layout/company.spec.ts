import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers';
import { buttonRowProblems } from '../buttonRows';
import { pocket } from './helpers';

// The Company page at every width the page itself gets (#223): the chat open or closed and the browser's zoom only
// change that width. Whole "What's new" tiles at one height, the summary row filling its width with cards of one height
// (#345), floor footers on one line, the callout on one line, Board and Team on one row, one status row at most, and no
// sideways scroll.

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
    // the summary row (#345): no empty track, every row ending at the floors' right edge, cards in a row at one height
    const side = el.querySelector('.pk-company-side')!.getBoundingClientRect();
    const rows = new Map<number, DOMRect[]>();
    for (const card of el.querySelectorAll('.pk-company-side > *')) {
      const box = card.getBoundingClientRect();
      if (box.height) rows.set(Math.round(box.top), [...(rows.get(Math.round(box.top)) ?? []), box]);
    }
    for (const boxes of side.width ? rows.values() : []) {
      const right = Math.max(...boxes.map((b) => b.right));
      if (Math.abs(right - side.right) > 1) out.push(`the summary row ends ${Math.round(side.right - right)}px short of its column`);
      if (Math.max(...boxes.map((b) => b.height)) - Math.min(...boxes.map((b) => b.height)) > 1) out.push('summary cards in a row differ in height');
    }
    // a card stretched to the usage card's height had its content centred far below its top: a blank box (#513)
    for (const card of el.querySelectorAll('.pk-company-side > .pk-summary')) {
      const gap = card.firstElementChild!.getBoundingClientRect().top - card.getBoundingClientRect().top;
      if (gap > 40) out.push(`the ${card.className} card's content starts ${Math.round(gap)}px below its top`);
    }
    const floorsBox = el.querySelector('.pk-company-floors')!.getBoundingClientRect();
    if (side.width && side.top < floorsBox.top && Math.abs(side.right - floorsBox.right) > 1) out.push('the summary row and the floors end at different right edges');
    // floor cards in a row: footers on one line, "What's new" tiles at one height
    const feet = new Map<number, number[]>();
    for (const card of el.querySelectorAll('.pk-floor')) {
      const top = Math.round(card.getBoundingClientRect().top);
      feet.set(top, [...(feet.get(top) ?? []), card.querySelector('.pk-floor-foot')!.getBoundingClientRect().top]);
    }
    for (const tops of feet.values()) if (Math.max(...tops) - Math.min(...tops) > 2) out.push(`floor card footers differ by ${Math.round(Math.max(...tops) - Math.min(...tops))}px`);
    for (const row of el.querySelectorAll('.pk-floor .fb-row')) {
      const heights = [...row.querySelectorAll('.fb-card')].map((t) => t.getBoundingClientRect().height);
      if (heights.length && Math.max(...heights) - Math.min(...heights) > 1) out.push('"What\'s new" tiles in a row differ in height');
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

for (const width of [1278, 1280, 1440, 1600, 1920])
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
