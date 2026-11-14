import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { agentBody, bearerOk, completionJson, reachWhy, sessionOf, streamCompletion, voiceRouteLine } from './voiceAgent.ts';
import type { Backend } from './backend.ts';

// The Jarvis voice (#534) in a demo office: its own folder, for the demo's secrets and voice-agent files.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-voiceagent-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

/** A call started, or the test fails with why it couldn't be. */
async function dial(swarm: { startVoiceAgent(): Promise<{ session: string; url: string; stt: boolean } | { unreachable: string }> }) {
  const r = await swarm.startVoiceAgent();
  if ('unreachable' in r) throw new Error(r.unreachable);
  return r;
}

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
    const { session, url } = await dial(swarm);
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
    const { session } = await dial(swarm);
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

  it('streams a fast answer to small talk, the first sentence out before the model is done (#665)', async () => {
    const swarm = await office();
    const { session } = await dial(swarm);
    const ask = vi.spyOn(swarm, 'messageCeo');
    const writes: { ev: string; at: number }[] = [];
    let modelDone = 0;
    const turn = swarm.voiceTurn({ cubefarm_session: session, messages: said('Hi, how are you?') }, undefined, true);
    const timed = (async function* () {
      for await (const p of turn) yield p;
      modelDone = performance.now();
    })();
    await streamCompletion(timed, 'm', () => undefined, (ev) => writes.push({ ev, at: performance.now() }), 0);
    const words = writes.slice(0, -2).map((w) => JSON.parse(w.ev.slice(6)).choices[0].delta.content as string);
    expect(words[0]).toBe("I'm doing well, thanks for asking. ");
    expect(writes[0].at).toBeLessThan(modelDone); // spoken while the model was still writing
    expect(ask).not.toHaveBeenCalled(); // small talk never wakes the CEO
    expect(swarm.snapshot().messages.slice(-1)[0]).toMatchObject({ from: 'ceo', voiceCall: true, text: words.join('').trim() });
  });

  it("puts the office's own timing on each turn of a call's trace and logs each finished turn (#665)", async () => {
    const swarm = await office();
    const { session } = await dial(swarm);
    await swarm.voiceLlm({ cubefarm_session: session, messages: said("What's floor 1 doing?") }, undefined, true);
    const log = vi.mocked(console.log);
    const turn = { n: 1, listener: 'browser', speechStart: 100, speechEnd: 900, transcript: 1300, sent: 1300, firstAudio: 2100, playback: 2200, session, s: 1, office: { first: 9, done: 9 } };
    swarm.voiceTrace({ id: 'call2', mode: 'jarvis', turns: [turn] });
    swarm.voiceTrace({ id: 'call2', mode: 'jarvis', turns: [turn] }); // the next update: logged once
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('voice: turn {'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('heard 0.4 s · thinking 0.8 s (office 0.0 s) · voice 0.1 s');
    expect(lines[0]).not.toContain(session); // the session finds the timing, and is never logged
    const kept = swarm.voiceTraces().at(-1)!.turns[0];
    expect(kept.office?.done).toBeGreaterThan(0);
    expect(kept.office?.done).toBeLessThan(1000); // the office's own clock, not the browser's 9
  });

  it("counts a call's minutes and falls back over the monthly cap", async () => {
    const swarm = await office();
    const { session } = await dial(swarm);
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

describe('the Jarvis voice when ElevenLabs can\'t reach the office (#682)', () => {
  const voiceOf = (swarm: object) => (swarm as { backend: Backend }).backend.voice;
  const setReply = (swarm: Awaited<ReturnType<typeof office>>, replyUrl: string) => {
    const voice = swarm.snapshot().settings.voice;
    swarm.updateSettings({ voice: { ...voice, agent: { ...(voice.agent ?? { on: true, capHours: 15 }), replyUrl } } });
  };

  it("checks the reply address from outside before dialling: unreachable fails in under 3 s and files an IT ticket naming it", async () => {
    const swarm = await office();
    setReply(swarm, 'https://office.example.com');
    const reach = vi.spyOn(voiceOf(swarm), 'reach').mockResolvedValue({ status: 404, body: 'Not Found' });
    const ensure = vi.spyOn(voiceOf(swarm), 'ensureAgent');
    const t0 = Date.now();
    await expect(swarm.startVoiceAgent()).resolves.toEqual({ unreachable: "ElevenLabs can't reach the office at https://office.example.com: it answered 404, so the address leads somewhere else (check the tunnel's route)" });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(reach).toHaveBeenCalledWith('https://office.example.com/v1/chat/completions');
    expect(ensure).not.toHaveBeenCalled(); // no call that would hang on "thinking"
    const ticket = (swarm.snapshot().itTickets ?? []).find((t) => t.what.includes('https://office.example.com'));
    expect(ticket?.what).toBe("ElevenLabs can't reach the office at https://office.example.com");
    await expect(swarm.startVoiceAgent()).resolves.toMatchObject({ unreachable: expect.stringMatching(/can't reach/) });
    expect(reach).toHaveBeenCalledTimes(1); // the answer is kept for a moment: no probe per tap
  });

  it("dials when the address answers with the office's own 401, and checks again once the address changes", async () => {
    const swarm = await office();
    setReply(swarm, 'https://office.example.com');
    const reach = vi.spyOn(voiceOf(swarm), 'reach').mockResolvedValue({ status: 401, body: '{"error":"Not the office voice agent"}' });
    await expect(swarm.startVoiceAgent()).resolves.toMatchObject({ url: '/ws/voice-agent' });
    await swarm.startVoiceAgent();
    expect(reach).toHaveBeenCalledTimes(1); // kept a few minutes
    setReply(swarm, 'https://voice.example.com');
    await swarm.startVoiceAgent();
    expect(reach).toHaveBeenLastCalledWith('https://voice.example.com/v1/chat/completions');
  });

  it("configures itself on the office's public address when it answers as this office, never another office's (#682)", async () => {
    const swarm = await office();
    swarm.updateSettings({ notify: { ...swarm.snapshot().settings.notify, officeUrl: 'https://o.tailnet.ts.net' } });
    const own = await swarm.voiceLlm({ messages: [] }, 'Bearer nope').catch((e: Error) => e.message);
    expect(own).toMatch(/^Not the office voice agent \(office \w+\)$/);
    const ensure = vi.spyOn(voiceOf(swarm), 'ensureAgent');
    const reach = vi.spyOn(voiceOf(swarm), 'reach').mockResolvedValue({ status: 401, body: JSON.stringify({ error: own }) });
    await expect(swarm.startVoiceAgent()).resolves.toMatchObject({ url: '/ws/voice-agent' });
    expect(reach).toHaveBeenCalledWith('https://office.techinsiderbytes.com/v1/chat/completions');
    expect(ensure.mock.calls[0][1].llmUrl).toBe('https://office.techinsiderbytes.com/v1');

    // Another install: that address answers as someone else's office, so the Office address is used.
    const other = await office();
    other.updateSettings({ notify: { ...other.snapshot().settings.notify, officeUrl: 'https://other.example.com' } });
    const otherEnsure = vi.spyOn(voiceOf(other), 'ensureAgent');
    vi.spyOn(voiceOf(other), 'reach').mockImplementation(async (url) => ({ status: 401, body: url.startsWith('https://office.techinsiderbytes.com') ? 'Not the office voice agent (office 0123456789)' : own }));
    await expect(other.startVoiceAgent()).resolves.toMatchObject({ url: '/ws/voice-agent' });
    expect(otherEnsure.mock.calls.at(-1)?.[1].llmUrl).toBe('https://other.example.com/v1');
  });

  it('answers a fallback call turn in words within 5 s with every Claude account limited, read aloud in the call (#682)', async () => {
    const swarm = await office();
    vi.spyOn(swarm, 'messageCeo').mockImplementation(() => new Promise(() => undefined)); // limited: the CEO never gets to it
    const t0 = Date.now();
    const r = await swarm.voiceCallTurn('Why is QA so slow this week?');
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.say).toMatch(/^On it. I'm asking /);
    const last = swarm.snapshot().messages.at(-1)!;
    expect(last).toMatchObject({ from: 'ceo', text: r.say });
    expect(last.silent).toBeFalsy(); // the call reads it aloud, in the CEO's ElevenLabs voice
    const small = await swarm.voiceCallTurn('Hi, how are you?'); // the fast path, never the CEO
    expect(small.say).toMatch(/^I'm doing well/);
  });
});

describe('the Jarvis voice: ElevenLabs plumbing', () => {
  it("makes the agent with the office as its custom LLM and the call's session in the extra body", () => {
    const body = agentBody({ name: 'Acme office voice', llmUrl: 'https://o.example/v1', llmSecretId: 'sec1', voiceId: 'v1', firstMessage: 'Hi' });
    expect(body.conversation_config.agent.prompt).toMatchObject({ llm: 'custom-llm', custom_llm: { url: 'https://o.example/v1', api_key: { secret_id: 'sec1' } } });
    expect(body.platform_settings.overrides.custom_llm_extra_body).toBe(true);
    // #656: the call's input format and the events it needs are set, never left to the account's defaults.
    expect(body.conversation_config.asr.user_input_audio_format).toBe('pcm_16000');
    expect(body.conversation_config.tts.agent_output_audio_format).toBe('pcm_16000');
    expect(body.conversation_config.tts).toMatchObject({ model_id: 'eleven_flash_v2', optimize_streaming_latency: 3 }); // #665: faster first audio
    expect(body.conversation_config.turn.turn_eagerness).toBe('eager');
    expect(body.conversation_config.conversation.client_events).toEqual(expect.arrayContaining(['conversation_initiation_metadata', 'audio', 'user_transcript', 'agent_response', 'interruption', 'ping']));
    expect(sessionOf({ cubefarm_session: 'abc_1' })).toBe('abc_1');
    expect(sessionOf({ cubefarm_session: 'bad id!' })).toBe('');
    expect(bearerOk('Bearer tok123', 'tok123')).toBe(true);
    expect(bearerOk('Bearer tok12', 'tok123')).toBe(false);
    expect(bearerOk(undefined, '')).toBe(false);
  });

  it('answers in OpenAI chat completion form, whole or as sentence-by-sentence events', async () => {
    expect(completionJson('Hi.', 'm', 0).choices[0].message.content).toBe('Hi.');
    const events: string[] = [];
    await streamCompletion((async function* () { yield 'On it. Checking floor 4.'; })(), 'm', () => undefined, (e) => events.push(e), 0);
    const deltas = events.slice(0, -1).map((e) => JSON.parse(e.slice(6)).choices[0].delta.content ?? '');
    expect(deltas.join('')).toBe('On it. Checking floor 4.');
    expect(deltas[0]).toBe('On it. '); // the first words go out at once
    expect(events.at(-1)).toBe('data: [DONE]\n\n');
  });
});

describe('the reply address check (#682)', () => {
  it("passes only on the office's own 401, and says what answered instead", () => {
    expect(reachWhy({ status: 401, body: '{"error":"Not the office voice agent"}' })).toBe('');
    expect(reachWhy({ status: 404, body: 'Not Found' })).toBe('it answered 404, so the address leads somewhere else (check the tunnel\'s route)');
    expect(reachWhy({ status: 302, body: '', location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' })).toMatch(/Cloudflare Access .* \/v1\/chat\/completions/);
    expect(reachWhy({ status: 403, body: '<title>Sign in ・ Cloudflare Access</title>' })).toMatch(/Cloudflare Access/);
    expect(reachWhy({ status: 401, body: 'Not the office voice agent (office abc)' }, 'abc')).toBe('');
    expect(reachWhy({ status: 401, body: 'Not the office voice agent (office xyz)' }, 'abc')).toMatch(/another cubefarm office/);
    expect(reachWhy({ status: 401, body: 'Unauthorized' })).toMatch(/answered 401 but not as the office/);
    expect(reachWhy({ status: 0, body: '', error: 'getaddrinfo ENOTFOUND office.example.com' })).toBe("it couldn't be reached (getaddrinfo ENOTFOUND office.example.com)");
  });
});

describe('call traces and voice routes in the log (#650)', () => {
  it('logs a trace as one line without the voice key, and keeps it for GET /api/voice/traces', async () => {
    const swarm = await office();
    const log = vi.mocked(console.log);
    swarm.voiceTrace({ id: 'call1', mode: 'jarvis', gum: 'ok', workletMsgs: 50, rmsMax: 0.2, events: [{ ms: 3, what: 'the key sk_demo_key_1234 leaked' }] });
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('voice: call trace {'));
    expect(line).toContain('"workletMsgs":50');
    expect(line).not.toContain('sk_demo_key_1234');
    expect(swarm.voiceTraces().map((t) => t.id)).toEqual(['call1']);
    expect(() => swarm.voiceTrace({ mode: 'jarvis' })).toThrow(/needs an id/);
  });

  it('names every voice route and its status, never a session id', () => {
    expect(voiceRouteLine('POST', '/api/voice/transcribe', 200, 812.4)).toBe('voice: POST /api/voice/transcribe 200 (812 ms)');
    expect(voiceRouteLine('POST', '/v1/chat/completions', 401, 3)).toBe('voice: POST /v1/chat/completions 401 (3 ms)');
    expect(voiceRouteLine('POST', '/api/voice/agent/Xy_9abc/end', 200, 1)).toBe('voice: POST /api/voice/agent/:session/end 200 (1 ms)');
    expect(voiceRouteLine('POST', '/api/voice/trace', 200, 1)).toBeNull(); // it logs itself
    expect(voiceRouteLine('POST', '/api/voice/trace', 400, 1)).toBe('voice: POST /api/voice/trace 400 (1 ms)');
    expect(voiceRouteLine('GET', '/api/state', 200, 1)).toBeNull();
  });
});
