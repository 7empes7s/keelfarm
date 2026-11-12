import { type Page } from '@playwright/test';
import { expect, test } from './helpers';

// The ▶ on every CEO message (#532, docs/voice.md "Replaying a message"), with the demo's fake ElevenLabs, at phone
// size in pocket mode: a message that arrived with the voice off still has a ▶; a tap shows the spinner while its clip
// is made, then plays it on the <audio> element the tap unlocked; ⏹ stops it; a second tap replays the saved clip
// without a new synthesis. Runs on Chromium and, when it's installed, WebKit (the iphone-voice project).

declare global {
  interface Window {
    __plays: { src: string; ok: boolean | null }[];
  }
}

interface Spoken {
  id: number;
  provider: string;
  end: number | null;
  replay?: true;
}

// One demo office serves every spec file: a key saved but the voice off, so new messages aren't read aloud.
test.beforeAll(async ({ request }) => {
  expect((await request.put('/api/voice/key', { data: { key: 'demo-voice-key-1234' } })).ok()).toBe(true);
  expect((await request.patch('/api/settings', { data: { voice: { provider: 'off', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery' } } })).ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  await request.put('/api/voice/key', { data: { key: '' } });
});

const spoken = (page: Page) => page.evaluate(() => ((window as unknown as { __swarmVoice?: Spoken[] }).__swarmVoice ?? []).map((s) => ({ ...s })));
const state = async (page: Page) => (await page.request.get('/api/state')).json();

test('a message that arrived with the voice off plays on a tap: spinner, then its clip; ⏹ stops; a replay reuses the clip', async ({ page }) => {
  // Every play() on an <audio> element, and whether it resolved.
  await page.addInitScript(() => {
    window.__plays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const rec = { src: this.src, ok: null as boolean | null };
      window.__plays.push(rec);
      const p = play.call(this);
      p.then(() => (rec.ok = true), () => (rec.ok = false));
      return p;
    };
  });
  // Made clips take a moment, so the spinner can be seen.
  const made: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith('/api/voice/messages/') && url.searchParams.get('tap') === '1',
    async (route) => {
      made.push(route.request().url());
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  await expect(page.locator('.chat-input textarea')).toBeVisible();

  const before = ((await state(page)).messages as { id: number; from: string }[]).map((m) => m.id);
  expect((await page.request.post('/api/ceo/message', { data: { text: 'How is it going?' } })).ok()).toBe(true);
  let id = 0;
  await expect
    .poll(async () => (id = ((await state(page)).messages as { id: number; from: string }[]).find((m) => m.from === 'ceo' && !before.includes(m.id))?.id ?? 0), { timeout: 30_000 })
    .toBeGreaterThan(0);
  const play = page.locator(`[data-msg="${id}"] .bubble-play`);
  await expect(play).toHaveAttribute('aria-label', 'Play this message');
  expect(await spoken(page)).toEqual([]); // the voice is off: nothing read aloud
  const chars = (await state(page)).voiceCache.charsToday as number;

  await play.click();
  await expect(play).toHaveAttribute('aria-label', /Getting the audio ready/);
  await expect(page.locator(`[data-msg="${id}"]`).getByText('Getting the audio ready…')).toBeVisible();
  await expect(play).toHaveAttribute('aria-label', 'Stop this message');
  expect(made).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => window.__plays.filter((p) => p.src.startsWith('blob:') && p.ok).length)).toBe(1);
  await expect.poll(async () => (await state(page)).voiceCache.saved.includes(id)).toBe(true);
  const charsAfter = (await state(page)).voiceCache.charsToday as number;
  expect(charsAfter).toBeGreaterThan(chars); // made once, counted in today's characters

  await play.click(); // ⏹
  await expect(play).toHaveAttribute('aria-label', 'Play this message');
  await expect.poll(async () => (await spoken(page)).filter((s) => s.id === id && s.replay && s.end !== null).length).toBe(1);

  // Again: the clip saved under the message, no new synthesis.
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Stop this message');
  await expect.poll(() => page.evaluate(() => window.__plays.filter((p) => p.src.startsWith('blob:') && p.ok).length)).toBe(2);
  await expect.poll(async () => (await spoken(page)).filter((s) => s.id === id && s.replay && s.end !== null).length, { timeout: 30_000 }).toBe(2);
  expect(made).toHaveLength(1);
  expect((await state(page)).voiceCache.charsToday).toBe(charsAfter);
  expect((await spoken(page)).every((s) => s.provider === 'elevenlabs')).toBe(true);
});
