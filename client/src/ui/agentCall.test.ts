import { describe, expect, it } from 'vitest';
import { afterClose, agentEvent, closeWords, DEAF_MS, deafWhy, downsample, encodeMic, eventType, floatToPcm, formatRate, initMessage, inputFormat, level, orbState, pcmToFloat, replyLeftMs } from './agentCall';

describe("the Jarvis voice: ElevenLabs' conversation protocol", () => {
  it('reads the agent socket messages the call needs', () => {
    expect(agentEvent(JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { agent_output_audio_format: 'pcm_22050' } }))).toEqual({ kind: 'ready', rate: 22050, inFormat: '' });
    expect(agentEvent(JSON.stringify({ type: 'audio', audio_event: { audio_base_64: 'AAA=', event_id: 3 } }))).toEqual({ kind: 'audio', event: 3, pcm: 'AAA=' });
    expect(agentEvent(JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: 'On it.' } }))).toEqual({ kind: 'said', text: 'On it.' });
    expect(agentEvent(JSON.stringify({ type: 'agent_response_correction', agent_response_correction_event: { corrected_agent_response: 'On' } }))).toEqual({ kind: 'said', text: 'On' });
    expect(agentEvent(JSON.stringify({ type: 'user_transcript', user_transcription_event: { user_transcript: 'status' } }))).toEqual({ kind: 'heard', text: 'status' });
    expect(agentEvent(JSON.stringify({ type: 'interruption', interruption_event: { event_id: 4 } }))).toEqual({ kind: 'interrupted', event: 4 });
    expect(agentEvent(JSON.stringify({ type: 'ping', ping_event: { event_id: 9 } }))).toEqual({ kind: 'ping', event: 9 });
    expect(agentEvent('not json')).toEqual({ kind: 'other' });
    expect(formatRate('ulaw_8000')).toBe(16000);
    expect(JSON.parse(initMessage('abc'))).toEqual({ type: 'conversation_initiation_client_data', custom_llm_extra_body: { cubefarm_session: 'abc' } });
  });

  it('carries PCM16 audio both ways and brings the mic down to 16 kHz', () => {
    const back = pcmToFloat(floatToPcm(new Float32Array([0, 0.5, -0.5, 1, -1])));
    expect([...back].map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.5, -0.5, 1, -1]);
    const mic = downsample(new Float32Array(480).fill(0.25), 48000, 16000);
    expect(mic.length).toBe(160);
    expect(mic[0]).toBeCloseTo(0.25);
    expect(level(new Float32Array(10))).toBe(0);
    expect(level(new Float32Array(10).fill(0.5))).toBe(1);
  });

  it('shows the orb listening, thinking or talking, and resting while paused, dialling or after "that\'s all"', () => {
    expect(orbState('listening', false, 'live')).toBe('listening');
    expect(orbState('thinking', false, 'live')).toBe('thinking');
    expect(orbState('speaking', false, 'off')).toBe('talking');
    expect(orbState('speaking', true, 'live')).toBeNull();
    expect(orbState('listening', false, 'idle')).toBeNull();
    expect(orbState('connecting', false, 'connecting')).toBeNull();
  });

  it("ends a reply without onended when the audio clock isn't running, and waits while paused or still playing", () => {
    expect(replyLeftMs({ paused: false, running: false, left: 2 })).toBe(0); // no output device, headless, interrupted iPhone audio
    expect(replyLeftMs({ paused: false, running: true, left: 0 })).toBe(0);
    expect(replyLeftMs({ paused: false, running: true, left: 1.5 })).toBe(1750);
    expect(replyLeftMs({ paused: true, running: false, left: 2 })).toBeGreaterThan(0);
  });
});

describe('ElevenLabs closing the conversation (#650)', () => {
  it('dials again once, then hands the call to the office voice, whose mic hears; never a call left deaf', () => {
    expect(afterClose({ dialling: false, ending: false, drops: 0 })).toBe('redial'); // before #650: 'idle', the mic off and replies in the backup voice
    expect(afterClose({ dialling: false, ending: false, drops: 1 })).toBe('fallback');
    expect(afterClose({ dialling: true, ending: false, drops: 0 })).toBe('fallback');
    expect(afterClose({ dialling: false, ending: true, drops: 0 })).toBe('idle'); // "that's all": tap the orb to talk again
  });

  it('reads the input format and the message type, and says why it closed', () => {
    expect(agentEvent(JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { agent_output_audio_format: 'pcm_16000', user_input_audio_format: 'pcm_48000' } }))).toEqual({ kind: 'ready', rate: 16000, inFormat: 'pcm_48000' });
    expect(eventType('{"type":"user_transcript","user_transcription_event":{}}')).toBe('user_transcript');
    expect(eventType('not json')).toBe('');
    expect(closeWords(1008, 'custom llm error')).toBe('ElevenLabs closed the call (1008: custom llm error)');
    expect(closeWords(1006, '')).toBe('ElevenLabs closed the call (1006)');
  });
});

