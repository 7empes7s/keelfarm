import type { Locator } from '@playwright/test';

// The layout specs' check that everything styled as a button looks like one (#130), kept apart for its size budget.

/** Everything styled as a button, whatever its element (#130): at least 44px tall, its label centred, and the same
 *  height as the buttons beside it in its row. */
export async function buttonRowProblems(root: Locator): Promise<string[]> {
  return root.evaluate((el) => {
    const out: string[] = [];
    const name = (x: Element) => (x.getAttribute('aria-label') || (x as HTMLElement).innerText || x.tagName).trim().slice(0, 40);
    const rows = new Map<Element, DOMRect[][]>(); // per parent, groups of boxes on one line
    const seen = new Map<DOMRect, Element>();
    for (const x of el.querySelectorAll<HTMLElement>(':is(.btn, .ds-btn)')) {
      if (!x.checkVisibility({ visibilityProperty: true }) || x.closest('[role="menu"]') || !x.parentElement) continue;
      const box = x.getBoundingClientRect();
      if (!box.height) continue;
      if (box.height < 43.5) out.push(`${x.tagName.toLowerCase()} "${name(x)}" is ${Math.round(box.height)}px tall, under 44`);
      const range = document.createRange();
      range.selectNodeContents(x);
      const text = range.getBoundingClientRect();
      if (text.height && Math.abs(text.top + text.height / 2 - (box.top + box.height / 2)) > 3) out.push(`${x.tagName.toLowerCase()} "${name(x)}"'s label isn't centred (${Math.round(text.top - box.top)}px above, ${Math.round(box.bottom - text.bottom)}px below)`);
      seen.set(box, x);
      const groups = rows.get(x.parentElement) ?? [];
      const line = groups.find((g) => g.some((b) => b.top < box.bottom && box.top < b.bottom));
      if (line) line.push(box);
      else groups.push([box]);
      rows.set(x.parentElement, groups);
    }
    for (const groups of rows.values())
      for (const line of groups) {
        const tallest = line.reduce((a, b) => (b.height > a.height ? b : a));
        for (const b of line) if (tallest.height - b.height > 1) out.push(`"${name(seen.get(b)!)}" is ${Math.round(b.height)}px tall beside "${name(seen.get(tallest)!)}" at ${Math.round(tallest.height)}px`);
      }
    return out;
  });
}
