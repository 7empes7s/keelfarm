import { devices, type Locator, type Page } from '@playwright/test';
import { expect, test } from './helpers';
import { dialog, office, pocketSection } from './layout/helpers';

// Every text field stays above the phone's keyboard (#494), however iOS reports it: a resize that comes before the
// keyboard has settled, none at all, or focus moving to another field with the keyboard already up. The field and its
// send / submit button end inside the visible part of the page; the CEO chat's message box, a Settings field and an
// account's sign-in code field.

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent });

const KEYBOARD = 336;

/** The keyboard, as iOS shows it: the visual viewport loses `px` at the bottom; `resize` says whether iOS told the page. */
async function keyboard(page: Page, px: number, resize: boolean) {
  await page.evaluate(
    ([px, resize]) => {
      const w = window as { kb?: number };
      if (w.kb === undefined) Object.defineProperty(visualViewport!, 'height', { configurable: true, get: () => innerHeight - (w.kb ?? 0) });
      w.kb = px as number;
      if (resize) visualViewport!.dispatchEvent(new Event('resize'));
    },
    [px, resize] as const,
  );
}

/** The keyboard comes up as `how` says, with `field` focused. */
async function typeIn(page: Page, field: Locator, how: 'no resize' | 'late resize') {
  await field.focus();
  if (how === 'no resize') {
    await page.waitForTimeout(150); // past the focus's own frame: the keyboard slides in after it
    await keyboard(page, KEYBOARD, false);
  } else {
    await keyboard(page, 200, true); // its first resize, mid-animation
    await page.waitForTimeout(300);
    await keyboard(page, KEYBOARD, false); // where it settles, never reported
  }
  await page.waitForTimeout(1500);
}

/** Each of `boxes` ends inside the visible part of the page and starts on it. */
async function onScreen(page: Page, boxes: Locator[]) {
  const v = await page.evaluate(() => ({ top: visualViewport!.offsetTop, bottom: visualViewport!.offsetTop + visualViewport!.height }));
  for (const box of boxes) {
    const b = (await box.boundingBox())!;
    expect(b.y, `${box} starts on screen`).toBeGreaterThanOrEqual(v.top - 0.5);
    expect(b.y + b.height, `${box} ends above the keyboard`).toBeLessThanOrEqual(v.bottom + 0.5);
  }
  expect(await page.evaluate(() => scrollY), 'the page itself never scrolls').toBe(0);
}

async function chat(page: Page) {
  await page.goto('/?pocket=1&tab=chat');
  const input = page.locator('.pocket .chat-input');
  await expect(input).toBeVisible();
  return { field: input.locator('textarea'), send: input };
}

async function settings(page: Page) {
  await page.goto('/?pocket=1');
  await page.getByRole('button', { name: 'Settings and notifications' }).click();
  const root = dialog(page, /Settings/);
  await pocketSection(root, 'Company');
  return root.getByRole('region', { name: 'Company' });
}

async function signIn(page: Page) {
  await page.goto('/?pocket=1');
  await page.getByRole('button', { name: 'Settings and notifications' }).click();
  await pocketSection(dialog(page, /Settings/), 'Providers & accounts');
  await dialog(page, /Settings/).getByRole('button', { name: 'More for Max · keelops' }).click();
  await page.getByRole('menuitem', { name: /Sign in again/ }).click();
  const sheet = page.locator('.acc-signin');
  const field = sheet.getByRole('textbox', { name: 'Paste the code from the sign-in page' });
  await expect(field).toBeVisible();
  return { field, send: sheet.getByRole('button', { name: 'Sign in', exact: true }) };
}

for (const how of ['no resize', 'late resize'] as const) {
  test.describe(`the keyboard with ${how}`, () => {
    test("the CEO chat's message box and its send stay above it", async ({ page }) => {
      const { field, send } = await chat(page);
      await typeIn(page, field, how);
      await onScreen(page, [field, send]);
    });

    test('a Settings field low in its section stays above it', async ({ page }) => {
      const section = await settings(page);
      const field = section.getByRole('textbox', { name: /Projects folder/ });
      await field.evaluate((el) => el.scrollIntoView({ block: 'end' })); // at the screen's bottom, where the keyboard comes up
      await typeIn(page, field, how);
      await onScreen(page, [field]);
    });

    test('the sign-in code field and its Sign in button stay above it', async ({ page }) => {
      const { field, send } = await signIn(page);
      await typeIn(page, field, how);
      await onScreen(page, [field, send]);
    });
  });
}

