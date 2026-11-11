import type { Locator, Page } from '@playwright/test';
import { sectionsIn } from '../../client/src/ui/consoleNavRules';
import { expect, overflowProblems, test } from '../helpers';
import { dialog, pocketSection } from './helpers';

// Screen audit 3/4 (#515): every Settings section on a 390px phone, and the bugs the audit fixed, each its own test.

const LONG_NAME = 'OpenRouter key for the whole company team, production use'; // 57 of the 60 a name may have

async function pocketSettings(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?pocket=1');
  await page.getByRole('button', { name: 'Settings and notifications' }).click();
  return dialog(page, /Settings/);
}

/** What a section shows wrong without moving anything: a cut-off title, a switch row read out of order, "undefined". */
function sectionProblems(root: Locator) {
  return root.evaluate((el) => {
    const out: string[] = [];
    const title = el.querySelector<HTMLElement>('.cn-title');
    if (title && (title.scrollWidth > title.clientWidth + 1 || title.scrollHeight > title.clientHeight + 1)) out.push(`the title "${title.innerText}" is cut off`);
    // a switch row (pocket.css: the label on the left, the switch on the right) holds one piece of text, or its parts swap places
    for (const row of el.querySelectorAll<HTMLElement>('label.toggle:has(> input[type="checkbox"])')) {
      if (!row.checkVisibility()) continue;
      const pieces = [...row.childNodes].filter((n) => (n.nodeType === Node.TEXT_NODE ? n.textContent!.trim() : n.nodeType === Node.ELEMENT_NODE && !(n as Element).matches('input')));
      if (pieces.length > 1) out.push(`the switch row "${row.innerText.trim().slice(0, 50)}" has ${pieces.length} pieces of text, shown out of order`);
    }
    const text = el.querySelector<HTMLElement>('[role="region"]')?.innerText ?? '';
    for (const bad of text.match(/\bundefined\b|\bNaN\b|\[object Object\]/g) ?? []) out.push(`it says "${bad}"`);
    return out;
  });
}

test('every Settings section fits a 390px phone, reads in order and says nothing broken', async ({ page }) => {
  test.setTimeout(300_000);
  const root = await pocketSettings(page);
  const problems: string[] = [];
  for (const s of sectionsIn('settings', 'pocket')) {
    for (const x of await page.locator('.toasts .notice-x').all()) if (await x.isVisible()) await x.click(); // demo toasts over Back
    await pocketSection(root, s.label);
    await page.waitForTimeout(300); // lazy sections and settled layout
    for (const p of [...(await overflowProblems(root)), ...(await sectionProblems(root))]) problems.push(`${s.label}: ${p}`);
  }
  expect(problems).toEqual([]);
});

for (const width of [360, 390]) {
  test(`a Settings section's title shows whole beside Back at ${width}px`, async ({ page }) => {
    const root = await pocketSettings(page, width);
    await pocketSection(root, 'Providers & accounts');
    const title = root.locator('.cn-title');
    await expect(title).toHaveText('Providers & accounts');
    expect(await title.evaluate((t) => [t.scrollWidth <= t.clientWidth + 1, t.scrollHeight <= t.clientHeight + 1])).toEqual([true, true]);
  });
}

test("a provider's long name ends at its card's edge, clear of its ⋯", async ({ page }) => {
  const added = await (await page.request.post('/api/providers', { data: { provider: 'openrouter', key: 'sk-or-v1-layout-test-0000001234', label: LONG_NAME } })).json();
  try {
    const root = await pocketSettings(page);
    await pocketSection(root, 'Providers');
    const card = root.locator('.pv-card').filter({ hasText: LONG_NAME });
    await card.scrollIntoViewIfNeeded();
    const [title, menu, box] = await Promise.all([card.locator('.ds-row-title').boundingBox(), card.getByRole('button', { name: `More for ${LONG_NAME}` }).boundingBox(), card.boundingBox()]);
    expect(title!.x + title!.width).toBeLessThanOrEqual(menu!.x + 1);
    expect(title!.x + title!.width).toBeLessThanOrEqual(box!.x + box!.width);
    expect(await overflowProblems(root)).toEqual([]);
  } finally {
    await page.request.delete(`/api/providers/${added.id}`);
  }
});

test("Voice's switch rows keep their words before the explanation, the switch on the right", async ({ page }) => {
  const root = await pocketSettings(page);
  await pocketSection(root, 'Voice');
  const row = root.locator('label.toggle').filter({ hasText: 'Agents speak when clicked' });
  const order = await row.evaluate((label) => {
    const walk = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walk.nextNode()) && !node.textContent!.includes('Agents speak when clicked'));
    const range = document.createRange();
    range.selectNodeContents(node!);
    const words = [...range.getClientRects()].at(-1)!; // the words' last line
    const help = label.querySelector('.muted')!.getClientRects()[0]; // the explanation's first
    const input = label.querySelector('input')!.getBoundingClientRect();
    // the explanation follows the words (on their line or below), never before them; the switch is on the right
    return { helpAfterWords: help.top >= words.bottom - 2 || (help.top < words.bottom && help.left >= words.right - 1), switchOnTheRight: input.left >= Math.max(words.right, label.querySelector('.muted')!.getBoundingClientRect().right) - 1 };
  });
  expect(order).toEqual({ helpAfterWords: true, switchOnTheRight: true });
  expect(await sectionProblems(root)).toEqual([]);
});

test("Agents' model picker shows its value like the selects beside it", async ({ page }) => {
  const root = await pocketSettings(page);
  await pocketSection(root, 'Agents');
  const font = (l: Locator) => l.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight]);
  const [pick, select] = await Promise.all([font(root.locator('.model-pick').first()), font(root.locator('.ds-stack-scope select').first())]);
  expect(pick).toEqual(select);
});
