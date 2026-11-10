import { expect, test } from '../helpers';

// A long CEO reply with command blocks (#339): it folds after a whole block, its commands readable with Copy in reach,
// no code card cut to an empty header, and "Show more" says what's hidden.
for (const width of [390, 1280]) {
  test(`a long reply with commands folds at a block at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1&tab=chat');
    const bubble = page.locator('.bubble').filter({ hasText: 'A. Quick wins' }).last();
    const more = bubble.locator('.long-toggle');
    await expect(more).toHaveText('Show more · 1 more code block');
    const first = bubble.locator('.md-code').first();
    await expect(first.locator('.md-code-lang')).toHaveText('Terminal · 3 lines');
    await expect(first).toContainText('swapon --show');
    await expect(first.locator('.md-copy')).toBeVisible();
    // every code card shown has its commands, none is cut to its header
    for (const card of await bubble.locator('.md-code').all()) expect((await card.locator('pre').boundingBox())!.height).toBeGreaterThan(20);
    await more.click();
    await expect(more).toHaveText('Show less');
    await expect(bubble.locator('.md-code').filter({ hasText: 'vmstat 5 12' }).locator('.md-copy')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });
}
