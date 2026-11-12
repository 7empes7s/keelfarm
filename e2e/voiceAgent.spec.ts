import { type Page } from '@playwright/test';
import { expect, test } from './helpers';

// The Jarvis voice on a call (#534, docs/voice.md "ElevenLabs Agents"): the demo office's fake ElevenLabs agent socket
// (server/voiceAgentFake.ts) speaks the real protocol; a turn is typed to it with __swarmCall.say (headless browsers
// have no mic), it answers through the office's own custom LLM and "speaks" PCM audio.

type AgentProbe = { mode: string; said: string[]; ackMs: number | null; interrupted: number };
type CallWindow = { __swarmCall: { agent: string; phase: string; say(text: string): Promise<void>; agentProbe(): Promise<AgentProbe> }; __swarmMic: { fake(): void } };

const agentOn = { on: true, capHours: 15 };

// A microphone for the call's audio (silence from a fake device in Chromium; WebKit's capture is mocked already).
test.use({
  permissions: ['microphone'],
  launchOptions: [async ({ browserName, launchOptions }, use) => use(browserName === 'chromium' ? { ...launchOptions, args: [...(launchOptions.args ?? []), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : launchOptions), { scope: 'worker' }],
});

test.beforeAll(async ({ request }) => {
  expect((await request.put('/api/voice/key', { data: { key: 'demo-voice-key-1234' } })).ok()).toBe(true);
  await request.patch('/api/settings', { data: { voice: { provider: 'elevenlabs', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery', agent: agentOn } } });
});

test.afterAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { voice: { provider: 'off', agent: agentOn } } });
  await request.put('/api/voice/key', { data: { key: '' } });
});

const mode = (page: Page) => page.evaluate(() => (window as unknown as CallWindow).__swarmCall.agent);
const phase = (page: Page) => page.evaluate(() => (window as unknown as CallWindow).__swarmCall.phase);
const probe = (page: Page) => page.evaluate(() => (window as unknown as CallWindow).__swarmCall.agentProbe());
const say = (page: Page, text: string) => page.evaluate((t) => (window as unknown as CallWindow).__swarmCall.say(t), text);

async function call(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  await page.waitForFunction(() => '__swarmCall' in window && '__swarmMic' in window);
  await page.evaluate(() => (window as unknown as CallWindow).__swarmMic.fake());
  await page.getByRole('button', { name: /^Call / }).first().click();
}

test('tap Call: the Jarvis voice acks in under a second, the orb follows, captions show, barge-in stops it, hang up keeps the transcript', async ({ page }) => {
  await call(page);
  await expect.poll(() => mode(page)).toBe('live');
  const orb = page.locator('.vcall-screen .vcall-orb-canvas').first();
  await expect(orb).toBeVisible();
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('listening'); // the greeting said and done

  await say(page, "What's floor 1 doing?");
  await expect.poll(async () => (await probe(page)).ackMs, { timeout: 5_000 }).not.toBeNull();
  expect((await probe(page)).ackMs!).toBeLessThan(1000);
  await expect.poll(() => phase(page)).toBe('speaking');
  await expect(orb).toHaveAttribute('data-orb', 'talking');
  await expect(page.locator('.vcall-captions')).toContainText(/Floor 1/);

  // Talking over it: the fake agent interrupts itself and the turn is the manager's.
  await say(page, 'Anything waiting on me?');
  await expect.poll(async () => (await probe(page)).interrupted).toBeGreaterThan(0);
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('listening');
  await expect(orb).toHaveAttribute('data-orb', 'listening');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole('button', { name: 'End call' }).click();
  await expect.poll(() => mode(page)).toBe('off');
  const state = await (await page.request.get('/api/state')).json();
  const voice = (state.messages as { from: string; text: string; voiceCall?: boolean }[]).filter((m) => m.voiceCall);
  expect(voice.map((m) => m.from)).toEqual(expect.arrayContaining(['manager', 'ceo']));
  expect(voice.some((m) => m.text === "What's floor 1 doing?")).toBe(true);
  await expect(page.locator('.pk-chat, .phone-chat').getByText("What's floor 1 doing?").first()).toBeVisible(); // back in the chat, with the transcript
  expect(state.voiceAgent.minutesToday).toBeGreaterThan(0);
});

test('"that\'s all" ends the conversation, and a tap on the orb talks again', async ({ page }) => {
  await call(page);
  await expect.poll(() => mode(page)).toBe('live');
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('listening');
  await say(page, "That's all, thanks");
  await expect.poll(() => mode(page), { timeout: 15_000 }).toBe('idle');
  await expect(page.locator('.vcall-status')).toHaveText('Tap the orb to talk');
  await page.getByRole('button', { name: 'Talk again' }).click();
  await expect.poll(() => mode(page)).toBe('live');
  await page.getByRole('button', { name: 'End call' }).click();
});

test("over the monthly cap a call uses today's voice mode", async ({ page, request }) => {
  await request.patch('/api/settings', { data: { voice: { agent: { on: true, capHours: 0 } } } });
  try {
    await call(page);
    await expect.poll(() => phase(page)).toBe('listening');
    expect(await mode(page)).toBe('off');
    await page.getByRole('button', { name: 'End call' }).click();
  } finally {
    await request.patch('/api/settings', { data: { voice: { agent: agentOn } } });
  }
});
