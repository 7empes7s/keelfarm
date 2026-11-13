import { describe, expect, it } from 'vitest';
import { redact } from './journal';
import { cleanTrace, keepTrace, nonZeroPcmBytes, shortAgent, TRACE_EVENTS } from './callTrace';

const base = { id: 'abc123', ms: 5000, mode: 'jarvis', listen: 'elevenlabs', gum: 'ok', workletMsgs: 120, rmsMax: 0.21, rmsMean: 0.03, chunks: 40, chunkBytes: 128000, nonZeroBytes: 127000 };

describe('a call trace (#650)', () => {
  it('keeps exactly its known fields, with their types', () => {
    const t = cleanTrace({ ...base, track: { label: 'iPhone Microphone', enabled: true, muted: false, state: 'live', rate: 48000, channels: 1 }, ws: { audio: 12, user_transcript: 2 }, close: { code: 1008, reason: 'custom llm error' }, events: [{ ms: 10, what: 'call starts' }] });
    expect(t).toMatchObject({ id: 'abc123', mode: 'jarvis', gum: 'ok', workletMsgs: 120, rmsMax: 0.21, nonZeroBytes: 127000, track: { label: 'iPhone Microphone', rate: 48000, channels: 1 }, ws: { audio: 12, user_transcript: 2 }, close: { code: 1008, reason: 'custom llm error' } });
    expect(Object.keys(t!).sort()).toEqual(['audio', 'chunkBytes', 'chunks', 'close', 'events', 'final', 'gum', 'id', 'inFormat', 'listen', 'meter', 'mode', 'ms', 'nonZeroBytes', 'posts', 'recorder', 'rmsMax', 'rmsMean', 'track', 'ua', 'worklet', 'workletMsgs', 'ws']);
  });

  it('carries no audio and no secrets, whatever the browser sends', () => {
    const audio = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA'.repeat(4);
    const key = 'sk_9f8e7d6c5b4a39281706f5e4d3c2b1a0';
    const t = cleanTrace({ ...base, user_audio_chunk: audio, clip: audio, gum: audio, worklet: `Error: ${audio}`, events: [{ ms: 1, what: `key=${key}` }], posts: [{ status: 401, error: `Bearer ${key}` }] }, (s) => redact(s, [key]));
    const text = JSON.stringify(t);
    expect(text).not.toContain(audio.slice(0, 40));
    expect(text).not.toContain(key);
    expect(text).not.toContain('user_audio_chunk');
    expect(text.length).toBeLessThan(2000);
  });

  it('refuses a body without an id, and clamps what is out of range', () => {
    expect(cleanTrace(null)).toBeNull();
    expect(cleanTrace({ ...base, id: '../x' })).toBeNull();
    const t = cleanTrace({ ...base, mode: 'nonsense', rmsMax: 7, chunks: -3, ws: { 'Bad Key': 1, ok_type: 'x' }, events: Array.from({ length: 99 }, (_, i) => ({ ms: i, what: `e${i}` })) })!;
    expect([t.mode, t.rmsMax, t.chunks, t.ws]).toEqual(['office', 1, 0, { ok_type: 0 }]);
    expect(t.events).toHaveLength(TRACE_EVENTS);
    expect(t.events.at(-1)?.what).toBe('e98');
  });

  it('keeps the last 20 calls, a newer trace replacing its call’s older one', () => {
    let list = [cleanTrace({ ...base, id: 'a', ms: 5000 })!, cleanTrace({ ...base, id: 'b' })!];
    list = keepTrace(list, cleanTrace({ ...base, id: 'a', ms: 10000 })!);
    expect(list.map((t) => [t.id, t.ms])).toEqual([['b', 5000], ['a', 10000]]);
    for (let i = 0; i < 30; i++) list = keepTrace(list, cleanTrace({ ...base, id: `c${i}` })!);
    expect(list).toHaveLength(20);
    expect(list.at(-1)?.id).toBe('c29');
  });

  it('counts the PCM bytes that are not zero, and shortens the user agent', () => {
    expect(nonZeroPcmBytes(new Float32Array([0, 0.5, 0, -0.2, 0.00001]))).toBe(4);
    expect(shortAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe('Safari/18.1 iPhone');
    expect(shortAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')).toBe('Chrome/131.0.0.0 Macintosh');
  });
});
