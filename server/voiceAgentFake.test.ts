import { describe, expect, it } from 'vitest';
import { chunkPeak, chunkProblem, fakeInFormat } from './voiceAgentFake.ts';

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
