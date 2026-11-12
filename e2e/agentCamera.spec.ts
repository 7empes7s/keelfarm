import { type Page } from '@playwright/test';
import { enterOffice, expect, test } from './helpers';

// An agent's camera (#539): "turn on your camera" on a call, or the Camera chip in an agent's chat, shows their 3D
// character live in a picture-in-picture tile; the mouth follows the voice's level (QA's fake one here), × closes it.

type CamWindow = {
  __swarmAgentCam: { state: { agent: string | null }; mouth: number; frames: number; on(id: string): void; level(v: number | null): void };
  __swarmCall: { phase: string };
  __swarmMic: { fake(): void; say(text: string, final?: boolean): boolean };
};
const cam = (page: Page) => page.evaluate(() => (window as unknown as CamWindow).__swarmAgentCam.state.agent);
const mouth = (page: Page) => page.evaluate(() => (window as unknown as CamWindow).__swarmAgentCam.mouth);

/** How many distinct colours the tile's canvas has: an empty or black canvas has one. */
const colours = (page: Page) =>
  page.locator('.cam-tile canvas').evaluate((c: HTMLCanvasElement) => {
    const g = document.createElement('canvas');
    g.width = 32;
    g.height = 32;
    const ctx = g.getContext('2d')!;
    ctx.drawImage(c, 0, 0, 32, 32);
    const px = ctx.getImageData(0, 0, 32, 32).data;
    const seen = new Set<number>();
    for (let i = 0; i < px.length; i += 4) seen.add((px[i] >> 4) * 256 + (px[i + 1] >> 4) * 16 + (px[i + 2] >> 4));
    return seen.size;
  });

/** Fake audio: the level rises and falls like speech, and the mouth with it; then silence shuts it. */
async function mouthFollowsAudio(page: Page) {
  await page.evaluate(() => {
    let t = 0;
    (window as unknown as { __fakeVoice: number }).__fakeVoice = window.setInterval(() => (window as unknown as CamWindow).__swarmAgentCam.level(Math.abs(Math.sin((t += 0.4))) * 0.6), 50);
  });
  await expect.poll(() => mouth(page), { timeout: 15_000, message: 'the mouth opens while the voice plays' }).toBeGreaterThan(0.3);
  await page.evaluate(() => {
    clearInterval((window as unknown as { __fakeVoice: number }).__fakeVoice);
    (window as unknown as CamWindow).__swarmAgentCam.level(0);
  });
  await expect.poll(() => mouth(page), { timeout: 15_000, message: 'and shuts in silence' }).toBeLessThan(0.05);
  await page.evaluate(() => (window as unknown as CamWindow).__swarmAgentCam.level(null));
}

async function tileWorks(page: Page, width: number) {
  const tile = page.locator('.cam-tile');
  await expect(tile.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => colours(page), { timeout: 30_000, message: 'the tile draws the character, not an empty canvas' }).toBeGreaterThan(8);
  await mouthFollowsAudio(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const box = (await tile.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: test.info().outputPath(`camera-${width}.png`) });
  await tile.getByRole('button', { name: /^Turn off .+'s camera$/ }).click();
  await expect(tile).toHaveCount(0);
}

for (const width of [390, 1280]) {
  test(`on a call, "turn on your camera" shows the CEO live, at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?pocket=1&tab=chat');
    await page.waitForFunction(() => '__swarmMic' in window && '__swarmAgentCam' in window);
    await page.evaluate(() => (window as unknown as CamWindow).__swarmMic.fake());
    await page.getByRole('button', { name: /^Call / }).first().click();
    await expect.poll(() => page.evaluate(() => (window as unknown as CamWindow).__swarmCall.phase)).toBe('listening');
    await expect.poll(() => page.evaluate(() => (window as unknown as CamWindow).__swarmMic.say('Turn on your camera', true))).toBe(true);
    await expect.poll(() => cam(page)).toBe('ceo');
    const state = await (await request.get('/api/state')).json();
    expect((state.messages as { from: string; text: string }[]).some((m) => m.from === 'manager' && /camera/i.test(m.text)), 'the ask stays here, never sent to the CEO').toBe(false);
    await expect(page.locator('.vcall-screen, .vcall-card')).toBeVisible(); // nothing of the call screen goes
    await tileWorks(page, width);
    await page.locator('[data-key="end"]').click();
  });

  test(`an agent's chat has a Camera chip that shows them live, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?pocket=1#agent/linus/chat');
    const ask = page.getByRole('button', { name: /^Camera$/ });
    await expect(ask).toBeVisible({ timeout: 30_000 });
    const details = page.getByRole('button', { name: 'Close the details' }); // beside the docked CEO chat it sheets over the chat
    if (await details.isVisible()) await details.click();
    await ask.click();
    // busy with a fix or a test, they're camera shy once; the second ask turns it on
    if (!(await cam(page))) await ask.click();
    await expect.poll(() => cam(page)).not.toBeNull();
    await expect(page.getByRole('button', { name: /^Camera off$/ })).toBeVisible();
    await tileWorks(page, width);
  });
}

test('the 3D office keeps its frame rate with the camera tile open', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?camera=ceo');
  await enterOffice(page, { loaded: true });
  // the main view's frames over 6 s (software WebGL in the lab is slow, so it's a ratio, not a number)
  const frames = () => page.evaluate(() => new Promise<number>((done) => {
    let n = 0;
    const end = performance.now() + 6000;
    const tick = () => (performance.now() < end ? (n++, requestAnimationFrame(tick)) : done(n));
    requestAnimationFrame(tick);
  }));
  await expect(page.locator('.cam-tile canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(10_000); // its shaders compile first, slowly in software WebGL
  const withTile = await frames();
  expect(await page.evaluate(() => (window as unknown as CamWindow).__swarmAgentCam.frames), 'the tile draws').toBeGreaterThan(5);
  await page.evaluate(() => document.exitPointerLock()); // looking around holds the mouse, as Esc frees it
  await page.getByRole('button', { name: /^Turn off .+'s camera$/ }).click();
  await expect(page.locator('.cam-tile')).toHaveCount(0);
  await page.waitForTimeout(2000);
  const without = await frames();
  expect(withTile, `main view frames in 6 s with the tile vs ${without} without`).toBeGreaterThanOrEqual(without * 0.7);
});
