// Issue refs open their card wherever it is (#505): an issue whose PR is open opens that PR's card, and a card that's
// off the board says what it was with GitHub links, never an empty page.
import { expect, test } from './helpers';

type Repo = { floor: number; issues: { number: number; title: string }[]; pulls: { number: number; state: string; closesIssues: number[] }[] };

test('an issue with an open PR opens its card at 390px: title, PR and actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await (await page.request.get('/api/state')).json();
  const repos = state.repos as Repo[];
  const repo = repos.find((r) => r.pulls.some((p) => p.state === 'OPEN' && r.issues.some((i) => p.closesIssues.includes(i.number))))!;
  const pull = repo.pulls.find((p) => p.state === 'OPEN' && repo.issues.some((i) => p.closesIssues.includes(i.number)))!;
  const issue = repo.issues.find((i) => pull.closesIssues.includes(i.number))!;

  await page.goto(`/?pocket=1#issue/${repo.floor}/${issue.number}`);
  const card = page.locator('.cardview');
  await expect(card).toBeVisible();
  await expect(card).not.toContainText("isn't on the board");
  await expect(card.locator('.dp-title')).toContainText(issue.title.slice(0, 20));
  await expect(card.getByText(`PR #${pull.number}`).first()).toBeVisible();
  await expect(card.getByRole('link', { name: /Open on GitHub/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('issue-with-pr-390.png') });
});

test("a card that's off the board shows what it was and its GitHub links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await (await page.request.get('/api/state')).json();
  const repo = (state.repos as Repo[])[0];
  await page.goto(`/?pocket=1#issue/${repo.floor}/99999`);
  const card = page.locator('.cardview');
  await expect(card).toContainText('Off the board');
  await expect(card.getByRole('link', { name: /Issue on GitHub/ })).toHaveAttribute('href', /\/issues\/99999$/);
  await expect(card.getByRole('button', { name: `Floor ${repo.floor}'s board` })).toBeVisible();
  await expect(page.getByRole('button', { name: /Close|Back/ }).first()).toBeVisible();
});