describe("the manager's voice in the agent's own input format (#656)", () => {
  const tone = (rate: number, ms = 100) => Float32Array.from({ length: (rate * ms) / 1000 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate));
  const bytes = (b64: string) => atob(b64).length;

  it('reads user_input_audio_format: PCM at its rate, μ-law, ElevenLabs\' default when unsaid, and what it cannot send', () => {
    expect(inputFormat('pcm_16000')).toEqual({ codec: 'pcm', rate: 16000, ok: true });
    expect(inputFormat('pcm_22050')).toEqual({ codec: 'pcm', rate: 22050, ok: true });
    expect(inputFormat('ulaw_8000')).toEqual({ codec: 'ulaw', rate: 8000, ok: true });
    expect(inputFormat('')).toEqual({ codec: 'pcm', rate: 16000, ok: true });
    expect(inputFormat('opus_48000')).toEqual({ codec: 'pcm', rate: 16000, ok: false });
  });

  it('sends a 48 kHz (iPhone, desktop) or 44.1 kHz mic as 100 ms of the declared format: its rate, Int16 LE or μ-law', () => {
    // [audio context Hz, agent's format, bytes for 100 ms]: the strict demo agent takes ±10% (server/voiceAgentFake.ts).
    for (const [ctx, format, want] of [[48000, 'pcm_16000', 3200], [44100, 'pcm_16000', 3200], [48000, 'pcm_22050', 4410], [16000, 'pcm_48000', 9600], [48000, 'ulaw_8000', 800], [48000, 'pcm_48000', 9600]] as const) {
      expect(bytes(encodeMic(tone(ctx), ctx, inputFormat(format)).b64), `${ctx} Hz → ${format}`).toBe(want);
    }
    // Before #656 a μ-law agent got PCM16 at 16 kHz: twice the bytes, noise to its ASR.
    expect(bytes(floatToPcm(downsample(tone(48000), 48000, 16000)))).toBe(3200);
  });

  it('keeps the voice: PCM16 little-endian of the resampled tone, μ-law loud where the tone is', () => {
    const { b64, samples } = encodeMic(tone(48000), 48000, inputFormat('pcm_16000'));
    const back = pcmToFloat(b64);
    expect(back.length).toBe(samples.length);
    expect(Math.max(...back)).toBeCloseTo(0.5, 1);
    const up = encodeMic(tone(16000), 16000, inputFormat('pcm_48000')).samples;
    expect(up.length).toBe(4800);
    expect(Math.max(...up)).toBeCloseTo(0.5, 1);
    const ulaw = [...atob(encodeMic(new Float32Array(4800).fill(0), 48000, inputFormat('ulaw_8000')).b64)].map((c) => c.charCodeAt(0));
    expect(new Set(ulaw)).toEqual(new Set([0xff])); // G.711 silence
  });

  it('tells the manager the voice is not hearing them once they talked and no transcript came back, never staying silent', () => {
    const sent = inputFormat('pcm_16000');
    expect(deafWhy({ firstTalk: 0, lastTalk: 0, now: 60_000, format: 'pcm_16000', sent })).toBe(''); // never talked
    expect(deafWhy({ firstTalk: 1000, lastTalk: 4000, now: 1000 + DEAF_MS - 1, format: 'pcm_16000', sent })).toBe('');
    expect(deafWhy({ firstTalk: 1000, lastTalk: 5000, now: 6500, format: 'pcm_16000', sent })).toBe(''); // still talking
    expect(deafWhy({ firstTalk: 1000, lastTalk: 3000, now: 6500, format: 'pcm_16000', sent })).toMatch(/^The voice isn't hearing you: ElevenLabs gets your audio \(PCM 16000 Hz\)/);
    expect(deafWhy({ firstTalk: 1000, lastTalk: 16_000, now: 16_500, format: 'pcm_16000', sent })).not.toBe(''); // 15 s of talking
    expect(deafWhy({ firstTalk: 1000, lastTalk: 2000, now: 9000, format: 'opus_48000', sent })).toMatch(/^The voice isn't hearing you: it wants opus_48000 audio/);
  });
});
