import { devices, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { expect, test } from './helpers';
import { consoleSection, dialog, office, pocketSection } from './layout/helpers';

// An account's sign-in terminal (#302), on a computer and on a phone: Paste code sends exactly the code, the paste
// sheet stays open until Send or ×, and a failed sign-in ends with its reason and Try again. The demo's fake prompt
// prints the exact bytes it got; "fail" in a code fails it with the real CLI's 400.

/** Settings → Providers & accounts → a login's ⋯ → Sign in again: the 3D office's console, or pocket mode's Settings. */
async function signIn(page: Page, phone: boolean) {
  let root: Locator;
  if (phone) {
    await page.goto('/?pocket=1');
    await page.getByRole('button', { name: 'Settings and notifications' }).click();
    root = dialog(page, /Settings/);
    await pocketSection(root, 'Providers & accounts');
  } else {
    await office(page);
    await page.keyboard.press('e');
    root = dialog(page, /Manager's console/);
    await consoleSection(root, 'Settings', 'Providers & accounts');
  }
  await root.getByRole('button', { name: 'More for Max · keelops' }).click();
  await page.getByRole('menuitem', { name: /Sign in again/ }).click();
  const sheet = page.locator('.acc-signin');
  await expect(sheet.locator('.xterm-rows')).toContainText('Paste code here if prompted');
  return sheet;
}

async function clipboard(context: BrowserContext, page: Page, text: string) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
}

for (const phone of [false, true]) {
  test.describe(phone ? 'on a phone' : 'on a computer', () => {
    if (phone) test.use({ isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent, viewport: { width: 390, height: 844 } });
    const press = (l: Locator) => (phone ? l.tap() : l.click());
    const key = (sheet: Locator, name: string | RegExp) => sheet.locator('.term-keys-row').getByRole('button', { name, exact: typeof name === 'string' });

    test('Paste code sends exactly the code', async ({ page, context }) => {
      const sheet = await signIn(page, phone);
      const paste = key(sheet, /^Paste/);
      await expect(paste).toHaveText('Paste code');
      await expect(paste).not.toHaveAttribute('aria-pressed');
      await clipboard(context, page, '  abc123#state456\n');
      await press(paste);
      await press(key(sheet, 'Enter'));
      await expect(sheet.locator('.xterm-rows')).toContainText('the prompt got 15 characters, with #state');
      await expect(sheet.getByRole('status')).toHaveText('Signed in.');
    });

    test('with the clipboard refused, the paste sheet stays open until Send', async ({ page }) => {
      const sheet = await signIn(page, phone);
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) } }));
      await press(key(sheet, /^Paste/));
      const paste = dialog(page, /Paste the sign-in code/);
      await expect(paste).toBeVisible();
      await page.waitForTimeout(1000);
      await expect(paste).toBeVisible();
      await paste.getByRole('textbox', { name: 'Sign-in code' }).fill('abc123#state456 ');
      await press(paste.getByRole('button', { name: 'Send + Enter' }));
      await expect(paste).toBeHidden();
      await expect(sheet.locator('.xterm-rows')).toContainText('the prompt got 15 characters, with #state');
    });

    test('a failed sign-in says why, and Try again starts one that takes input', async ({ page, context }) => {
      const sheet = await signIn(page, phone);
      await clipboard(context, page, 'fail-400#x');
      await press(key(sheet, /^Paste/));
      await press(key(sheet, 'Enter'));
      await expect(sheet.getByRole('status')).toContainText('Sign-in failed (400)');
      await page.screenshot({ path: test.info().outputPath('signin-failed.png') });
      await press(sheet.getByRole('button', { name: 'Try again' }));
      await expect(sheet.getByRole('status')).toBeHidden();
      await clipboard(context, page, 'good#1');
      await press(key(sheet, /^Paste/));
      await press(key(sheet, 'Enter'));
      await expect(sheet.locator('.xterm-rows')).toContainText('Login successful');
      await expect(sheet.getByRole('status')).toHaveText('Signed in.');
      await expect(sheet.locator('.xterm-rows')).not.toContainText('This sign-in has ended');
    });
  });
}
