import { expect, test } from './helpers';
import { pocketSection } from './layout/helpers';

// Settings → Voice → Test with the demo's fake ElevenLabs (#545): the tap unlocks the voice's <audio> element, the
// Test line is fetched, and it plays on that same element, with no error toast.

test.afterAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { voice: { provider: 'off', speed: 1 } } });
  await request.put('/api/voice/key', { data: { key: '' } });
});

test('Settings → Voice → Test plays the line on the element the tap unlocked', async ({ page }) => {
  expect((await page.request.put('/api/voice/key', { data: { key: 'demo-voice-key-5450' } })).ok()).toBe(true);
  expect((await page.request.patch('/api/settings', { data: { voice: { provider: 'elevenlabs', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery', speed: 0.95 } } })).ok()).toBe(true);
  // Every play(): which element and what it played (data: is the tap's moment of silence, blob: the Test line).
  await page.addInitScript(() => {
    const plays: { el: number; src: string }[] = [];
    const ids = new WeakMap<HTMLMediaElement, number>();
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!ids.has(this)) ids.set(this, ids.size + 1);
      plays.push({ el: ids.get(this)!, src: this.src.split(':')[0] });
      return play.call(this);
    };
    (window as unknown as { __plays: typeof plays }).__plays = plays;
  });
  const samples: string[] = [];
  page.on('request', (r) => new URL(r.url()).pathname === '/api/voice/sample' && samples.push(r.url()));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1');
  await page.locator('.pk-tab-console, .pk-icon-btn[aria-label="Settings and notifications"]').first().click();
  const root = page.getByRole('dialog', { name: /Settings/ });
  await expect(root.getByRole('button', { name: /^Floors & repos/ })).toBeVisible();
  await pocketSection(root, 'Voice');

  const plays = () => page.evaluate(() => (window as unknown as { __plays: { el: number; src: string }[] }).__plays.filter((p) => p.src !== 'data'));
  const before = (await plays()).length;
  await root.getByRole('button', { name: 'Test', exact: true }).first().click();
  await expect.poll(async () => (await plays()).slice(before).map((p) => p.src)).toContain('blob');
  expect(samples.length).toBeGreaterThan(0);
  const all = await page.evaluate(() => (window as unknown as { __plays: { el: number; src: string }[] }).__plays);
  const line = all.findLast((p) => p.src === 'blob')!;
  expect(all.some((p) => p.src === 'data' && p.el === line.el)).toBe(true); // unlocked by the tap, then played the line
  await expect(page.locator('.toast-error')).toHaveCount(0);
});
