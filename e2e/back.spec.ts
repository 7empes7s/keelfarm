import type { Locator, Page } from '@playwright/test';
import { enterOffice, expect, test } from './helpers';

// A way back from every page (#129): each overlay has a visible ✕ that closes it, and the browser's Back (the phone's
// back gesture) closes the top overlay instead of leaving the app.

interface Overlay {
  name: string;
  width: number;
  /** Opens it; returns its dialog. */
  open: (page: Page) => Promise<Locator>;
  /** What's on screen with it closed. */
  under: (page: Page) => Locator;
}

const pocket = async (page: Page, tab: string) => {
  await page.goto(`/?pocket=1&tab=${tab}`);
  await expect(page.locator('.pocket .pk-tab-on')).toBeVisible();
};
const pocketRoot = (page: Page) => page.locator('.pocket .pk-tab-on');

async function office(page: Page) {
  await page.goto('/?pocket=0');
  await enterOffice(page, { loaded: true });
  const skipTour = page.getByRole('button', { name: 'Skip tour' });
  if (await skipTour.isVisible()) await skipTour.dispatchEvent('click');
}

/** A shortcut on the 3D phone's Company tab. */
async function fromPhone(page: Page, button: RegExp, name: RegExp) {
  await office(page);
  await page.keyboard.press('p');
  const phone = page.getByRole('dialog', { name: /Your phone/ });
  await phone.getByRole('tab', { name: 'Company' }).click();
  await phone.getByRole('button', { name: button }).click();
  return page.getByRole('dialog', { name });
}

const OVERLAYS: Overlay[] = [
  {
    name: 'pocket settings',
    width: 390,
    open: async (page) => {
      await pocket(page, 'company');
      await page.getByRole('button', { name: 'Settings and notifications' }).click();
      return page.getByRole('dialog', { name: /Settings/ });
    },
    under: pocketRoot,
  },
  {
    name: 'app viewer from a floor card',
    width: 390,
    open: async (page) => {
      await pocket(page, 'company');
      await page.locator('.fb-card.fb-live').first().click();
      return page.getByRole('dialog');
    },
    under: pocketRoot,
  },
  {
    name: 'terminal',
    width: 390,
    open: async (page) => {
      await pocket(page, 'team');
      await page.getByRole('button', { name: 'Terminal', exact: true }).first().click();
      return page.getByRole('dialog');
    },
    under: pocketRoot,
  },
  {
    name: 'phone',
    width: 1280,
    open: async (page) => {
      await office(page);
      await page.keyboard.press('p');
      return page.getByRole('dialog', { name: /Your phone/ });
    },
    under: (page) => page.locator('.hud'),
  },
  { name: 'kanban', width: 1280, open: (page) => fromPhone(page, /Kanban/, /GitHub/), under: (page) => page.locator('.hud') },
  { name: 'help', width: 1280, open: (page) => fromPhone(page, /Help/, /How the office works/), under: (page) => page.locator('.hud') },
];

for (const o of OVERLAYS) {
  test(`${o.name} at ${o.width}px: ✕ closes it, and Back closes it without leaving the app`, async ({ page }) => {
    await page.setViewportSize({ width: o.width, height: o.width < 600 ? 844 : 800 });
    let dialog = await o.open(page);
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole('button', { name: 'Close' }).first();
    await expect(close).toBeVisible();
    await close.click();
    await expect(dialog).toBeHidden();
    await expect(o.under(page)).toBeVisible();

    dialog = await o.open(page);
    await expect(dialog).toBeVisible();
    const at = page.url();
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(o.under(page)).toBeVisible();
    expect(new URL(page.url()).origin).toBe(new URL(at).origin);
  });
}
