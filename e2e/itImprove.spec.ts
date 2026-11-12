import { expect, overflowProblems, test } from './helpers';

// IT's improvements (#543): the Improvements section shows the demo's seeded trends (problems per week, causes with
// their status, what changed with before/after), and a review card's Approve files a (fake) issue the cause then links
// to. At a phone's width and a computer's.

for (const width of [390, 1280]) {
  test(`IT improvements: trends from seeded tickets, and Approve files an issue, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1#ceo/it-dept');
    const section = page.getByRole('region', { name: 'Improvements' });
    await expect(section).toBeVisible();
    await expect(section.getByRole('list', { name: 'Problems per week' }).getByRole('listitem')).toHaveCount(8);
    const causes = section.getByRole('list', { name: 'Costliest causes' });
    await expect(causes.getByRole('button', { name: /Test lab: oom: Fixed/ })).toBeVisible();
    await expect(causes.getByRole('button', { name: /Port taken for my dev server: Recurring/ })).toBeVisible();
    await expect(section.getByRole('list', { name: 'What changed' })).toContainText(/ a week before, [\d.]+ after/);
    expect(await overflowProblems(page.locator('body'))).toEqual([]);

    const card = section.getByRole('article', { name: 'Improvement: Stop leftover dev servers before a session starts' });
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(card).toBeHidden();
    const port = causes.getByRole('button', { name: /Port taken for my dev server/ });
    await expect(port).toContainText(/fix #\d+/);
    await port.click();
    const sheet = page.getByRole('dialog', { name: 'Port taken for my dev server' });
    await expect(sheet.getByRole('link', { name: /^#\d+ on floor 1$/ })).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
