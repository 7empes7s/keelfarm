import { expect, test } from './helpers';

for (const width of [390, 1280]) {
  test(`CEO message action cards open their target at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1&tab=chat');
    const state = await (await page.request.get('/api/state')).json();
    const message = state.messages.find((m: { actions?: { tool: string }[] }) => m.actions?.filter((a) => a.tool === 'message_agent').length === 2);
    expect(message).toBeDefined();
    const cards = message.actions.filter((a: { tool: string }) => a.tool === 'message_agent') as { text: string; ref: { messageId: number } }[];
    for (const [index, card] of cards.entries()) {
      // A phone closes the window first; the desktop dock opens the second card into the same window.
      if (index && width === 390) await page.locator('.aw .panel-x').click();
      for (const dismiss of await page.locator('.toasts .notice-x').all()) if (await dismiss.isVisible()) await dismiss.click();
      await page.locator('button.action-card').filter({ hasText: card.text }).click();
      await expect(page.locator(`.ac-flash[data-chat-id="${card.ref.messageId}"]`)).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
