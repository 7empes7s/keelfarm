import { expect, test } from './helpers';

// #508: an agent's question the CEO brought to the manager, answered from the "Waiting on you" tray on a phone: the
// answer reaches the agent, the chat's question card and their Team card say "Answer delivered", and they work again.
// The demo's badge question (red or blue) goes to the manager a few minutes in.

test('answering an agent from the tray says Answer delivered on their card', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  const card = page.locator('.decision-card').filter({ hasText: 'red or blue' }).first();
  await expect(card).toBeVisible({ timeout: 8 * 60_000 });
  const name = (await card.locator('.decision-q').innerText()).split(':')[0].trim();
  await card.locator('.decision-option', { hasText: 'Blue' }).click();
  await expect(page.locator('[role=status].suggestions', { hasText: 'Answer delivered' }).first()).toBeVisible();
  await page.goto('/?pocket=1&tab=team');
  const agent = page.locator('.pk-agent').filter({ has: page.locator('.pk-agent-head', { hasText: name }) }).first();
  await expect(agent.locator('.pk-phrase')).toContainText('Answer delivered');
  await expect(agent.locator('.pk-sign-in', { hasText: 'Waiting for your answer' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
