import { type Page } from '@playwright/test';
import { enterOffice, expect, test } from './helpers';

// A voice call with the CEO (#287, docs/voice.md "Calling the CEO"): one session whatever is on screen. Headless
// Chromium has no microphone: __swarmMic.fake() stands in for the recognition, and the demo's voice reads each reply as
// a chime about as long as reading it would take.

interface CallProbe {
  state: { id: number; phase: string; muted: boolean; paused: boolean; held: number; minimised: boolean; reply: { id: number; sentence: number } | null };
  position(): Promise<{ id: number; sentence: number; ms: number } | null>;
}
type CallWindow = { __swarmCall: CallProbe; __swarmMic: { fake(): void; say(text: string, final?: boolean): boolean }; __swarmSfx: { name: string; t: number }[] };

test.beforeAll(async ({ request }) => {
  expect((await request.put('/api/voice/key', { data: { key: 'demo-voice-key-1234' } })).ok()).toBe(true);
  await request.patch('/api/settings', { data: { voice: { provider: 'elevenlabs', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery' }, listen: { provider: 'browser', autoSend: false, handsFree: false } } });
});

test.afterAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { voice: { provider: 'off' }, listen: { provider: 'browser', autoSend: false, handsFree: false } } });
  await request.put('/api/voice/key', { data: { key: '' } });
});

const call = (page: Page) => page.evaluate(() => (window as unknown as CallWindow).__swarmCall.state);
const phase = async (page: Page) => (await call(page)).phase;
const position = (page: Page) => page.evaluate(() => (window as unknown as CallWindow).__swarmCall.position());
const say = (page: Page, text: string, final = true) => page.evaluate(([t, f]) => (window as unknown as CallWindow).__swarmMic.say(t, f), [text, final] as const);
const now = (page: Page) => page.evaluate(() => performance.now());

async function managerTexts(page: Page): Promise<string[]> {
  const state = await (await page.request.get('/api/state')).json();
  return (state.messages as { from: string; text: string }[]).filter((m) => m.from === 'manager').map((m) => m.text);
}

/** Says `text` as one turn and waits for the CEO's spoken reply to start. */
async function turn(page: Page, text: string) {
  await expect.poll(() => phase(page)).toBe('listening');
  await expect.poll(() => say(page, text)).toBe(true);
  await expect.poll(async () => (await managerTexts(page)).at(-1), { timeout: 15_000 }).toBe(text);
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('speaking');
}

for (const width of [390, 1280]) {
  test(`a call goes on through other pages, with barge-in, skip, mute and the pill, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?pocket=1&tab=chat');
    await page.waitForFunction(() => '__swarmMic' in window);
    await page.evaluate(() => (window as unknown as CallWindow).__swarmMic.fake());
    const dock = page.locator('.pk-dock');
    if (width >= 640) await expect(dock).toBeVisible();
    await page.getByRole('button', { name: /^Call / }).first().click();
    await expect.poll(() => phase(page)).toBe('listening');
    if (width >= 640) await expect(dock).toBeHidden(); // the docked chat tucks away behind the call card
    const bg = (key: string) => page.locator(`[data-key="${key}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg('end')).not.toBe(await bg('mute')); // End is red
    const { id } = await call(page);
    const since = await now(page);
    const toasts = page.locator('.toasts .toast');

    // A turn, then pages opened mid-reply: the voice goes on from where it was.
    await turn(page, 'How is floor one doing');
    const before = await position(page);
    expect(before).not.toBeNull();
    if (width < 640) {
      await page.getByRole('button', { name: 'Minimise the call' }).click();
      await expect(page.locator('.vcall-pill')).toBeVisible();
    }
    for (const tab of await page.locator('.pk-tabs .pk-tab:not(.pk-tab-console)').all().then((t) => t.slice(1, 3))) await tab.click();
    await page.locator('.pk-tab-console, .pk-icon-btn[aria-label="Settings and notifications"]').first().click();
    const after = await position(page);
    expect((await call(page)).id).toBe(id);
    if (after) {
      expect(after.id).toBe(before!.id);
      expect(after.ms).toBeGreaterThanOrEqual(before!.ms); // never back to the start
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 640) {
      await page.locator('.vcall-pill').click();
      await expect(page.locator('.vcall-screen')).toBeVisible();
    } else {
      await expect(page.locator('.vcall-card')).toBeVisible();
    }
    await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('listening');

    // Skip moves on a sentence (or ends a one-sentence reply).
    await turn(page, 'What merged today');
    await page.locator('[data-key="skip"]').click();
    await expect.poll(async () => ((await call(page)).reply?.sentence ?? 99) >= 1).toBe(true);
    await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('listening');

    // Talking over the CEO stops the voice at once and becomes the next message.
    await turn(page, 'Anything blocked');
    for (const words of ['wait', 'wait one', 'wait one sec', 'wait one second', 'wait one second']) {
      await say(page, words, false); // interim results, as the recognition sends them while you talk
      await page.waitForTimeout(100);
    }
    await expect.poll(() => phase(page), { timeout: 1000 }).toBe('listening');
    expect(await position(page)).toBeNull();
    await say(page, 'wait one second');
    await expect.poll(async () => (await managerTexts(page)).at(-1), { timeout: 15_000 }).toBe('Wait one second');

    // Mute keeps the call.
    await page.locator('[data-key="mute"]').click();
    expect(await call(page)).toMatchObject({ id, muted: true });
    await page.locator('[data-key="mute"]').click();

    // Nothing rang or toasted during the call: the CEO's notices waited, and show once it ends.
    const sounds = await page.evaluate((t) => (window as unknown as CallWindow).__swarmSfx.filter((s) => s.t > t && /^cue:|chirp|gong/.test(s.name)).map((s) => s.name), since);
    expect(sounds).toEqual([]);
    await expect(toasts).toHaveCount(0);
    expect((await call(page)).held).toBeGreaterThan(0);
    await page.locator('[data-key="end"]').click();
    expect(await phase(page)).toBe('ended');
    await expect(page.locator('.vcall-screen, .vcall-card, .vcall-pill')).toHaveCount(0);
    await expect(toasts.first()).toBeVisible();
    await expect(page.locator('.chat-log')).toBeVisible(); // End brings the chat back
    if (width >= 640) await expect(dock).toBeVisible();
  });
}

test('the 3D office on a desktop calls too: the chat tucks away behind the orb, and the keys work', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterOffice(page);
  await page.evaluate(() => (window as unknown as CallWindow).__swarmMic.fake());
  await page.keyboard.press('p');
  await expect(page.locator('.phone')).toBeVisible();
  if (!(await page.locator('.chat-input').isVisible())) await page.locator('.phone-tab').first().click(); // it opens on Team when a team change waits there
  await page.getByRole('button', { name: /^Call / }).first().click();
  await expect(page.locator('.vcall-card')).toBeVisible();
  await expect(page.locator('.phone')).toBeHidden();
  await expect.poll(() => phase(page)).toBe('listening');
  await page.locator('body').focus();
  await page.keyboard.press('m');
  expect((await call(page)).muted).toBe(true);
  await page.keyboard.press('Space');
  expect((await call(page)).paused).toBe(true);
  await page.getByRole('button', { name: 'Fold the call card' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.vcall-bubble')).toBeVisible();
  await page.locator('.vcall-bubble').focus();
  await page.keyboard.press('Escape'); // Esc ends the call from the call's own controls
  expect(await phase(page)).toBe('ended');
  await expect(page.locator('.phone')).toBeVisible();
});
