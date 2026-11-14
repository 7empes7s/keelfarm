import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { chunkPeak, chunkProblem, fakeAgent, fakeInFormat } from './voiceAgentFake.ts';

describe("the demo's ElevenLabs agent is strict about the mic (#656)", () => {
  const pcm = (samples: number, v = 0) => {
    const b = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) b.writeInt16LE(v, i * 2);
    return b.toString('base64');
  };

  it('takes 100 ms of the format it announced and refuses another rate or sample size', () => {
    expect(chunkProblem(pcm(1600), 'pcm_16000')).toBe('');
    expect(chunkProblem(pcm(4800), 'pcm_16000')).toMatch(/isn't pcm_16000/); // a 48 kHz mic sent as is
    expect(chunkProblem(pcm(2205), 'pcm_22050')).toBe('');
    expect(chunkProblem(pcm(1600), 'ulaw_8000')).toMatch(/isn't ulaw_8000/); // PCM16 at 16 kHz to a μ-law agent
    expect(chunkProblem(Buffer.alloc(800, 0xff).toString('base64'), 'ulaw_8000')).toBe('');
    expect(chunkProblem(Buffer.alloc(3201).toString('base64'), 'pcm_16000')).toMatch(/2-byte samples/);
  });

  it('reads loudness in either codec and announces SWARM_DEMO_VOICE_IN when ElevenLabs has it', () => {
    expect(chunkPeak(pcm(10, 16384))).toBeCloseTo(0.5);
    expect(chunkPeak(Buffer.alloc(10, 0xff).toString('base64'), 'ulaw_8000')).toBe(0);
    expect(chunkPeak(Buffer.alloc(10, 0x80).toString('base64'), 'ulaw_8000')).toBeGreaterThan(0.9);
    expect(fakeInFormat('ulaw_8000')).toBe('ulaw_8000');
    expect(fakeInFormat('nope')).toBe('pcm_16000');
    expect(fakeInFormat(undefined)).toBe('pcm_16000');
  });
});

describe("the demo's ElevenLabs agent answers a typed turn and can be deaf (#658)", () => {
  const talk = (deaf: boolean) => {
    const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, sent: [] as { type: string }[], send(m: string) { this.sent.push(JSON.parse(m)); }, close() {} });
    fakeAgent(ws as unknown as WebSocket, async () => 'On it.', () => 'Hi', () => undefined, 'pcm_16000', deaf);
    ws.emit('message', JSON.stringify({ type: 'conversation_initiation_client_data' }));
    return ws;
  };
  const loud = Buffer.alloc(3200);
  for (let i = 0; i < 1600; i++) loud.writeInt16LE(i % 2 ? 12000 : -12000, i * 2);

  it('a user_message is answered with the LLM\'s words', async () => {
    const ws = talk(false);
    ws.emit('message', JSON.stringify({ type: 'user_message', text: 'Ship the login page today' }));
    await vi.waitFor(() => expect(ws.sent.filter((m) => m.type === 'agent_response')).toHaveLength(2)); // the greeting, then the answer
  });

  it('hears talking then a pause, unless it is deaf like the live agent was', async () => {
    vi.useFakeTimers();
    try {
      for (const deaf of [false, true]) {
        const ws = talk(deaf);
        for (let i = 0; i < 8; i++) ws.emit('message', JSON.stringify({ user_audio_chunk: loud.toString('base64') }));
        vi.advanceTimersByTime(1000);
        expect(ws.sent.filter((m) => m.type === 'user_transcript')).toHaveLength(deaf ? 0 : 1);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
