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