test('moving to another field with the keyboard up brings that one into view', async ({ page }) => {
  const section = await settings(page);
  await section.getByRole('textbox', { name: 'Your name' }).focus();
  await keyboard(page, KEYBOARD, true);
  await page.waitForTimeout(400);
  const low = section.locator('input:not([type="checkbox"])').last();
  await low.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true })); // iOS with the keyboard up often leaves the box as it is
  await page.waitForTimeout(1500);
  await onScreen(page, [low]);
});

test('after the keyboard closes the layout goes back, with no stray scroll', async ({ page }) => {
  const { field } = await chat(page);
  await typeIn(page, field, 'no resize');
  await field.blur();
  await keyboard(page, 0, true);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height'))).toBe('844px');
  expect(await page.locator('.pocket').evaluate((el) => el.scrollTop)).toBe(0);
  const box = (await page.locator('.pocket').boundingBox())!;
  expect(box.y + box.height).toBeCloseTo(844, 0);
});

// More fields (#507), in both offices: sheets centred on, or pinned to the bottom of, the whole page used to put their
// fields and buttons under the keyboard.
const MORE: { name: string; open: (page: Page) => Promise<{ field: Locator; send: Locator }> }[] = [
  {
    name: "pocket: the + Agent sheet's name and its Add",
    open: async (page) => {
      await page.goto('/?pocket=1&tab=team');
      await page.getByRole('button', { name: /^Add an agent to floor/ }).first().click();
      const sheet = page.getByRole('dialog', { name: /New agent on floor/ });
      return { field: sheet.getByRole('textbox', { name: /New agent's name/ }), send: sheet.getByRole('button', { name: 'Add', exact: true }) };
    },
  },
  {
    name: "pocket: the terminal's paste sheet and its Send + Enter",
    open: async (page) => {
      const { field } = await signIn(page);
      await field.page().locator('.acc-signin').getByRole('button', { name: 'Show terminal' }).tap();
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) } }));
      await page.locator('.acc-signin .term-keys-row').getByRole('button', { name: /^Paste/ }).tap();
      const sheet = dialog(page, /Paste the sign-in code/);
      await sheet.getByRole('textbox', { name: 'Sign-in code' }).fill('demo-code');
      return { field: sheet.getByRole('textbox', { name: 'Sign-in code' }), send: sheet.getByRole('button', { name: 'Send + Enter' }) };
    },
  },
  {
    name: 'pocket: the search box',
    open: async (page) => {
      await page.goto('/?pocket=1');
      await page.getByRole('button', { name: /Search everything/ }).click();
      const field = page.getByRole('combobox', { name: 'Search everything' });
      return { field, send: field };
    },
  },
  {
    name: '3D office: a Settings field low in its section',
    open: async (page) => {
      await office(page);
      await expect(page.locator('.hud-hint')).toContainText("Open the manager's console"); // nobody walking past in between
      await page.keyboard.press('e');
      const root = dialog(page, /Manager's console/);
      await pocketSection(root, 'Company');
      const field = root.getByRole('textbox', { name: /Projects folder/ });
      await field.evaluate((el) => el.scrollIntoView({ block: 'end' }));
      return { field, send: field };
    },
  },
  {
    name: '3D office: the search box',
    open: async (page) => {
      await office(page);
      await page.keyboard.press('Control+k');
      const field = page.getByRole('combobox', { name: 'Search everything' });
      return { field, send: field };
    },
  },
];

for (const f of MORE) {
  test(`${f.name} stay above the keyboard`, async ({ page }) => {
    const { field, send } = await f.open(page);
    await expect(field).toBeVisible();
    await typeIn(page, field, 'late resize');
    await onScreen(page, [field, send]);
  });
}
