import { expect, overflowProblems, test } from './helpers';

// Screen audit 1/4 (#513): every pocket and 2D page in its scope, opened cold through its deep link on a 390px phone:
// it shows (data-route-ready="1"), nothing scrolls sideways, and the fixture fails on any console error. Each screen
// is also photographed top to bottom into the test's output folder, for QA's report (never committed).

// No service worker: its precache of / would be cut off by the next cold load. Reduced motion: an indeterminate
// progress bar's sweep, caught mid-slide, isn't a layout that scrolls sideways.
test.use({ serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' } });

const SCOPE = /^#(tab\/(company|kanban|approvals)|company\/ops|previews|floor\/\d+\/(kanban|app)|pr\/|issue\/|usage|notices|sound)/;

test('every pocket and 2D page in the audit fits a 390px phone', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1');
  await expect(page.locator('html[data-route-ready="1"]')).toBeAttached();
  const links = (await page.evaluate(() => (window as unknown as { __swarmRoutes: { links(): string[] } }).__swarmRoutes.links())).filter((l) => SCOPE.test(l));
  expect(links.length).toBeGreaterThan(8);
  const problems: string[] = [];
  for (const [i, link] of links.entries()) {
    await page.goto(`/?pocket=1&audit=${i}${link}`); // a new query: a cold load
    await expect(page.locator('html'), link).toHaveAttribute('data-route-ready', '1', { timeout: 30_000 });
    await page.waitForTimeout(400); // lazy panels and measured layouts settle
    for (const p of await overflowProblems(page.locator('body'))) problems.push(`${link}: ${p}`);
    // top to bottom: the tallest visible scroll box, a screen at a time
    const name = link.replace(/\W+/g, '-').replace(/^-|-$/g, '');
    for (let shot = 0; shot < 4; shot++) {
      await page.screenshot({ path: info.outputPath(`${name}-${shot}.png`) });
      const moved = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll<HTMLElement>('*')].filter((b) => b.scrollHeight > b.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(b).overflowY) && b.checkVisibility());
        const box = boxes.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0];
        if (!box || box.scrollTop + box.clientHeight >= box.scrollHeight - 1) return false;
        box.scrollTop += box.clientHeight - 80;
        return true;
      });
      if (!moved) break;
      await page.waitForTimeout(150);
    }
  }
  expect(problems).toEqual([]);
});
