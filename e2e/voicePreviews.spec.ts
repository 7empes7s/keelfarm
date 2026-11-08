import { type Page } from '@playwright/test';
import { expect, overflowProblems, test } from './helpers';
import { pocketSection } from './layout/helpers';

// Voice previews got ready ahead of a tap (#279), with the demo's slow fake ElevenLabs: the intro counts the first
// five, then the list; those play with no new request, scrolling loads more, each test line is fetched once, and
// reduced motion shows a still bar.

const CHOSEN = 'demoVoiceAvery00001';
const FAR_UP = 'demoV4Juniper000001'; // a v4 voice with no preview of its own: made only once it's on screen

test.afterAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { voice: { provider: 'off', speed: 1 } } });
  await request.put('/api/voice/key', { data: { key: '' } });
});

/** Settings → Voice in pocket mode, at a speed of its own so the office has none of its test lines made yet. */
async function openVoice(page: Page, width: number, speed: number) {
  expect((await page.request.put('/api/voice/key', { data: { key: 'demo-voice-key-5678' } })).ok()).toBe(true);
  expect((await page.request.patch('/api/settings', { data: { voice: { provider: 'elevenlabs', voiceId: CHOSEN, voiceName: 'Avery', speed, favourites: [] } } })).ok()).toBe(true);
  await page.setViewportSize({ width, height: 844 });
  const samples: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === '/api/voice/sample') samples.push(url.searchParams.get('voiceId') ?? '');
  });
  await page.goto('/?pocket=1');
  // Narrow, the header's button; wide, the rail's Console tab.
  await page.locator('.pk-tab-console, .pk-icon-btn[aria-label="Settings and notifications"]').first().click();
  const root = page.getByRole('dialog', { name: /Settings/ });
  // Wide, the console's tab groups; narrow, the list of sections. pocketSection asks which without waiting.
  await expect(root.locator('.cn-groups').or(root.getByRole('button', { name: /^Floors & repos/ }))).toBeVisible();
  await pocketSection(root, 'Voice');
  return { root, samples };
}

for (const [width, speed] of [
  [390, 0.85],
  [1280, 0.9],
] as const) {
  test(`the first five previews are ready before the list, the rest load as they scroll in (${width}px)`, async ({ page }) => {
    const { root, samples } = await openVoice(page, width, speed);
    const intro = root.locator('.voice-intro');
    await expect(intro).toContainText(/Getting voices ready… [0-4] of 5/);
    await expect(intro.locator('.voice-intro-wave')).toBeVisible();
    await expect(intro.getByRole('button', { name: 'Show the voices now' })).toBeVisible();
    expect(await overflowProblems(root)).toEqual([]);

    const list = root.locator('.voice-list');
    await expect(list).toBeVisible({ timeout: 15_000 });
    await expect(intro).toHaveCount(0);
    const chosen = list.locator(`[data-voice="${CHOSEN}"]`);
    await expect(chosen).toHaveAttribute('data-warm', 'ready');
    expect(await list.locator('[data-warm="ready"]').count()).toBeGreaterThanOrEqual(5);
    expect(await overflowProblems(root)).toEqual([]);

    // A warmed preview plays from the tab: no new request.
    const before = samples.length;
    await chosen.getByRole('button', { name: 'Preview Avery' }).click();
    await expect(chosen.getByRole('button', { name: 'Stop the preview of Avery' })).toBeVisible();
    expect(samples.slice(before)).not.toContain(CHOSEN);
    await chosen.getByRole('button', { name: 'Stop the preview of Avery' }).click();

    // A voice without a preview, not shortlisted, is only made once it scrolls into view.
    const far = list.locator(`[data-voice="${FAR_UP}"]`);
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight)); // the list opens on the chosen voice, near the bottom
    await page.waitForTimeout(500);
    expect(samples).not.toContain(FAR_UP);
    await list.evaluate((el) => (el.scrollTop = 0));
    await expect.poll(() => samples.includes(FAR_UP)).toBe(true);
    await expect(far).toHaveAttribute('data-warm', 'ready', { timeout: 15_000 });

    // Each test line was asked for once, however often it was warmed, seen or tapped.
    expect(samples.length).toBe(new Set(samples).size);
  });
}

test('reduced motion shows a still progress bar, and the list can be opened at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { root } = await openVoice(page, 390, 0.95);
  const intro = root.locator('.voice-intro');
  await expect(intro).toContainText(/of 5/);
  await expect(intro.locator('.voice-intro-wave')).toBeHidden();
  await expect(intro.locator('.voice-intro-bar')).toBeVisible();
  expect(await intro.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length)).toBe(0);
  await intro.getByRole('button', { name: 'Show the voices now' }).click();
  await expect(root.locator('.voice-list')).toBeVisible();
});
