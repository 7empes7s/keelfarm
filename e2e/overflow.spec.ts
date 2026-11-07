import type { Locator, Page } from '@playwright/test';
import { MANAGER_DESK } from '../client/src/world/layout';
import { GROUPS, sectionsIn, type Where } from '../client/src/ui/consoleNavRules';
import { consoleSection, pocketSection } from './layout/helpers';
import { enterOffice, expect, overflowProblems, startAt, test } from './helpers';

// Nothing drags sideways (#149). The manager's own words are longer than the demo's: with a charter of unbroken paths
// and URLs on every floor, no console section has anything past its edge (pocket mode and the 3D office), and on a
// phone a sideways swipe on a section moves nothing, even with something too wide in it (the panels' safety net).
// layout.spec.ts runs the same overflow check on every screen as the demo has it.

const LONG = 'https://github.com/7empes7s/keelfarm/blob/main/client/src/ui/consoleSectionWithAVeryLongFileName.tsx';
const LONG_CHARTER = {
  mission: `Ship ${LONG} and /root/Projects/keelfarm/server/swarm/scheduling.ts`,
  objectives: [{ id: 'O1', outcome: `Every screen fits ${LONG}`, measure: `docs/design.md#${'no-sideways-scroll-'.repeat(4)}` }],
  standards: [`Never touch ${LONG}`],
  nonGoals: [`Editing ${'~/.claude/settings.json/'.repeat(3)}`],
  focus: `swarm/issue-149-${'a'.repeat(60)}`,
};

/** Every floor's charter set to LONG_CHARTER for the test; returns what puts them back. */
async function longCharters(page: Page) {
  const { repos } = await (await page.request.get('/api/state')).json();
  const put = (id: string, charter: unknown) => page.request.put(`/api/repos/${encodeURIComponent(id)}/charter`, { data: { charter } });
  for (const r of repos) await put(r.id, LONG_CHARTER);
  return async () => {
    for (const r of repos) await put(r.id, { mission: r.mission, ...r.charter });
  };
}

/** The console: pocket mode's Settings, or the manager's console at their desk in the 3D office. */
async function openConsole(page: Page, where: Where) {
  if (where === 'pocket') {
    await page.goto('/?pocket=1');
    await page.locator('[title="Settings and notifications"]:visible').first().click(); // the header's ⚙️, or the rail's Console when wide
    return page.getByRole('dialog', { name: /Settings/ });
  }
  await startAt(page, { floor: 0, x: MANAGER_DESK.x, z: MANAGER_DESK.z + MANAGER_DESK.d / 2 + 0.8, yaw: 0, pitch: -0.6 });
  await page.goto('/?pocket=0');
  await enterOffice(page, { loaded: true });
  const skipTour = page.getByRole('button', { name: 'Skip tour' });
  if (await skipTour.isVisible()) await skipTour.dispatchEvent('click');
  await expect(page.getByText("Open the manager's console")).toBeVisible(); // aimed at the desk
  await page.keyboard.press('e');
  return page.getByRole('dialog', { name: /Manager's console/ });
}

async function openSection(root: Locator, group: string, label: string) {
  if (await root.locator('.cn-groups').isVisible()) await consoleSection(root, group, label);
  else await pocketSection(root, label);
}

/**
 * A finger dragging right to left across `box` with something too wide in it (the overflow a future bug could bring):
 * how far anything moved sideways. Touch events, so the page needs hasTouch.
 */
async function swipeSideways(page: Page, box: Locator) {
  const b = (await box.boundingBox())!;
  const moved = () => box.evaluate((el) => [el.scrollLeft, document.scrollingElement!.scrollLeft, el.getBoundingClientRect().left]);
  await box.evaluate((el) => el.append(Object.assign(document.createElement('div'), { className: 'overflow-probe', style: 'width: 300vw; height: 1px' })));
  const before = await moved();
  const cdp = await page.context().newCDPSession(page);
  const [x, y] = [b.x + b.width - 20, b.y + Math.min(b.height / 2, 300)];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * (b.width / 14), y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(200);
  const after = await moved();
  await box.evaluate((el) => el.querySelector(':scope > .overflow-probe')?.remove());
  return Math.max(...after.map((v, i) => Math.abs(v - before[i])));
}

test.use({ hasTouch: true });

for (const [where, widths] of [
  ['pocket', [375, 390, 1280]],
  ['office', [390, 1280]], // the 3D office boots WebGL: two widths
] as const) {
  for (const width of widths) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`console sections fit long words, ${where} at ${width}px, ${scheme}`, async ({ page }) => {
        test.setTimeout(300_000);
        await page.setViewportSize({ width, height: width < 800 ? 844 : 800 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        const restore = await longCharters(page);
        try {
          const root = await openConsole(page, where);
          await expect(root.locator('.cn-sections, .cn-list').first()).toBeVisible(); // the side menu, or a phone's list
          const problems: string[] = [];
          for (const g of GROUPS) {
            for (const s of sectionsIn(g.id, where)) {
              await openSection(root, g.label, s.label);
              await page.waitForTimeout(300); // lazy sections and settled layout
              const at = `${g.label} › ${s.label}`;
              for (const p of await overflowProblems(root)) problems.push(`${at}: ${p}`);
              if (width >= 800) continue;
              const moved = await swipeSideways(page, root.locator('.panel-body').first());
              if (moved > 1) problems.push(`${at}: a sideways swipe moved the section ${Math.round(moved)}px`);
            }
          }
          if (where === 'pocket') {
            await openSection(root, 'Company', 'Charter');
            await root.getByRole('button', { name: '✏️ Edit', exact: true }).click();
            for (const p of await overflowProblems(root)) problems.push(`Charter editor: ${p}`);
          }
          expect(problems).toEqual([]);
        } finally {
          await restore();
        }
      });
    }
  }
}
