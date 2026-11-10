import { type Page } from '@playwright/test';
import { MEETING_HEAD } from '../client/src/world/layout';
import { enterOffice, expect, test } from './helpers';

// The meeting room (#369, docs/voice.md "The meeting room"): a call brings the CEO to the table's head and the call
// card shows the room live; folding the card stops the view; ending the call sends the CEO back to their desk.

interface Person {
  id: string;
  stage: string;
  x: number;
  z: number;
}
type MeetingWindow = { __swarmCall: { start(): void; end(): void }; __swarmPeople: { list(): Person[] } };

const ceo = (page: Page) => page.evaluate(() => (window as unknown as MeetingWindow).__swarmPeople.list().find((p) => p.id === 'ceo') ?? null);
const fromHead = async (page: Page) => {
  const c = await ceo(page);
  return c ? Math.hypot(c.x - MEETING_HEAD.x, c.z - MEETING_HEAD.z) : Infinity;
};

test('a call brings the CEO to the meeting table and shows the room in the call card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterOffice(page);
  await page.evaluate(() => (window as unknown as MeetingWindow).__swarmCall.start());
  await expect(page.locator('.vcall-card .vcall-tile canvas')).toBeVisible();
  await expect.poll(() => fromHead(page), { timeout: 45_000, message: 'the CEO walks to the head of the table' }).toBeLessThan(0.3);

  await page.getByRole('button', { name: 'Fold the call card' }).click();
  await expect(page.locator('.vcall-tile')).toHaveCount(0);

  await page.evaluate(() => (window as unknown as MeetingWindow).__swarmCall.end());
  await expect.poll(async () => (await ceo(page))?.stage, { timeout: 45_000, message: 'the CEO goes back to their desk' }).toBe('seated');
  expect(await fromHead(page)).toBeGreaterThan(5);
});

test('sat at the table, the call card leaves the room view out', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?meeting=seat');
  await enterOffice(page, { loaded: true });
  await expect(page.locator('.vcall-card')).toBeVisible();
  await expect(page.locator('.vcall-tile')).toHaveCount(0);
});
