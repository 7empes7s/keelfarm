import { expect, overflowProblems, test } from './helpers';

// IT tickets (#542): the IT department's list of office problems, open and closed with their counts, and a ticket's
// sheet with its evidence and what was done. At a phone's width and a computer's.

for (const width of [390, 1280]) {
  test(`IT tickets: open and closed with counts, a ticket opens its evidence and resolution, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?pocket=1#ceo/it-dept');
    const list = page.getByRole('region', { name: 'Tickets' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('button', { name: /Floor 1's preview won't start, open/ })).toBeVisible();

    await list.getByRole('button', { name: 'Closed', exact: true }).click();
    const oom = list.getByRole('button', { name: /Test lab: oom, closed/ });
    await expect(oom).toContainText('3×');
    await expect(oom).toContainText(/fixed in/);
    expect(await overflowProblems(page.locator('body'))).toEqual([]);

    await oom.click();
    const sheet = page.getByRole('dialog', { name: /^Ticket #\d+$/ });
    await expect(sheet).toContainText('npm test: exit code 137');
    await expect(sheet).toContainText('asked the CEO for a code fix');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
