import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { agentBody, bearerOk, completionEvents, completionJson, sessionOf } from './voiceAgent.ts';

// The Jarvis voice (#534) in a demo office: its own folder, for the demo's secrets and voice-agent files.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-voiceagent-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

const said = (text: string) => [{ role: 'system', content: 'ignored' }, { role: 'user', content: text }];

afterEach(() => vi.restoreAllMocks());

async function office() {
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  const swarm = new Swarm(createDemoBackend());
  await swarm.connectRepo('demo-co/pixel-todo');
  const i = swarm as unknown as { state: { ceo: { queue: unknown[] } }; ensureCeo(interrupted: unknown[]): void };
  i.state.ceo.queue = []; // no onboarding: the call's hand-off is the CEO's only job
  i.ensureCeo([]);
  await swarm.voice.setKey('sk_demo_key_1234');
  return swarm;
}

describe('the Jarvis voice: the custom LLM endpoint', () => {
  it('answers from company data at once and writes both sides into the CEO chat as voice messages', async () => {
    const swarm = await office();
    const { session, url } = await swarm.startVoiceAgent();
    expect(url).toBe('/ws/voice-agent'); // a signed URL, never the key
    const ask = vi.spyOn(swarm, 'messageCeo');
    const say = await swarm.voiceLlm({ cubefarm_session: session, messages: said("What's floor 1 doing?") }, undefined, true);
    expect(say).toMatch(/^Floor 1, pixel-todo: /);
    expect(ask).not.toHaveBeenCalled();
    const thread = swarm.snapshot().messages.slice(-2);
    expect(thread.map((m) => [m.from, m.voiceCall, m.text])).toEqual([
      ['manager', true, "What's floor 1 doing?"],
      ['ceo', true, say],
    ]);
    expect(thread[1].silent).toBe(true); // heard on the call: never read aloud again
    await expect(swarm.voiceLlm({ messages: said('status') }, 'Bearer nope')).rejects.toThrow(/Not the office voice agent/);
  });

  it('hands real work to the CEO like a typed message, and asks before a change', async () => {
    const swarm = await office();
    const { session } = await swarm.startVoiceAgent();
    const ask = vi.spyOn(swarm, 'messageCeo');
    const ack = await swarm.voiceLlm({ cubefarm_session: session, messages: said('Why is QA so slow this week?') }, undefined, true);
    expect(ack).toMatch(/^On it. I'm asking /);
    expect(ask).toHaveBeenCalledWith('Why is QA so slow this week?', undefined, 'voice');
    const ceo = swarm.snapshot().ceo;
    expect(ceo.job?.kind === 'chat' || ceo.queue.some((j) => j.kind === 'chat')).toBe(true); // a CEO job for it
    expect(swarm.snapshot().messages.find((m) => m.from === 'manager' && m.text === 'Why is QA so slow this week?')?.voiceCall).toBe(true);

    ask.mockClear();
    const question = await swarm.voiceLlm({ cubefarm_session: session, messages: said('Hire two more people on floor 1') }, undefined, true);
    expect(question).toMatch(/^Should I ask .+ to hire two more people on floor 1\?$/);
    expect(ask).not.toHaveBeenCalled();
    await swarm.voiceLlm({ cubefarm_session: session, messages: said('Yes') }, undefined, true);
    expect(ask).toHaveBeenCalledWith('Hire two more people on floor 1', undefined, 'voice');
  });

  it("counts a call's minutes and falls back over the monthly cap", async () => {
    const swarm = await office();
    const { session } = await swarm.startVoiceAgent();
    vi.useFakeTimers({ now: Date.now() + 125_000, toFake: ['Date'] });
    try {
      expect(swarm.endVoiceAgent(session).minutesToday).toBe(3);
    } finally {
      vi.useRealTimers();
    }
    const voice = swarm.snapshot().settings.voice;
    swarm.updateSettings({ voice: { ...voice, agent: { on: true, capHours: 0.05 } } }); // 3 minutes
    await expect(swarm.startVoiceAgent()).rejects.toThrow(/office's own voice until next month/);
    await swarm.voice.setKey('');
    swarm.updateSettings({ voice: { ...voice, agent: { on: true, capHours: 15 } } });
    await expect(swarm.startVoiceAgent()).rejects.toThrow(/Add an ElevenLabs key/);
  });
});

describe('the Jarvis voice: ElevenLabs plumbing', () => {
  it("makes the agent with the office as its custom LLM and the call's session in the extra body", () => {
    const body = agentBody({ name: 'Acme office voice', llmUrl: 'https://o.example/v1', llmSecretId: 'sec1', voiceId: 'v1', firstMessage: 'Hi' });
    expect(body.conversation_config.agent.prompt).toMatchObject({ llm: 'custom-llm', custom_llm: { url: 'https://o.example/v1', api_key: { secret_id: 'sec1' } } });
    expect(body.platform_settings.overrides.custom_llm_extra_body).toBe(true);
    expect(sessionOf({ cubefarm_session: 'abc_1' })).toBe('abc_1');
    expect(sessionOf({ cubefarm_session: 'bad id!' })).toBe('');
    expect(bearerOk('Bearer tok123', 'tok123')).toBe(true);
    expect(bearerOk('Bearer tok12', 'tok123')).toBe(false);
    expect(bearerOk(undefined, '')).toBe(false);
  });

  it('answers in OpenAI chat completion form, whole or as sentence-by-sentence events', () => {
    expect(completionJson('Hi.', 'm', 0).choices[0].message.content).toBe('Hi.');
    const events = completionEvents('On it. Checking floor 4.', 'm', 0);
    const deltas = events.slice(0, -1).map((e) => JSON.parse(e.slice(6)).choices[0].delta.content ?? '');
    expect(deltas.join('')).toBe('On it. Checking floor 4.');
    expect(deltas[0]).toBe('On it. '); // the first words go out at once
    expect(events.at(-1)).toBe('data: [DONE]\n\n');
  });
});
