import { expect, test } from './helpers';

// The working strip at a phone's width (#150): a long step ellipsizes on one line, the elapsed time and step count stay
// whole and pinned right, before the Stop button.
test('the working strip keeps its time and step count at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post('/api/ceo/message', { data: { text: 'Look into the joystick on phones' } });
  await page.goto('/?pocket=1&tab=chat');
  const root = page.locator('.pocket');
  await expect(root.locator('.working-now', { hasText: 'joystickThumbZone' })).toBeVisible({ timeout: 90_000 }); // the demo's long step
  const problems = await root.locator('.working-row').evaluate((row) => {
    const out: string[] = [];
    const now = row.querySelector<HTMLElement>('.working-now')!;
    const meta = row.querySelector<HTMLElement>('.working-meta')!;
    const r = row.getBoundingClientRect();
    const m = meta.getBoundingClientRect();
    const stop = row.querySelector('.working-stop')!.getBoundingClientRect();
    if (!/^\S.* · step \d/.test(meta.innerText)) out.push(`the meta reads "${meta.innerText}"`);
    if (meta.scrollWidth > meta.clientWidth + 1 || m.width < 1) out.push(`the time and step are cut (${meta.scrollWidth} > ${meta.clientWidth}px)`);
    if (m.left < r.left || m.right > stop.left + 1) out.push('the time and step are off the row');
    if (now.scrollWidth <= now.clientWidth) out.push('the long step is not ellipsized');
    if (now.getClientRects().length > 1 || now.getBoundingClientRect().height > 2 * parseFloat(getComputedStyle(now).fontSize)) out.push('the step wraps');
    return out;
  });
  expect(problems).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
