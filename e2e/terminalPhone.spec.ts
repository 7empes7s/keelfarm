import { devices, type Page } from '@playwright/test';
import { expect, test } from './helpers';

// The agent window on phones (#86): terminal first. One header row, the terminal in at least 75% of the window, one
// bottom bar, nothing past the right edge; the details sheet and the key bar fold away until tapped.

const PHONES = [
  { width: 360, height: 780 },
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
    if (head.height > 80) problems.push(`the header is ${Math.round(head.height)}px tall`);
    if (bar.height > 80) problems.push(`the bottom bar is ${Math.round(bar.height)}px tall`);
    if (bar.bottom > innerHeight + 1) problems.push(`the bottom bar ends at ${Math.round(bar.bottom)}, the screen at ${innerHeight}`);
    for (const el of document.querySelectorAll<HTMLElement>('.term-phone :is(button, a, input, textarea, .status-dot)')) {
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

      // The details sheet: closed by default, opens and closes from the toggle, holds History and Stop (with a confirm).
      await expect(panel.locator('#term-details')).toHaveCount(0);
      await panel.getByRole('button', { name: 'Details' }).click();
      const sheet = panel.locator('#term-details');
      await expect(sheet.getByRole('button', { name: /History/ })).toBeVisible();
      await sheet.getByRole('button', { name: /Stop/ }).click();
      const ask = page.getByRole('alertdialog', { name: /^Stop/ });
      await expect(ask).toBeVisible();
      await ask.getByRole('button', { name: 'Cancel' }).click();
      await panel.getByRole('button', { name: 'Hide the details' }).first().click();
      await expect(sheet).toHaveCount(0);

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
