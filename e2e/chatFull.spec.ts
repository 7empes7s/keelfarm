import { expect, test } from './helpers';

// The CEO chat full screen (#201): ⛶ covers the pages beside the rail (#242; or hides a phone's tab bar), and Esc or Back puts the
// same layout back, the chat's scroll where it was.
for (const width of [390, 1280]) {
  test(`the chat full screen comes and goes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?pocket=1&tab=chat');
    const root = page.locator('.pocket');
    await expect(root.locator('.chat-log')).toBeVisible();
    const chat = root.locator('.chat-log');
    await chat.evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
    const top = await chat.evaluate((el) => el.scrollTop);
    for (const leave of [() => page.keyboard.press('Escape'), () => page.goBack()]) {
      await root.getByRole('button', { name: 'Full screen', exact: true }).click();
      if (width > 1000) {
        await expect(root.locator('.pk-tabs')).toBeVisible();
        expect((await root.locator('.pk-dock').boundingBox())!.width).toBeGreaterThan(width * 0.85);
      } else await expect(root.locator('.pk-tabs')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await chat.blur();
      await leave();
      await expect(root).not.toHaveClass(/pk-chat-full/);
      await expect(root.locator('.pk-tabs')).toBeVisible();
      await expect(page).toHaveURL(/pocket=1/); // Back closed the full view, not the app
    }
    if (width > 1000) expect(Math.abs((await chat.evaluate((el) => el.scrollTop)) - top)).toBeLessThan(80);
  });
}
