import { devices, type Page } from '@playwright/test';
import { expect, test } from './helpers';

// The agent window on phones (#86, #117): terminal first. One header row (× fully on screen), the terminal in at least
// 75% of the window, one bottom bar, nothing past the right edge; the details sheet and the key bar fold away until
// tapped, the sheet opens and closes by tap and swipe, and its stat tiles never clip. At 1280 the details are a side panel.

const PHONES = [
  { width: 360, height: 780 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

async function openTerminal(page: Page) {
  await page.goto('/?pocket=1&tab=team');
  await page.locator('.pocket').getByRole('button', { name: 'Terminal', exact: true }).first().click();
  const panel = page.locator('.panel.term-phone');
  await expect(panel.locator('.xterm-rows')).toBeVisible();
  return panel;
}

/** What's wrong with the window's layout right now, and the terminal's rows. */
function measure(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.panel.term-phone')!.getBoundingClientRect();
    const term = document.querySelector('.term-phone .live-term')!.getBoundingClientRect();
    const head = document.querySelector('.term-phone .panel-head')!.getBoundingClientRect();
    const bar = document.querySelector('.term-phone .term-input')!.getBoundingClientRect();
    const problems: string[] = [];
    if (term.height < panel.height * 0.75) problems.push(`the terminal is ${Math.round(term.height)}px of ${Math.round(panel.height)}`);
    if (head.height > 64) problems.push(`the header is ${Math.round(head.height)}px tall`);
    if (bar.height > 80) problems.push(`the bottom bar is ${Math.round(bar.height)}px tall`);
    if (bar.bottom > innerHeight + 1) problems.push(`the bottom bar ends at ${Math.round(bar.bottom)}, the screen at ${innerHeight}`);
    for (const el of document.querySelectorAll<HTMLElement>('.term-phone :is(button, a, input, textarea, .aw-ring)')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > innerWidth + 1 && !el.closest('.term-keys-row')) problems.push(`${el.textContent?.trim() || el.className} ends at ${Math.round(r.right)}`);
    }
    if (document.documentElement.scrollWidth > innerWidth) problems.push('the page scrolls sideways');
    return { problems, rows: document.querySelectorAll('.term-phone .xterm-rows > div').length };
  });
}

for (const phone of PHONES) {
  test.describe(`agent window at ${phone.width}×${phone.height}`, () => {
    test.use({ isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent, viewport: phone });

    test('the terminal fills the window and the rest folds away', async ({ page }) => {
      const panel = await openTerminal(page);
      await page.waitForTimeout(500); // the fit's next frame
      const { problems, rows } = await measure(page);
      expect(problems).toEqual([]);
      console.log(`${phone.width}×${phone.height}: ${rows} terminal rows`);
      if (phone.width === 390) expect(rows).toBeGreaterThanOrEqual(40);

      // The details sheet: closed by default; a tap on the header opens it, its handle closes it, a swipe up opens it again.
      await expect(panel.locator('#aw-details')).toHaveCount(0);
      await panel.locator('.aw-who').click();
      const sheet = panel.locator('#aw-details');
      await expect(sheet.getByRole('button', { name: /History/ })).toBeVisible();
      await sheet.getByRole('tab', { name: 'Profile', exact: true }).click();
      const clipped = await sheet.evaluate((el) =>
        [...el.querySelectorAll<HTMLElement>('.pf-stat')].filter((t) => t.scrollWidth > t.clientWidth + 1 || t.getBoundingClientRect().right > innerWidth + 1).map((t) => t.textContent),
      );
      expect(clipped).toEqual([]);
      await sheet.getByRole('button', { name: /Close the details/ }).first().click();
      await expect(sheet).toHaveCount(0);
      const who = await panel.locator('.aw-who').boundingBox();
      await page.mouse.move(who!.x + who!.width / 2, who!.y + who!.height / 2);
      await page.mouse.down();
      await page.mouse.move(who!.x + who!.width / 2, who!.y - 80, { steps: 4 });
      await page.mouse.up();
      await expect(sheet).toBeVisible();
      await panel.locator('.aw-grab').click();
      await expect(sheet).toHaveCount(0);

      // Stop asks first, from the header's ■ (when working) or the ⋯ menu.
      const stop = panel.locator('.aw-stop');
      if (await stop.isVisible()) {
        await stop.click();
        const ask = page.getByRole('alertdialog', { name: /^Stop/ });
        await expect(ask).toBeVisible();
        await ask.getByRole('button', { name: 'Cancel' }).click();
      }

      // ⌨ shows and hides the key bar.
      const keys = panel.getByRole('button', { name: 'Terminal keys' });
      await keys.click();
      await expect(panel.getByRole('toolbar', { name: 'Terminal keys' })).toBeVisible();
      await keys.click();
      await expect(panel.getByRole('toolbar', { name: 'Terminal keys' })).toHaveCount(0);

      // The keyboard: a shorter viewport refits the terminal and keeps the bottom bar on screen.
      await page.setViewportSize({ width: phone.width, height: Math.round(phone.height * 0.55) });
      await page.waitForTimeout(600);
      const typing = await measure(page);
      expect(typing.problems.filter((p) => !p.includes('the terminal is'))).toEqual([]);
      expect(typing.rows).toBeLessThan(rows);
      await page.setViewportSize(phone);

      // A message still reaches the agent.
      const box = panel.getByRole('textbox', { name: /^Message/ });
      await box.fill('hello from the phone');
      const sent = page.waitForRequest((r) => r.url().includes('/message') && r.method() === 'POST');
      await panel.getByRole('button', { name: 'Send' }).click();
      await sent;
      await expect(box).toHaveValue('');
    });
  });
}

test.describe('agent window at 1280', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('header, a large terminal and the details beside it', async ({ page }) => {
    await page.goto('/?pocket=1&tab=team');
    await page.locator('.pocket').getByRole('button', { name: 'Terminal', exact: true }).first().click();
    const panel = page.locator('.panel.aw-desk');
    await expect(panel.locator('#aw-details.aw-side')).toBeVisible();
    const sizes = await page.evaluate(() => {
      const box = (q: string) => document.querySelector(q)!.getBoundingClientRect();
      return { panel: box('.panel.aw-desk'), term: box('.aw-desk .term-split'), side: box('.aw-side'), head: box('.aw-desk .panel-head') };
    });
    expect(sizes.head.height).toBeLessThanOrEqual(72);
    expect(sizes.term.width).toBeGreaterThan(sizes.panel.width * 0.6);
    expect(sizes.side.left).toBeGreaterThanOrEqual(sizes.term.right);
    await panel.locator('#aw-details').getByRole('tab', { name: 'Profile', exact: true }).click();
    await expect(panel.locator('.pf-stat').first()).toBeVisible();
  });
});
