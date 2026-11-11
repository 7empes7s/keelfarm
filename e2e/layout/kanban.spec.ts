import { expect, test } from '../helpers';
import { buttonRowProblems } from '../buttonRows';
import { checkScreens, fromPhone, OFFICE, ON_FLOOR_1, pocket, POCKET, type Screen } from './helpers';

// The Kanban board, in pocket mode and the 3D office, and its cards at every column width (#100).

const SCREENS: Screen[] = [
  { name: 'pocket kanban', widths: POCKET, open: (page) => pocket(page, 'kanban'), tabs: [] },
  { name: 'kanban', widths: OFFICE, open: (page) => fromPhone(page, /Kanban/, /GitHub/, ON_FLOOR_1), tabs: [] },
  // Assign to… (#265): the floor's agents in an action sheet, free first
  {
    name: 'pocket assign sheet',
    widths: POCKET,
    open: async (page) => {
      await (await pocket(page, 'kanban')).locator('.kcol-backlog').getByRole('button', { name: /^Assign issue #/ }).first().click();
      return page.locator('.assign-sheet');
    },
    tabs: [],
  },
];

checkScreens(SCREENS);

// Every card at every column width, from the desktop board's narrowest to a phone's one column: nothing in it wider
// than the card, no button's label clipped.
for (const width of [390, 1280]) {
  test(`Kanban cards fit their columns at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1&tab=kanban');
    await expect(page.locator('.kcol-progress .kcard button').first()).toBeVisible({ timeout: 30_000 }); // an agent's card, with Terminal
    const problems: string[] = [];
    for (const col of [210, 250, 320]) {
      if (col > width - 40) continue;
      problems.push(
        ...(await page.evaluate((col) => {
          const out: string[] = [];
          for (const k of document.querySelectorAll<HTMLElement>('.kanban')) k.style.gridTemplateColumns = `repeat(5, ${col}px)`;
          for (const card of document.querySelectorAll<HTMLElement>('.kcard')) {
            const r = card.getBoundingClientRect();
            const name = card.querySelector('.kcard-title')?.textContent?.trim().slice(0, 30);
            if (card.scrollWidth > card.clientWidth + 1) out.push(`${col}px: "${name}" overflows its card (${card.scrollWidth} > ${card.clientWidth}px)`);
            for (const b of card.querySelectorAll<HTMLElement>('button')) {
              const br = b.getBoundingClientRect();
              if (b.scrollWidth > b.clientWidth + 1) out.push(`${col}px: "${b.innerText.trim()}" on "${name}" is clipped`);
              if (br.right > r.right + 1 || br.left < r.left - 1) out.push(`${col}px: "${b.innerText.trim()}" on "${name}" sticks out of the card`);
            }
          }
          return out;
        }, col)),
      );
    }
    expect(problems).toEqual([]);
  });
}

// One card anatomy (#232, #410): nothing past the card's box, no two cards over each other, the title its own line of at
// most 3, the action bar Open · GitHub first and ⋯ last, its buttons one height. Wide, with the CEO chat open too.
for (const [width, chat] of [[390, false], [1280, false], [1280, true], [1920, false], [1920, true]] as const) {
  test(`Kanban cards keep one anatomy at ${width}px${chat ? ', chat open' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const root = await pocket(page, 'kanban');
    const dock = root.locator('.pk-dock');
    if (chat && !(await dock.isVisible())) await root.locator('.pk-chat-btn').click();
    if (!chat && (await dock.isVisible())) await dock.getByRole('button', { name: 'Hide the chat' }).click();
    await expect(page.locator('.kcol-qa .kbar').first()).toBeVisible({ timeout: 30_000 });
    // a folded column's cards are clipped to nothing, not hidden from checkVisibility(): open them all, let the folds settle
    const shut = page.locator('.kcol-shut .kcol-head');
    for (let n = await shut.count(); n > 0; n--) await shut.first().click();
    await expect(shut).toHaveCount(0);
    await page.waitForFunction(() => !document.getAnimations().some((a) => a instanceof CSSTransition && (a.effect as KeyframeEffect | null)?.target?.closest('.kanban')));
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const cards = [...document.querySelectorAll<HTMLElement>('.kcard')].filter((c) => c.checkVisibility());
      const boxes = cards.map((c) => c.getBoundingClientRect());
      cards.forEach((card, i) => {
        const r = boxes[i];
        const name = card.querySelector('.kcard-title')?.textContent?.trim().slice(0, 30);
        for (const el of card.querySelectorAll<HTMLElement>(':scope > *, .agent-chip, .kcard-who-text, .kbar > *')) {
          const b = el.getBoundingClientRect();
          if (b.width && (b.left < r.left - 1 || b.right > r.right + 1 || b.bottom > r.bottom + 1)) out.push(`"${name}": .${el.className.split(' ')[0]} runs out of the card`);
        }
        for (let j = i + 1; j < cards.length; j++) {
          const o = boxes[j];
          if (r.left < o.right - 1 && o.left < r.right - 1 && r.top < o.bottom - 1 && o.top < r.bottom - 1) out.push(`"${name}" overlaps another card`);
        }
        const title = card.querySelector<HTMLElement>('.kcard-title')!;
        const lh = parseFloat(getComputedStyle(title).lineHeight);
        if (title.getBoundingClientRect().height > lh * 3 + 2) out.push(`"${name}": its title runs past 3 lines`);
        if (title.querySelector('a, button')) out.push(`"${name}": a link inside its title`);
        const row = card.querySelector<HTMLElement>('.kbar');
        if (!row) {
          out.push(`"${name}" has no action bar`);
          return;
        }
        const items = [...row.children] as HTMLElement[];
        if (!(items[0]?.getAttribute('aria-label') ?? '').startsWith('Open') || !(items[1]?.getAttribute('aria-label') ?? '').startsWith('GitHub')) out.push(`"${name}": its bar doesn't start Open, GitHub`);
        if (items.length > 5) out.push(`"${name}" shows ${items.length} items on its bar`);
        if (card.closest('.kcol-qa, .kcol-review') && !items.at(-1)!.classList.contains('ds-menu-wrap')) out.push(`"${name}": ⋯ isn't last in its action bar`);
        const heights = new Set(items.map((x) => Math.round(x.getBoundingClientRect().height)));
        if (heights.size > 1) out.push(`"${name}": its bar's buttons differ in height`);
      });
      return out;
    });
    expect(problems).toEqual([]);
    expect(await buttonRowProblems(page.locator('.kanban'))).toEqual([]);
  });
}
