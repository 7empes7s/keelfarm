import { describe, expect, it } from 'vitest';
import { redact } from './journal';
import { cleanTrace, keepTrace, markTurn, newTurn, nonZeroPcmBytes, shortAgent, TRACE_EVENTS, turnParts, turnWords } from './callTrace';

const base = { id: 'abc123', ms: 5000, mode: 'jarvis', listen: 'elevenlabs', gum: 'ok', workletMsgs: 120, rmsMax: 0.21, rmsMean: 0.03, chunks: 40, chunkBytes: 128000, nonZeroBytes: 127000 };

describe('a call trace (#650)', () => {
  it('keeps exactly its known fields, with their types', () => {
    const t = cleanTrace({ ...base, track: { label: 'iPhone Microphone', enabled: true, muted: false, state: 'live', rate: 48000, channels: 1 }, ws: { audio: 12, user_transcript: 2 }, close: { code: 1008, reason: 'custom llm error' }, events: [{ ms: 10, what: 'call starts' }], inFormat: 'pcm_16000', sentRate: 16000, transcripts: 2, utterances: 3, replies: 3, listen: 'openai' });
    expect(t).toMatchObject({ id: 'abc123', mode: 'jarvis', gum: 'ok', workletMsgs: 120, rmsMax: 0.21, nonZeroBytes: 127000, inFormat: 'pcm_16000', sentRate: 16000, transcripts: 2, utterances: 3, replies: 3, listen: 'openai', track: { label: 'iPhone Microphone', rate: 48000, channels: 1 }, ws: { audio: 12, user_transcript: 2 }, close: { code: 1008, reason: 'custom llm error' } });
    expect(Object.keys(t!).sort()).toEqual(['audio', 'chunkBytes', 'chunks', 'close', 'events', 'final', 'gum', 'id', 'inFormat', 'listen', 'meter', 'mode', 'ms', 'nonZeroBytes', 'posts', 'recorder', 'replies', 'rmsMax', 'rmsMean', 'sentRate', 'track', 'transcripts', 'turns', 'ua', 'utterances', 'worklet', 'workletMsgs', 'ws']);
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

  it('times a turn in order: speech end follows each new word, steps are kept once and never go back (#665)', () => {
    let t = newTurn(1, 'browser');
    t = markTurn(t, 'speechStart', 100);
    t = markTurn(t, 'speechEnd', 400);
    t = markTurn(t, 'speechEnd', 900); // another word
    t = markTurn(t, 'transcript', 1200);
    t = markTurn(t, 'speechEnd', 1500); // after the words were ready: not the manager's speech any more
    t = markTurn(t, 'sent', 1200);
    t = markTurn(t, 'firstAudio', 2000);
    t = markTurn(t, 'firstAudio', 2600); // the second chunk
    t = markTurn(t, 'playback', 1900); // can't play before it came
    expect([t.speechStart, t.speechEnd, t.transcript, t.sent, t.firstAudio, t.playback]).toEqual([100, 900, 1200, 1200, 2000, 2000]);
    expect(turnParts(t)).toEqual({ heard: 300, thinking: 800, voice: 0, total: 1100 });
    expect(turnWords({ ...t, office: { first: 40, done: 120 } })).toBe('heard 0.3 s · thinking 0.8 s (office 0.1 s) · voice 0.0 s');
    const typed = markTurn(newTurn(2, 'typed'), 'sent', 50); // no speech: the words were ready when sent
    expect([typed.transcript, typed.sent]).toEqual([50, 50]);
    expect(turnWords(typed)).toBe('waiting for the answer');
  });

  it("keeps a turn's steps from the browser but never its office timing or anything else (#665)", () => {
    const t = cleanTrace({ ...base, turns: [{ n: 1, listener: 'clip', speechStart: 10, speechEnd: 20, transcript: 30, sent: 30, firstAudio: 40, playback: 50, office: { first: 1, done: 1 }, session: 'secret', words: 'ship it' }] })!;
    expect(t.turns).toEqual([{ ...newTurn(1, 'clip'), speechStart: 10, speechEnd: 20, transcript: 30, sent: 30, firstAudio: 40, playback: 50 }]);
  });
});
