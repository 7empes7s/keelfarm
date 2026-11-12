import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from './helpers';

// The wake word (#537, docs/voice.md "Wake word"): Settings → Voice → Wake word on, then a fake mic (a
// MediaStream the test plays the synthetic clips into, client/src/ui/wake/fixtures/) feeds the real models in the
// page. The wake phrase starts the call with the demo's fake Jarvis voice; a near-miss doesn't; a hidden tab stops it.

type WakeWindow = {
  __swarmWake: { status: string; wakes: number };
  __swarmCall: { phase: string; agent: string; end(): void };
  __fakeMic: { play(b64: string): Promise<void>; live(): number };
};

const clip = (name: string) => readFileSync(path.join('client', 'src', 'ui', 'wake', 'fixtures', `${name}.wav`)).toString('base64');

test.use({
  permissions: ['microphone'],
  launchOptions: [async ({ browserName, launchOptions }, use) => use(browserName === 'chromium' ? { ...launchOptions, args: [...(launchOptions.args ?? []), '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] } : launchOptions), { scope: 'worker' }],
});

test.beforeEach(async ({ page }) => {
  // The mic is a stream the test plays WAVs into; each getUserMedia gets a fresh track, so a stopped one shows.
  await page.addInitScript(() => {
    let ctx: AudioContext | null = null;
    const dests: MediaStreamAudioDestinationNode[] = [];
    const audio = () => (ctx ??= new AudioContext());
    navigator.mediaDevices.getUserMedia = async () => {
      const dest = audio().createMediaStreamDestination();
      dests.push(dest);
      return dest.stream;
    };
    (window as unknown as WakeWindow).__fakeMic = {
      live: () => dests.filter((d) => d.stream.getAudioTracks().some((t) => t.readyState === 'live')).length,
      play: async (b64: string) => {
        const c = audio();
        await c.resume();
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        const pcm = new Int16Array(bytes.buffer, 44, (bytes.length - 44) >> 1);
        const buf = c.createBuffer(1, pcm.length, 16000);
        buf.getChannelData(0).set(Float32Array.from(pcm, (v) => v / 32768));
        const src = c.createBufferSource();
        src.buffer = buf;
        for (const d of dests) src.connect(d);
        await new Promise<void>((done) => {
          src.onended = () => done();
          src.start();
        });
      },
    };
  });
});

test.beforeAll(async ({ request }) => {
  expect((await request.put('/api/voice/key', { data: { key: 'demo-voice-key-1234' } })).ok()).toBe(true);
  await request.patch('/api/settings', { data: { voice: { provider: 'elevenlabs', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery', agent: { on: true, capHours: 15 } } } });
});

test.afterAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { voice: { provider: 'off', agent: { on: true, capHours: 15 } } } });
  await request.put('/api/voice/key', { data: { key: '' } });
});

const wake = (page: Page) => page.evaluate(() => ({ status: (window as unknown as WakeWindow).__swarmWake.status, wakes: (window as unknown as WakeWindow).__swarmWake.wakes, phase: (window as unknown as WakeWindow).__swarmCall.phase }));
const play = (page: Page, name: string) => page.evaluate((b64) => (window as unknown as WakeWindow).__fakeMic.play(b64), clip(name));

async function turnOn(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1#settings/voice');
  await page.locator('html[data-route-ready]').waitFor();
  const settings = page.getByTestId('wake-settings');
  await settings.scrollIntoViewIfNeeded();
  await settings.getByRole('checkbox', { name: /Start a call by saying/ }).check();
  await expect(settings.getByTestId('wake-status')).toHaveAttribute('data-status', 'listening', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: /Listening for "Hey Mimoun"/ })).toBeVisible();
}

test('the wake word: on shows the mic light, a near-miss is ignored, "Hey Mimoun" starts the call', async ({ page }) => {
  await turnOn(page);
  await play(page, 'hey-simon-lessac');
  await play(page, 'sentence-lessac');
  await page.waitForTimeout(500);
  expect(await wake(page)).toMatchObject({ wakes: 0, phase: 'idle', status: '' });

  await play(page, 'hey-mimoun-lessac');
  await expect.poll(async () => (await wake(page)).wakes).toBe(1);
  await expect.poll(async () => (await wake(page)).phase).not.toBe('idle');
  await expect.poll(() => page.evaluate(() => (window as unknown as WakeWindow).__swarmCall.agent)).toMatch(/connecting|live/);
  // Paused during the call: its mic is released and the light goes out.
  await expect.poll(async () => (await wake(page)).status).toBe('call');
  await expect(page.getByRole('button', { name: /Listening for/ })).toHaveCount(0);

  await page.evaluate(() => (window as unknown as WakeWindow).__swarmCall.end());
  await expect.poll(async () => (await wake(page)).status, { timeout: 60_000 }).toBe('');
});

test('the wake word stops listening while the tab is hidden, and listens again on return', async ({ page }) => {
  await turnOn(page);
  expect(await page.evaluate(() => (window as unknown as WakeWindow).__fakeMic.live())).toBe(1);
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await expect.poll(async () => (await wake(page)).status).toBe('hidden');
  expect(await page.evaluate(() => (window as unknown as WakeWindow).__fakeMic.live())).toBe(0);
  await play(page, 'hey-mimoun-lessac');
  expect((await wake(page)).wakes).toBe(0);

  await setHidden(false);
  await expect.poll(async () => (await wake(page)).status).toBe('');
  await expect(page.getByRole('button', { name: /Listening for "Hey Mimoun"/ })).toBeVisible();
  // Off again: nothing listens, the light goes.
  await page.getByTestId('wake-settings').getByRole('checkbox', { name: /Start a call by saying/ }).uncheck();
  await expect(page.getByRole('button', { name: /Listening for/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as WakeWindow).__fakeMic.live())).toBe(0);
});
