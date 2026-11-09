import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers';
import { checkScreens, fromPhone, ON_FLOOR_1, pocket, type Screen } from './helpers';

// An issue card up close (#206), from a Kanban card's #N, in pocket mode and the 3D office: the whole title and body
// readable at a phone's width and a desktop's, nothing cut with "…", no sideways scroll, 44px targets.

const CARD = 'Add dark mode toggle'; // the demo's long issue: sections, a checklist and code

/** The demo's long issue from its Kanban card (its PR's card once it has one). */
async function openCard(page: Page, board: Locator) {
  await board.locator('.kcard', { hasText: CARD }).first().locator('button.linkish').click();
  return page.locator('.cardview');
}

const SCREENS: Screen[] = [
  {
    name: 'PR card actions', widths: [390, 1280], tabs: [],
    open: async (page) => {
      const board = await pocket(page, 'kanban');
      await board.locator('.kcard', { hasText: 'Checkout steps on a phone' }).first().locator('button.linkish').click();
      return page.locator('.cardview');
    },
  },
  { name: 'pocket card', widths: [390, 1280], open: async (page) => openCard(page, await pocket(page, 'kanban')), tabs: [] },
  { name: 'card', widths: [1280], open: async (page) => openCard(page, await fromPhone(page, /Kanban/, /GitHub/, ON_FLOOR_1)), tabs: [] },
];

checkScreens(SCREENS);

for (const width of [390, 1280]) {
  test(`the card's whole title and body are readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const card = await openCard(page, await pocket(page, 'kanban'));
    await expect(card.locator('.cardview-sec').first()).toBeVisible();
    await card.getByRole('button', { name: 'Read all' }).click();
    const problems = await card.evaluate((el) => {
      const out: string[] = [];
      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
      const body = el.querySelector<HTMLElement>('.panel-body')!;
      if (body.scrollWidth > body.clientWidth + 1) out.push(`the panel body scrolls sideways (${body.scrollWidth} > ${body.clientWidth})`);
      const title = el.querySelector<HTMLElement>('.panel-title')!;
      // the demo's title fits either way: it must also wrap, or a longer one would end in "…"
      if (title.scrollWidth > title.clientWidth + 1 || getComputedStyle(title).whiteSpace === 'nowrap') out.push(`the title "${title.textContent}" is cut off`);
      for (const x of el.querySelectorAll<HTMLElement>('.cardview-stat, .cardview-foot .btn, .cardview-sec > summary')) {
        const h = x.getBoundingClientRect().height;
        if (h < 43.5) out.push(`"${x.innerText.trim().slice(0, 40)}" is ${Math.round(h)}px tall`);
      }
      for (const sec of el.querySelectorAll<HTMLDetailsElement>('.cardview-sec')) {
        const name = sec.querySelector('summary')?.textContent;
        const text = sec.querySelector<HTMLElement>(':scope > :not(summary)');
        if (!sec.open || !text?.checkVisibility() || !text.innerText.trim()) out.push(`section "${name}" isn't open after Read all`);
        else if (text.scrollWidth > text.clientWidth + 1) out.push(`section "${name}" is wider than the card`);
      }
      return out;
    });
    expect(problems).toEqual([]);
    expect(await card.locator('.cardview-sec').count()).toBeGreaterThanOrEqual(3); // Why, Build, Acceptance
    await page.screenshot({ path: test.info().outputPath(`card-${width}.png`), fullPage: false });
  });
}
