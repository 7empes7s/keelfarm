import { expect, test } from '../helpers';
import { pocket } from './helpers';

// What screen audit 1/4 (#513) found on the pocket pages, each checked where it showed. The Company page's summary
// cards are in company.spec.ts.

test('approvals: each count in the summary stays on one line with its label', async ({ page }) => {
  for (const width of [320, 340, 360, 375, 390, 410, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const root = await pocket(page, 'approvals');
    const split = await root.locator('.apr-progress p').evaluate((p) => {
      // the summary's words, each text node's characters mapped back to it, then every "N label" measured as one range
      const nodes: Text[] = [];
      const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) nodes.push(walk.currentNode as Text);
      const at = nodes.flatMap((n) => [...n.data].map((_, i) => [n, i] as const));
      const text = nodes.map((n) => n.data).join('');
      const out: string[] = [];
      for (const m of text.slice(text.indexOf('·')).matchAll(/\d+ [^·]+?(?= ·|$)/g)) {
        const start = text.indexOf('·') + m.index!;
        const range = document.createRange();
        range.setStart(...at[start]);
        range.setEnd(at[start + m[0].length - 1][0], at[start + m[0].length - 1][1] + 1);
        if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) out.push(m[0]);
      }
      return out;
    });
    expect(split, `at ${width}px`).toEqual([]);
  }
});

test("a usage card's plan warning opens the card like the rest of it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Mission control lists every source; Company's card shows only the worst four, which may not hold the warning.
  await page.goto('/?pocket=1#company/ops');
  await expect(page.locator('html[data-route-ready="1"]')).toBeAttached();
  const warning = page.locator('#ops-card-sources .us-row .plan-flag-warn').first(); // not Company's card under it
  // The warning lets taps fall through to its card's button: in the middle of the screen (the list re-sorts as
  // readings arrive, and bars sit at its edges), its centre hits that button, and a tap there opens the card.
  const spot = () =>
    warning.evaluate((w) => {
      w.scrollIntoView({ block: 'center' });
      const r = w.getBoundingClientRect();
      const [x, y] = [r.x + r.width / 2, r.y + r.height / 2];
      const hit = document.elementFromPoint(x, y);
      return hit?.matches('.us-open') && hit.closest('.us-row') === w.closest('.us-row') ? { x, y } : null;
    });
  await expect.poll(spot, { message: "the warning's centre hits its card's button" }).not.toBeNull();
  const at = (await spot())!;
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.us-sheet')).toBeVisible();
});

test("pocket mode's switch rows read in order: the label, then its hint, then the switch", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1#sound');
  await expect(page.locator('html[data-route-ready="1"]')).toBeAttached();
  const row = page.locator('label.toggle', { hasText: 'Agents speak when clicked' });
  await expect(row).toBeVisible();
  const { label, hint, toggle } = await row.evaluate((el) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text: Text | null = null;
    while (!text && walk.nextNode()) if ((walk.currentNode as Text).data.includes('Agents speak when clicked')) text = walk.currentNode as Text;
    const range = document.createRange();
    range.selectNodeContents(text!);
    const box = (r: DOMRect) => ({ left: r.left, right: r.right });
    const words = [...el.querySelectorAll('span')].find((s) => s.textContent!.startsWith(' · a short line'))!;
    return { label: box(range.getBoundingClientRect()), hint: box(words.getBoundingClientRect()), toggle: box(el.querySelector('input')!.getBoundingClientRect()) };
  });
  expect(label.left, 'the label starts the row').toBeLessThanOrEqual(hint.left + 1);
  expect(Math.max(label.right, hint.right), 'the words end before the switch').toBeLessThanOrEqual(toggle.left);
});

test("a merged PR's card says where its QA went, with one Merged chip", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { repos } = (await (await page.request.get('/api/state')).json()) as { repos: { floor: number; pulls: { number: number; state: string }[] }[] };
  const floor = repos.find((r) => r.pulls.some((p) => p.state === 'MERGED'))!;
  const pr = floor.pulls.find((p) => p.state === 'MERGED')!.number;
  await page.goto(`/?pocket=1#pr/${floor.floor}/${pr}`);
  await expect(page.locator('html[data-route-ready="1"]')).toBeAttached();
  const card = page.locator('.cardview');
  await expect(card).toBeVisible();
  await expect(card).not.toContainText(/not sent yet|not in QA yet|Not sent to QA/);
  await expect(card.locator('.dp-chips').first().getByText('Merged', { exact: true })).toHaveCount(1);
});

test("Kanban's new issue form at 390px: the picker's choice shows whole, Cancel isn't the green go button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const root = await pocket(page, 'kanban');
  await root.getByRole('button', { name: '+ New issue' }).click();
  const picker = root.getByRole('combobox', { name: 'Who works on it' });
  await expect(picker).toBeVisible();
  const { text, room } = await picker.evaluate((el: HTMLSelectElement) => {
    const css = getComputedStyle(el);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    // the closed picker shows its choice between its padding and the arrow (about 24px)
    return { text: ctx.measureText(el.selectedOptions[0].text).width, room: el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) - 24 };
  });
  expect(text, 'the choice fits the picker').toBeLessThanOrEqual(room);
  await expect(root.getByRole('button', { name: 'Cancel' })).not.toHaveClass(/btn-good/);
});
