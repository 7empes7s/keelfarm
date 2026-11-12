import { describe, expect, it } from 'vitest';
import { agentEvent, downsample, floatToPcm, formatRate, initMessage, level, orbState, pcmToFloat } from './agentCall';

describe("the Jarvis voice: ElevenLabs' conversation protocol", () => {
  it('reads the agent socket messages the call needs', () => {
    expect(agentEvent(JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { agent_output_audio_format: 'pcm_22050' } }))).toEqual({ kind: 'ready', rate: 22050 });
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
});
