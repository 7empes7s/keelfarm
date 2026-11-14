import fs from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from './helpers';
import { heardWords } from '../shared/callHeard';
import { FAKE_ECHO, FAKE_TURNS } from '../server/sttRelay';

// A Jarvis call that hears itself (#694): the mic is a getUserMedia shim (a WebAudio MediaStreamDestination), so it
// works on Chromium, Firefox and WebKit alike. The manager's memo (e2e/fixtures/speech.wav, three times) plays into it,
// and everything the page plays to its speakers is looped back into it as well, as a phone's loudspeaker is. The demo's
// transcription (server/sttRelay.ts fakeRelay) hears each turn of speech as the next of FAKE_TURNS and the demo voice's
// own tone as FAKE_ECHO, so a call that lets its own voice reach the listener posts it, as the live office did.

type CallWindow = {
  __swarmCall: { agent: string; phase: string; agentProbe(): Promise<{ said: string[]; barged: number; interrupted: number }> };
  __memo(b64: string): Promise<{ onset: number }>;
  __phases: { phase: string; at: number }[];
};

/** The mic shim, before the page's own scripts. */
function shim() {
  let mix: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  const bus = () => {
    mix ??= new AudioContext();
    dest ??= mix.createMediaStreamDestination();
    return { mix, dest };
  };
  addEventListener('pointerdown', () => void bus().mix.resume(), true); // the tap on Call starts it, as on a phone
  const connect = AudioNode.prototype.connect as (this: AudioNode, to: AudioNode, ...rest: number[]) => AudioNode;
  const loops = new Map<BaseAudioContext, MediaStreamAudioDestinationNode>();
  // The speakers into the mic: whatever a page context plays reaches the shim's mic at the same level.
  AudioNode.prototype.connect = function (this: AudioNode, to: AudioNode, ...rest: number[]) {
    const r = connect.call(this, to, ...rest);
    if (to instanceof AudioDestinationNode && this.context !== mix) {
      let loop = loops.get(this.context);
      if (!loop) {
        loop = (this.context as AudioContext).createMediaStreamDestination();
        loops.set(this.context, loop);
        const b = bus();
        connect.call(b.mix.createMediaStreamSource(loop.stream), b.dest);
      }
      connect.call(this, loop);
    }
    return r;
  } as typeof AudioNode.prototype.connect;
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
  const md = navigator.mediaDevices;
  md.getUserMedia = async () => {
    const b = bus();
    await b.mix.resume().catch(() => undefined);
    return new MediaStream(b.dest.stream.getAudioTracks().map((t) => t.clone()));
  };
  const w = window as unknown as CallWindow;
  /** Plays a WAV into the mic; `onset`: when its first loud sample plays (performance.now()). */
  w.__memo = async (b64) => {
    const b = bus();
    const buf = await b.mix.decodeAudioData(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
    const data = buf.getChannelData(0);
    let first = 0;
    while (first < data.length && Math.abs(data[first]) < 0.1) first++;
    const src = b.mix.createBufferSource();
    src.buffer = buf;
    connect.call(src, b.dest);
    src.start();
    return { onset: performance.now() + (first / buf.sampleRate) * 1000 };
  };
  // The call's phase changes, timed in the page: barge-in is measured here, not over Playwright's round trips.
  w.__phases = [];
  setInterval(() => {
    const p = w.__swarmCall?.phase;
    if (p && p !== w.__phases.at(-1)?.phase) w.__phases.push({ phase: p, at: performance.now() });
  }, 5);
}

const memo = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'speech.wav')).toString('base64');
const win = (page: Page) => page.evaluate.bind(page);
const phase = (page: Page) => win(page)(() => (window as unknown as CallWindow).__swarmCall.phase);
const say = (page: Page) => win(page)((b64) => (window as unknown as CallWindow).__memo(b64), memo);

test.afterAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { voice: { provider: 'off', agent: { on: false, capHours: 15 } } } });
  await request.put('/api/voice/key', { data: { key: '' } });
});

test('a call never posts its own voice or noise, cuts its voice when the manager talks, and hears every memo sentence once', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(shim);
  expect((await page.request.put('/api/voice/key', { data: { key: 'demo-voice-key-1234' } })).ok()).toBe(true);
  await page.request.patch('/api/settings', { data: { voice: { provider: 'elevenlabs', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery', agent: { on: true, capHours: 15, listen: 'openai' } } } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  await page.waitForFunction(() => '__swarmCall' in window);
  const since = Date.now();
  await page.getByRole('button', { name: /^Call / }).first().click();
  await expect.poll(() => win(page)(() => (window as unknown as CallWindow).__swarmCall.agent)).toBe('live');

  // The greeting plays into the mic; then the call listens.
  await expect.poll(() => phase(page)).toBe('speaking');
  await expect.poll(() => phase(page), { timeout: 20_000 }).toBe('listening');
  await page.waitForTimeout(1500);

  // Sentence 1, answered; sentence 2 talks over the answer and cuts it; sentence 3 once the call listens again.
  await say(page);
  await expect.poll(() => phase(page), { timeout: 30_000 }).toBe('speaking');
  await page.waitForTimeout(1200);
  const { onset } = await say(page);
  await expect.poll(() => phase(page), { timeout: 5000 }).not.toBe('speaking');
  const cut = await win(page)((t) => (window as unknown as CallWindow).__phases.find((p) => p.at >= t - 50 && p.phase !== 'speaking')?.at ?? Infinity, onset);
  console.log(`barge-in: the voice stopped ${Math.round(cut - onset)} ms after the manager started talking`);
  expect(cut - onset).toBeLessThanOrEqual(300);
  await expect.poll(() => phase(page), { timeout: 30_000 }).toBe('speaking'); // its answer to sentence 2
  await expect.poll(() => phase(page), { timeout: 30_000 }).toBe('listening');
  await page.waitForTimeout(1500);
  await say(page);
  await expect.poll(() => phase(page), { timeout: 30_000 }).toBe('speaking');
  await expect.poll(() => phase(page), { timeout: 30_000 }).toBe('listening');
  await page.waitForTimeout(1500); // anything late still has time to arrive

  const { said, barged } = await win(page)(() => (window as unknown as CallWindow).__swarmCall.agentProbe());
  const messages = ((await (await page.request.get('/api/state')).json()).messages as { from: string; text: string; at: number }[]).filter((m) => m.at >= since);
  const mine = messages.filter((m) => m.from === 'manager').map((m) => m.text);
  console.log(`said: ${JSON.stringify(said)}\nmanager messages: ${JSON.stringify(mine)}`);
  expect(barged).toBeGreaterThanOrEqual(1);
  // Never the voice's own words (the greeting, its replies), its tone heard back, or a stray word.
  const spoken = new Set(said.map((s) => heardWords(s).join(' ')));
  expect(mine.filter((t) => spoken.has(heardWords(t).join(' ')) || t === FAKE_ECHO)).toEqual([]);
  expect(mine.filter((t) => heardWords(t).length < 2)).toEqual([]);
  // Every memo sentence exactly once, in order, and each answered.
  expect(mine).toEqual(FAKE_TURNS);
  for (const t of FAKE_TURNS) {
    const i = messages.findIndex((m) => m.from === 'manager' && m.text === t);
    expect(messages.slice(i + 1).some((m) => m.from === 'ceo'), `an answer to "${t}"`).toBe(true);
  }
  await page.getByRole('button', { name: 'End call' }).click();
});
