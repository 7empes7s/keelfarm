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
  const root = await pocket(page, 'company');
  const warning = root.locator('.us-row .plan-flag-warn').first();
  await warning.scrollIntoViewIfNeeded();
  await warning.click();
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
