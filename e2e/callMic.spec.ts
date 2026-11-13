import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from './helpers';

// A call that hears a real microphone (#648): Chromium's fake device plays spoken words ("What is floor one doing",
// e2e/fixtures/speech.wav, then 9 s of quiet, on a loop) as the mic. The Jarvis voice gets them as audio
// (user_audio_chunk; the demo's fake agent logs "voice agent (demo): the call's mic audio arrives"); without it the
// office's own speech to text takes each turn (the server logs "voice: transcribed …"; the demo's words are fixed).

type CallWindow = { __swarmCall: { agent: string; phase: string; agentProbe(): Promise<{ mic: { chunks: number; peak: number } }> } };

/** The words, then a pause long enough to end a turn, as one 16 kHz mono WAV. */
function loopWav(): string {
  const speech = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'speech.wav'));
  const pcm = Buffer.concat([speech.subarray(44), Buffer.alloc(16_000 * 2 * 9)]);
  const head = Buffer.from(speech.subarray(0, 44));
  head.writeUInt32LE(36 + pcm.length, 4);
  head.writeUInt32LE(pcm.length, 40);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-mic-')), 'turn.wav');
  fs.writeFileSync(file, Buffer.concat([head, pcm]));
  return file;
}

test.use({
  permissions: ['microphone'],
  launchOptions: [async ({ launchOptions }, use) => use({ ...launchOptions, args: [...(launchOptions.args ?? []), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${loopWav()}`] }), { scope: 'worker' }],
});

test.afterAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { voice: { provider: 'off', agent: { on: false, capHours: 15 } } } });
  await request.put('/api/voice/key', { data: { key: '' } });
});

const state = (page: Page) => page.evaluate(() => ({ agent: (window as unknown as CallWindow).__swarmCall.agent, phase: (window as unknown as CallWindow).__swarmCall.phase }));

async function dial(page: Page, jarvis: boolean) {
  expect((await page.request.put('/api/voice/key', { data: { key: 'demo-voice-key-1234' } })).ok()).toBe(true);
  await page.request.patch('/api/settings', { data: { voice: { provider: 'elevenlabs', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery', agent: { on: jarvis, capHours: 15 } }, listen: { provider: 'browser', autoSend: false, handsFree: false } } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  await page.waitForFunction(() => '__swarmCall' in window);
  await page.getByRole('button', { name: /^Call / }).first().click();
}

test('the Jarvis voice gets the spoken words as audio, and stays on', async ({ page }) => {
  await dial(page, true);
  await expect.poll(async () => (await state(page)).agent).toBe('live');
  await page.waitForTimeout(7000); // past the silent-mic check
  const { mic } = await page.evaluate(() => (window as unknown as CallWindow).__swarmCall.agentProbe());
  expect(mic.chunks).toBeGreaterThan(20);
  expect(mic.peak).toBeGreaterThan(0.05);
  expect((await state(page)).agent).toBe('live'); // still ElevenLabs' voice
  await expect(page.locator('.vcall-why')).toHaveCount(0); // no "can't hear you" on a working mic
  await page.getByRole('button', { name: 'End call' }).click();
});

test("the office's own voice transcribes two turns in one call, and the CEO answers each", async ({ page }) => {
  const heard: string[] = [];
  page.on('response', async (r) => r.url().endsWith('/api/voice/transcribe') && heard.push(`${r.status()} ${((await r.json()) as { text?: string }).text}`));
  await dial(page, false);
  await expect.poll(() => heard.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  expect(heard.slice(0, 2)).toEqual(["200 What's everyone working on?", "200 What's everyone working on?"]);
  const messages = (await (await page.request.get('/api/state')).json()).messages as { from: string; text: string }[];
  const first = messages.findIndex((m) => m.from === 'manager' && m.text === "What's everyone working on?");
  expect(messages.slice(first + 1).filter((m) => m.from === 'manager' && m.text === "What's everyone working on?").length).toBeGreaterThanOrEqual(1); // the second turn
  expect(messages.slice(first + 1).some((m) => m.from === 'ceo')).toBe(true); // and the CEO answered
  await expect(page.locator('.vcall-why')).toHaveCount(0);
  await page.getByRole('button', { name: 'End call' }).click();
});
