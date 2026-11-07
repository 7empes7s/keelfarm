import { expect, test } from '../helpers';
import { checkScreens, fromPhone, OFFICE, ON_FLOOR_1, pocket, POCKET, type Screen } from './helpers';

// The Kanban board, in pocket mode and the 3D office, and its cards at every column width (#100).

const SCREENS: Screen[] = [
  { name: 'pocket kanban', widths: POCKET, open: (page) => pocket(page, 'kanban'), tabs: [] },
  { name: 'kanban', widths: OFFICE, open: (page) => fromPhone(page, /Kanban/, /GitHub/, ON_FLOOR_1), tabs: [] },
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
