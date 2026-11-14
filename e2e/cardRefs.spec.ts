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

// A bare #N on two floors' boards asks "Which one?" (#678): a row per floor, each naming its floor, nothing wider than its row.
for (const width of [390, 1280]) {
  test(`"Which one?" names each floor and fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await (await page.request.get('/api/state')).json();
    const repos = state.repos as (Repo & { fullName: string })[];
    const numbers = (r: Repo) => new Set([...r.issues.map((i) => i.number), ...r.pulls.filter((p) => p.state !== 'CLOSED').map((p) => p.number)]);
    const n = [...numbers(repos[0])].find((x) => repos.filter((r) => numbers(r).has(x)).length > 1)!;
    expect(n, 'a number on two floors').toBeDefined();
    const floors = repos.filter((r) => numbers(r).has(n));
    await page.request.post('/api/ceo/message', { data: { text: `What's left on #${n}? (#678 ${width})` } });
    await page.goto('/?pocket=1&tab=chat');
    await page.locator('.bubble-text', { hasText: `(#678 ${width})` }).last().locator('.ref-chip').first().click();
    const sheet = page.getByRole('dialog', { name: 'Which one?' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(`#${n} is on`);
    const rows = sheet.locator('.ref-pick-row');
    await expect(rows).toHaveCount(floors.length);
    for (const r of floors) await expect(rows.filter({ hasText: `Floor ${r.floor} · ${r.fullName.split('/')[1]}` })).toHaveCount(1);
    const problems = await sheet.evaluate((el) => {
      const out: string[] = [];
      const box = el.getBoundingClientRect();
      for (const row of el.querySelectorAll<HTMLElement>('.ref-pick-row, .ref-pick-item, .ref-pick-floor')) {
        const r = row.getBoundingClientRect();
        if (row.scrollWidth > row.clientWidth + 1) out.push(`"${row.innerText}" overflows (${row.scrollWidth} > ${row.clientWidth}px)`);
        if (r.left < box.left - 1 || r.right > box.right + 1) out.push(`"${row.innerText}" sticks out of the sheet`);
        if (row.classList.contains('ref-pick-row') && r.height < 44) out.push(`"${row.innerText}" is ${r.height}px tall`);
      }
      return out;
    });
    expect(problems).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`which-one-${width}.png`) });
    await rows.first().click();
    await expect(sheet).toBeHidden();
  });
}
