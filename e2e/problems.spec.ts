import { expect, overflowProblems, test } from './helpers';

// The problems register (#544): the demo's seeded entries grouped by cause and floor, worst first, filtered by owner
// and state, linking to their agent; and the daily digest card in the CEO chat with tappable items. At a phone's
// width and a computer's.

for (const width of [390, 1280]) {
  test(`Problems: grouped by cause and floor, filters by owner and state, links, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1#company/problems');
    const conflicts = page.getByRole('region', { name: /^Merge conflicts, floor \d+$/ });
    await expect(conflicts).toBeVisible();
    await expect(conflicts).toContainText('Recurring');
    await expect(conflicts.locator('[data-problem]')).toHaveCount(3);
    await expect(page.getByRole('region', { name: /^Bugs QA found, floor \d+$/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Needs your decision' })).toContainText('PR #919 needs a human');
    expect(await overflowProblems(page.locator('body'))).toEqual([]);

    // IT's tickets only: infrastructure, no work groups
    await page.getByRole('group', { name: 'Owner' }).getByRole('button', { name: 'IT', exact: true }).click();
    await expect(conflicts).toBeHidden();
    await expect(page.getByRole('region', { name: 'Previews' })).toBeVisible();

    // this week's resolved ones
    await page.getByRole('group', { name: 'Owner' }).getByRole('button', { name: 'Everyone' }).click();
    await page.getByRole('button', { name: 'Resolved this week' }).click();
    await expect(page.getByText('QA sent it back for nits on PR #928')).toBeVisible();
    await expect(conflicts).toBeHidden();

    // a link opens the agent's window
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    const row = page.locator('[data-group^="waste:"] [data-problem]').first();
    const agent = row.locator('.pb-links button').last();
    const name = (await agent.innerText()).trim();
    await agent.click();
    await expect(page.getByText(name).first()).toBeVisible();
    await expect(page.locator('[data-group^="waste:"]')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`Problems: the daily digest card in the CEO chat, needs-you first and tappable, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1&tab=chat');
    const card = page.locator('.pb-digest-card').last();
    await expect(card).toContainText(/Yesterday: \d+ new problems?, \d+ resolved; top: .*; needs you: \d+\./);
    await expect(card.locator('.pb-digest-item').first()).toContainText('Needs you:');
    await expect(card.locator('.pb-digest-yours', { hasText: 'PR #919 needs a human' })).toBeVisible();
    expect(await overflowProblems(page.locator('body'))).toEqual([]);
    await card.getByRole('button', { name: 'Open Problems' }).click();
    await expect(page.getByRole('region', { name: /^Merge conflicts, floor \d+$/ })).toBeVisible();
  });
}
