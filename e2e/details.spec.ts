import type { Locator } from '@playwright/test';
import { expect, test } from './helpers';

// The PR details page (#155), on the demo's stuck PR, at 390px on a touch screen: the title wraps (two lines here,
// not cut to one), failed checks come first and open, passed ones closed, the conflict is a status row, every action
// is a 44px button, no "Esc closes" hint, nothing scrolls sideways. layout.spec.ts checks it at every width too.

test.describe('the PR details page on a phone', () => {
  test.use({ isMobile: true, hasTouch: true });
  test('wraps the title, orders the checks and hides keyboard hints at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?pocket=1&tab=approvals');
    await page.locator('.pocket').getByRole('button', { name: /open the details$/ }).first().click();
    const details = page.getByRole('dialog', { name: /PR #/ });
    const title = details.locator('.dp-title');
    const lines = await title.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines).toBeGreaterThanOrEqual(2);
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await expect(details.getByText('Breaks a charter standard')).toBeVisible();
    await expect(details.locator('.dp-group-h')).toHaveText([/^Failed/, /^Skipped/, /^Passed/]);
    await expect(details.locator('.dp-check-fail .dp-check-row').first()).toHaveAttribute('aria-expanded', 'true');
    await expect(details.locator('.dp-check-pass .dp-check-row').first()).toHaveAttribute('aria-expanded', 'false');
    await expect(details.getByText(/^Conflicts with/)).toBeVisible();
    await expect(details.locator('.dp-keys')).toBeHidden();
    for (const b of await details.locator('.dp-buttons .ds-btn').all()) {
      const box = (await b.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

// The sweep (#155): Mission control's cards and the agent window's Now tab on the same cards and 44px buttons, and the
// console back bar's ⓘ as the shared icon button, at a phone's width and a desktop's.
const big = async (buttons: Locator) => {
  for (const b of await buttons.all()) {
    if (!(await b.isVisible())) continue;
    const box = (await b.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }
};

for (const width of [390, 1280]) {
  test(`Mission control's cards and the back bar's ⓘ at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1#company/ops');
    const settings = page.getByRole('dialog', { name: /Settings/ });
    if (width < 900) {
      const info = settings.locator('.cn-back-bar').getByRole('button', { name: /What can I do on/ });
      await expect(info).toHaveClass(/ds-btn-icon/);
      await big(info);
    }
    await expect(settings.locator('#ops-card-usage.dp-card')).toBeVisible();
    await big(settings.locator('.dp-card .dp-buttons .ds-btn'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`the agent window's Now tab as cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1&tab=team');
    await page.locator('.pocket').getByRole('button', { name: 'Terminal', exact: true }).first().click();
    const win = page.getByRole('dialog');
    const who = win.locator('.aw-who');
    if ((await who.getAttribute('aria-expanded')) !== 'true') await who.click();
    const now = win.locator('#aw-details');
    await expect(now.locator('.dp-head .dp-title')).toBeVisible();
    await expect(now.locator('.cs-stat', { hasText: 'Turns' })).toBeVisible();
    await big(now.locator('.dp-buttons .ds-btn'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
