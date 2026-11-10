import { devices, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { expect, test } from './helpers';
import { consoleSection, dialog, office, pocketSection } from './layout/helpers';

// An account's guided sign-in (#350) over its terminal (#302), on a computer and on a phone: the three steps without
// opening the terminal, the inline warning for a non-code, a failed sign-in's reason and Try again; and under Show
// terminal, Paste code sends exactly the code. The demo's fake prompt asks the login method first (the office answers
// it), prints the exact bytes it got, and "fail" in a code fails it with the real CLI's 400.

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
  await expect(sheet.getByRole('link', { name: 'Open sign-in page' })).toHaveAttribute('href', /^https:\/\/example\.com\//);
  return sheet;
}

/** The terminal under the guide, with its prompt waiting. */
async function terminal(sheet: Locator, press: (l: Locator) => Promise<void>) {
  await press(sheet.getByRole('button', { name: 'Show terminal' }));
  await expect(sheet.locator('.xterm-rows')).toContainText('Paste code here if prompted');
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

    test('the guide goes through its three steps without the terminal', async ({ page, context }) => {
      const sheet = await signIn(page, phone);
      const steps = sheet.getByRole('list', { name: 'Sign-in steps' });
      await expect(steps.locator('[aria-current="step"]')).toHaveText('Open the sign-in page');
      await expect(sheet).toContainText("This signs in only this account's own folder");
      await press(sheet.getByRole('button', { name: 'Copy link' }));
      await expect(steps.locator('[aria-current="step"]')).toHaveText('Paste the code');
      await clipboard(context, page, '  abc123#state456\n');
      await press(sheet.getByRole('button', { name: 'Paste', exact: true }));
      await expect(sheet.getByRole('textbox', { name: 'Paste the code from the sign-in page' })).toHaveValue('abc1•••••••e456');
      await page.screenshot({ path: test.info().outputPath('signin-guide-code.png') });
      await press(sheet.getByRole('button', { name: 'Sign in', exact: true }));
      await expect(sheet.locator('.sig-end')).toContainText(/Signed in as .*Signed in\./);
      await expect(steps.locator('.sig-step-done')).toHaveCount(3);
      await expect(sheet.locator('.xterm-rows')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath('signin-guide-done.png') });
      await press(sheet.getByRole('button', { name: 'Done' }));
      await expect(sheet).toBeHidden();
    });

    test('a pasted non-code gets a warning and is not sent', async ({ page }) => {
      const sheet = await signIn(page, phone);
      const field = sheet.getByRole('textbox', { name: 'Paste the code from the sign-in page' });
      await field.fill('two words');
      await press(sheet.getByRole('button', { name: 'Sign in', exact: true }));
      await expect(sheet.getByRole('alert')).toContainText('spaces');
      await field.fill('https://example.com/cubefarm-demo/claude-sign-in');
      await press(sheet.getByRole('button', { name: 'Sign in', exact: true }));
      await expect(sheet.getByRole('alert')).toContainText('web address');
      await expect(sheet.locator('.sig-end')).toHaveCount(0);
    });

    test('a failed sign-in says why, and Try again starts a fresh one', async ({ page }) => {
      const sheet = await signIn(page, phone);
      await sheet.getByRole('textbox', { name: 'Paste the code from the sign-in page' }).fill('fail-400#x');
      await press(sheet.getByRole('button', { name: 'Sign in', exact: true }));
      await expect(sheet.locator('.sig-end')).toContainText('Sign-in failed (400)');
      await page.screenshot({ path: test.info().outputPath('signin-failed.png') });
      await press(sheet.getByRole('button', { name: 'Try again' }));
      await expect(sheet.locator('.sig-end')).toHaveCount(0);
      await sheet.getByRole('textbox', { name: 'Paste the code from the sign-in page' }).fill('good#1');
      await press(sheet.getByRole('button', { name: 'Sign in', exact: true }));
      await expect(sheet.locator('.sig-end')).toContainText('Signed in.');
    });

    test('under Show terminal, Paste code sends exactly the code (#302)', async ({ page, context }) => {
      const sheet = await signIn(page, phone);
      await terminal(sheet, press);
      const paste = key(sheet, /^Paste/);
      await expect(paste).toHaveText('Paste code');
      await clipboard(context, page, '  abc123#state456\n');
      await press(paste);
      await press(key(sheet, 'Enter'));
      await expect(sheet.locator('.xterm-rows')).toContainText('the prompt got 15 characters, with #state');
      await expect(sheet.locator('.sig-end')).toContainText('Signed in.');
    });

    test('with the clipboard refused, the paste sheet stays open until Send', async ({ page }) => {
      const sheet = await signIn(page, phone);
      await terminal(sheet, press);
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
  });
}
