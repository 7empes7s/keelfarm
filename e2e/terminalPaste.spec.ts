import { devices, type BrowserContext, type Page } from '@playwright/test';
import { expect, test } from './helpers';
import { dialog, pocketSection } from './layout/helpers';

// Paste on a phone (#278): the key bar's Paste is in the first row (the highlighted key in a sign-in terminal), it
// pastes the clipboard from a real tap, and when the clipboard can't be read the paste sheet takes the text instead.

test.use({ isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent, viewport: { width: 390, height: 844 } });

async function clipboard(context: BrowserContext, page: Page, text: string) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
}

/** Settings → Providers & accounts → a login's ⋯ → Sign in again: its terminal (the demo's logins are all signed in). */
async function signInTerminal(page: Page) {
  await page.goto('/?pocket=1');
  await page.getByRole('button', { name: 'Settings and notifications' }).click();
  const settings = dialog(page, /Settings/);
  await pocketSection(settings, 'Providers & accounts');
  await settings.getByRole('button', { name: 'More for Max · keelops' }).click();
  await page.getByRole('menuitem', { name: /Sign in again/ }).click();
  const sheet = page.locator('.acc-signin');
  await expect(sheet.locator('.xterm-rows')).toBeVisible();
  return sheet;
}

const paste = (root: ReturnType<Page['locator']>) => root.locator('.term-keys-row').getByRole('button', { name: /^Paste/ });

test('the sign-in terminal leads with Paste and pastes the code from the clipboard', async ({ page, context }) => {
  const term = await signInTerminal(page);
  const row = term.locator('.term-keys-row .term-key');
  await expect(row.nth(0)).toHaveText('Esc');
  await expect(row.nth(1)).toHaveText('Paste code');
  await expect(row.nth(1)).toHaveClass(/term-key-primary/);
  await clipboard(context, page, '  demo-code-123\n');
  await paste(term).tap();
  await term.locator('.term-keys-row').getByRole('button', { name: 'Enter', exact: true }).tap();
  await expect(term.locator('.xterm-rows')).toContainText(/Login successful|Successfully logged in/);
  await page.screenshot({ path: test.info().outputPath('signin-paste.png') });
});

test('with the clipboard refused, the paste sheet sends the code', async ({ page }) => {
  const term = await signInTerminal(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) } }));
  await paste(term).tap();
  const sheet = dialog(page, /Paste the sign-in code/);
  await expect(sheet).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Sign-in code' }).fill('demo-code-456');
  await page.screenshot({ path: test.info().outputPath('paste-sheet.png') });
  await sheet.getByRole('button', { name: 'Send + Enter' }).tap();
  await expect(sheet).toBeHidden();
  await expect(term.locator('.xterm-rows')).toContainText(/Login successful|Successfully logged in/);
});

// The demo agent's session may have ended (input to it is dropped, #278's later part), so this checks the sheet's flow;
// the sign-in terminal above checks the text arriving.
test("an agent's terminal offers the sheet when there's no clipboard", async ({ page }) => {
  await page.goto('/?pocket=1&tab=team');
  await page.locator('.pocket').getByRole('button', { name: 'Terminal', exact: true }).first().click();
  const win = page.locator('.panel.term-phone');
  await win.getByRole('button', { name: 'Open terminal' }).tap(); // chat mode is the default
  await expect(win.locator('.xterm-rows')).toBeVisible();
  await win.getByRole('button', { name: 'Terminal keys' }).tap();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }));
  await paste(win).tap();
  const sheet = dialog(page, /Paste into the terminal/);
  await sheet.getByRole('textbox', { name: 'Text to paste' }).fill('hello from the sheet');
  await sheet.getByRole('button', { name: 'Send', exact: true }).tap();
  await expect(sheet).toBeHidden();
  await expect(win.locator('.term-keys-row .term-key').nth(1)).toHaveText('Paste');
});
