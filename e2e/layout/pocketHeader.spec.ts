import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers';

// Pocket mode's top bar (#588): no button's label wraps, nothing overflows, the company name is never cut below its
// short form, and every action is a button or an item in its ⋯, with the CEO chat open and closed.

/** Every action the top bar offers, by a button's or a ⋯ item's accessible name. */
const WIDE_ACTIONS: [string, RegExp][] = [
  ['search', /^Search everything/],
  ['notifications', /^Notifications/],
  ['sound', /sound/i],
  ['captions', /captions/i],
  ['full screen', /full screen/i],
  ['info', /^What can I do/],
  ['chat mode', /^Chat (mode|on|off)/],
  ['CEO chat', /^Chat with/],
  ['3D office', /3D office/],
];

const LONG = { companyName: 'TechInsiderBytes' };
// the demo's own name back for the specs after these
test.afterEach(async ({ page }) => void (await page.request.patch('/api/settings', { data: { companyName: 'Demo Co.' } })));

async function oneLine(head: Locator) {
  const problems = await head.evaluate((el) => {
    const out: string[] = [];
    if (el.scrollWidth > el.clientWidth + 1) out.push(`the bar overflows: ${el.scrollWidth} > ${el.clientWidth}`);
    for (const b of el.querySelectorAll<HTMLElement>('button')) {
      const r = b.getBoundingClientRect();
      if (!r.width) continue;
      if (r.height < 43) out.push(`${b.getAttribute('aria-label') ?? b.textContent} is ${r.height}px tall`);
      if (r.height > 52) out.push(`${b.getAttribute('aria-label') ?? b.textContent} wraps (${r.height}px)`);
    }
    const t = el.querySelector<HTMLElement>('.pk-title');
    if (t && t.scrollWidth > t.clientWidth + 1) out.push(`the name is cut: ${t.textContent}`);
    return out;
  });
  expect(problems).toEqual([]);
}

async function reachable(page: Page, head: Locator, name: RegExp) {
  if (await head.getByRole('button', { name }).first().isVisible()) return true;
  const more = head.getByRole('button', { name: /^More in the top bar/ });
  if (!(await more.isVisible())) return false;
  await more.click();
  const item = page.getByRole('menuitem', { name });
  const found = await item.first().isVisible();
  await page.keyboard.press('Escape');
  return found;
}

for (const width of [1024, 1280, 1440])
  for (const chatOpen of [false, true])
    test(`the top bar fits on one line at ${width}px, the chat ${chatOpen ? 'open' : 'closed'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.request.patch('/api/settings', { data: LONG });
      await page.goto('/?pocket=1&tab=company');
      const root = page.locator('.pocket');
      const head = root.locator('.pk-head');
      const chat = root.locator('.pk-chat-btn');
      await expect(chat).toBeVisible();
      if ((await chat.getAttribute('aria-pressed')) !== String(chatOpen)) await chat.click();
      await expect(chat).toHaveAttribute('aria-pressed', String(chatOpen));
      await oneLine(head);
      await expect(head.locator('.pk-title')).toHaveText(/^(TechInsiderBytes|TIB)$/, { useInnerText: true });
      const canFull = await page.evaluate(() => document.fullscreenEnabled);
      for (const [what, name] of WIDE_ACTIONS) if (what !== 'full screen' || canFull) expect(await reachable(page, head, name), what).toBe(true);
    });

test('the phone top bar keeps the short name and its buttons at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.patch('/api/settings', { data: LONG });
  await page.goto('/?pocket=1&tab=company');
  const head = page.locator('.pocket .pk-head');
  await expect(head.locator('.pk-title')).toHaveText('TIB', { useInnerText: true });
  await expect(head.locator('.pk-title')).toHaveAttribute('title', 'TechInsiderBytes');
  await oneLine(head);
  for (const name of [/^Search everything/, /^Notifications/, /^Sound & captions/, /^What can I do/, /^Settings and notifications/]) await expect(head.getByRole('button', { name }).first()).toBeVisible();
});
