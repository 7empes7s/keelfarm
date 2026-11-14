import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { FAKE_ECHO, FAKE_TURNS, fakeRelay, openaiRelay, sttIn, sttOut, sttSessionUpdate } from './sttRelay.ts';

// The Jarvis call's OpenAI listener (#658): the mic relayed to OpenAI Realtime transcription, the key kept on the office.
class FakeWs extends EventEmitter {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  closed: [number?, string?] | null = null;
  send(m: string) {
    this.sent.push(m);
  }
  close(code?: number, reason?: string) {
    this.closed = [code, reason];
    this.readyState = 3;
    this.emit('close', code ?? 1000);
  }
  open() {
    this.readyState = 1;
    this.emit('open');
  }
}

/** 100 ms of 24 kHz PCM16 at `amp`. */
const pcm = (amp: number, hz = 764) => {
  const b = Buffer.alloc(4800);
  for (let i = 0; i < 2400; i++) b.writeInt16LE(Math.round(amp * 0x7fff * Math.sin((2 * Math.PI * hz * i) / 24_000)), i * 2);
  return b.toString('base64');
};

describe("the office's OpenAI transcription relay", () => {
  it('opens a transcription-only gpt-4o-mini-transcribe session with server VAD on PCM16 24 kHz', () => {
    expect(sttSessionUpdate()).toEqual({
      type: 'session.update',
      session: { type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' }, turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 } } } },
    });
    expect(sttIn(JSON.stringify({ audio: 'AAAA' }))).toBe(JSON.stringify({ type: 'input_audio_buffer.append', audio: 'AAAA' }));
    expect(sttIn('{"type":"session.update"}')).toBeNull(); // the browser can only send audio
    expect(sttOut(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: ' Ship it. ' }))).toEqual({ type: 'final', text: 'Ship it.' });
    expect(sttOut(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Ship' }))).toEqual({ type: 'delta', text: 'Ship' });
    expect(sttOut(JSON.stringify({ type: 'error', error: { message: 'bad key' } }))).toEqual({ type: 'error', message: 'bad key' });
    // What OpenAI really sent for an account out of credit (the office's key, 2026-11-14): the turn's transcription failed.
    expect(sttOut(JSON.stringify({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'i1', content_index: 0, error: { type: 'insufficient_quota', code: 'credit_balance_exhausted', message: 'You have no credits remaining.' } }))).toEqual({ type: 'error', message: 'You have no credits remaining.' });
    expect(sttOut(JSON.stringify({ type: 'session.updated' }))).toBeNull();
  });

  it('sends the key only in the header to OpenAI, relays audio and the words back, never logging them', () => {
    const browser = new FakeWs();
    browser.readyState = 1;
    const up = new FakeWs();
    const log = vi.fn();
    let headers: Record<string, string> = {};
    openaiRelay(browser as unknown as WebSocket, 'sk-test-1234', log, (_url, h) => ((headers = h), up as unknown as WebSocket));
    expect(headers).toEqual({ Authorization: 'Bearer sk-test-1234' });
    browser.emit('message', JSON.stringify({ audio: 'QUJD' })); // before OpenAI's socket opens: queued
    up.open();
    expect(up.sent.map((m) => JSON.parse(m).type)).toEqual(['session.update', 'input_audio_buffer.append']);
    up.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Ship the login page today.' }));
    expect(browser.sent.map((m) => JSON.parse(m))).toEqual([{ type: 'final', text: 'Ship the login page today.' }]);
    browser.close();
    expect(up.closed).not.toBeNull();
    expect(log.mock.calls.flat().join(' ')).not.toMatch(/Ship|sk-test/);
  });

  it("the demo's fake hears talking then a pause as one turn", () => {
    vi.useFakeTimers();
    try {
      const browser = new FakeWs();
      browser.readyState = 1;
      fakeRelay(browser as unknown as WebSocket, () => undefined);
      for (let i = 0; i < 5; i++) browser.emit('message', JSON.stringify({ audio: pcm(0.5) }));
      browser.emit('message', JSON.stringify({ audio: pcm(0) }));
      vi.advanceTimersByTime(600);
      expect(browser.sent.map((m) => JSON.parse(m).type)).toEqual(['delta', 'final']);
      for (let i = 0; i < 5; i++) browser.emit('message', JSON.stringify({ audio: pcm(0.5, 220) })); // the demo voice's tone, heard back (#694)
      vi.advanceTimersByTime(600);
      for (let i = 0; i < 5; i++) browser.emit('message', JSON.stringify({ audio: pcm(0.5) }));
      vi.advanceTimersByTime(600);
      expect(browser.sent.map((m) => JSON.parse(m)).filter((m) => m.type === 'final').map((m) => m.text)).toEqual([FAKE_TURNS[0], FAKE_ECHO, FAKE_TURNS[1]]);
    } finally {
      vi.useRealTimers();
    }
  });
});
