import { type Page } from '@playwright/test';
import { CEO_ID } from '../shared/types';
import { ACKS } from '../shared/voiceTalk';
import { enterOffice, expect, test } from './helpers';

// The CEO talking while it works (#286, docs/voice.md "While the CEO works"), with the demo's fake ElevenLabs: a message
// sent mid-job is acked out loud at once and answered before the job ends, and progress lines follow the setting.

interface SaidLine {
  id: number;
  kind: 'ack' | 'progress';
  text: string;
  provider: string;
}

test.beforeAll(async ({ request }) => {
  expect((await request.put('/api/voice/key', { data: { key: 'demo-voice-key-1234' } })).ok()).toBe(true);
  expect((await request.patch('/api/settings', { data: { voice: { provider: 'elevenlabs', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery', talk: 'regular' } } })).ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { voice: { provider: 'off', talk: 'off' } } });
  await request.put('/api/voice/key', { data: { key: '' } });
});

const lines = (page: Page) => page.evaluate(() => ((window as unknown as { __swarmVoiceLines?: SaidLine[] }).__swarmVoiceLines ?? []).map((l) => ({ ...l })));
const state = async (page: Page) => (await page.request.get('/api/state')).json() as Promise<{ agents: { id: string; status: string }[]; messages: { id: number; from: string; text: string }[] }>;
/** Nothing read aloud for a moment: the startup's messages are done, so an ack doesn't queue behind them. */
const quiet = (page: Page) => page.evaluate(() => {
  const read = (window as unknown as { __swarmVoice?: { end: number | null }[] }).__swarmVoice ?? [];
  return read.every((r) => r.end !== null && performance.now() - r.end > 2500);
});
const ceoWorking = async (page: Page) => (await state(page)).agents.find((a) => a.id === CEO_ID)?.status === 'working';
const textCeo = async (page: Page, text: string) => expect((await page.request.post('/api/ceo/message', { data: { text } })).ok()).toBe(true);

/** Starts the demo CEO's long round (the step log's look-into job) and waits until it's under way. */
async function busyCeo(page: Page) {
  await expect.poll(() => ceoWorking(page), { timeout: 30_000 }).toBe(false);
  await textCeo(page, 'Please look into the mobile joystick');
  await expect.poll(() => ceoWorking(page), { timeout: 15_000 }).toBe(true);
}

test('a message mid-job is acked out loud and answered before the job ends; progress follows the setting', async ({ page }) => {
  await enterOffice(page);
  await busyCeo(page);
  await expect.poll(() => quiet(page), { timeout: 30_000 }).toBe(true);
  expect(await ceoWorking(page)).toBe(true);
  // Reproduce the race: the demo replies after 1.5 s, before this first clip becomes playable.
  let firstClip = true;
  await page.route('**/api/voice/lines/*', async (route) => {
    const delay = firstClip;
    firstClip = false;
    const response = await route.fetch();
    if (delay) await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fulfill({ response });
  });
  const before = (await state(page)).messages.filter((m) => m.from === 'ceo').length;
  await textCeo(page, 'Also check the footer');
  // As long as the player keeps an ack (ACK_MAX_AGE_MS): the 2 s delay above, plus the server's one-at-a-time synthesis.
  await expect.poll(async () => (await lines(page)).filter((l) => l.kind === 'ack').length, { timeout: 20_000 }).toBe(1);
  const [ack] = (await lines(page)).filter((l) => l.kind === 'ack');
  expect(ACKS).toContain(ack.text);
  expect(ack.provider).toBe('elevenlabs');
  // Inspect the synthesis fake's WAV comment via the real line endpoint, rather than trusting client probes alone.
  const clip = await page.request.get(`/api/voice/lines/${ack.id}`);
  expect(clip.ok()).toBe(true);
  const wav = await clip.body();
  const dataEnd = 44 + wav.readUInt32LE(40);
  const metadata = dataEnd + dataEnd % 2;
  expect(wav.toString('ascii', metadata + 8, metadata + 16)).toBe('INFOICMT');
  expect(wav.subarray(metadata + 20, metadata + 20 + wav.readUInt32LE(metadata + 16) - 1).toString('utf8')).toBe(ack.text);
  // The demo CEO answers mid-job, while it's still working.
  await expect.poll(async () => (await state(page)).messages.filter((m) => m.from === 'ceo').length, { timeout: 15_000 }).toBeGreaterThan(before);
  expect((await state(page)).messages.filter((m) => m.from === 'ceo').at(-1)?.text).toMatch(/^Noted/);
  expect(await ceoWorking(page)).toBe(true);
  // Regular progress: spoken lines while the round goes on, none of them a chat message, none with numbers or paths.
  await expect.poll(async () => (await lines(page)).filter((l) => l.kind === 'progress').length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  for (const l of await lines(page)) expect(l.text).toMatch(/^[^\d#/\\`*_[\]]+$/);
  expect((await state(page)).messages.some((m) => (m.from === 'ceo' || m.from === 'office') && ACKS.includes(m.text))).toBe(false);

  // Off: the next round says no progress at all.
  expect((await page.request.patch('/api/settings', { data: { voice: { talk: 'off' } } })).ok()).toBe(true);
  const said = (await lines(page)).filter((l) => l.kind === 'progress').length;
  await busyCeo(page);
  await expect.poll(() => ceoWorking(page), { timeout: 60_000 }).toBe(false);
  expect((await lines(page)).filter((l) => l.kind === 'progress').length).toBe(said);
});
