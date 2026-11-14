import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE_AGENT, addCallSeconds, agentListener, agentWhy, minutesCost, minutesLabel, nextListener, parseUsage, usageMinutes, voiceAgentSettings } from './voiceAgent';

describe('the Jarvis voice minutes and cap', () => {
  it('counts minutes per day, today and this month, a started minute counting', () => {
    let u = addCallSeconds({}, '2026-11-12', 61);
    u = addCallSeconds(u, '2026-11-12', 30);
    u = addCallSeconds(u, '2026-11-01', 600);
    u = addCallSeconds(u, '2026-10-31', 6000);
    expect(usageMinutes(u, '2026-11-12')).toEqual({ minutesToday: 2, minutesMonth: 12 });
    expect(addCallSeconds({}, '2026-11-12', 10 * 3600)['2026-11-12']).toBe(4 * 3600); // a call never ended counts 4 h at most
    expect(parseUsage({ '2026-11-12': 5, nope: 3, '2026-11-13': -1 })).toEqual({ '2026-11-12': 5 });
  });

  it('falls back to the old voice mode without a key, without the office address, or over the monthly cap', () => {
    const base = { settings: DEFAULT_VOICE_AGENT, keySet: true, officeUrl: 'https://office.example.com', minutesMonth: 0, fake: false };
    expect(agentWhy(base)).toBe('');
    expect(agentWhy({ ...base, keySet: false })).toMatch(/ElevenLabs key/);
    expect(agentWhy({ ...base, officeUrl: '' })).toMatch(/https address/);
    expect(agentWhy({ ...base, officeUrl: '', fake: true })).toBe(''); // the demo's fake agent needs no address
    expect(agentWhy({ ...base, minutesMonth: 15 * 60 - 1 })).toBe('');
    expect(agentWhy({ ...base, minutesMonth: 15 * 60 })).toMatch(/15 h of Jarvis voice are used/);
    expect(agentWhy({ ...base, settings: { ...DEFAULT_VOICE_AGENT, on: false } })).toMatch(/off/);
  });

  it('keeps settings in range and labels minutes and their cost', () => {
    expect(voiceAgentSettings(DEFAULT_VOICE_AGENT, { capHours: 2.3, on: false })).toEqual({ on: false, capHours: 2.25 });
    expect(voiceAgentSettings(DEFAULT_VOICE_AGENT, { capHours: -4, on: 'yes' })).toEqual({ on: true, capHours: 0 });
    expect(voiceAgentSettings(DEFAULT_VOICE_AGENT, null)).toEqual(DEFAULT_VOICE_AGENT);
    expect(minutesLabel(42)).toBe('42 min');
    expect(minutesLabel(185)).toBe('3 h 05 min');
    expect(minutesCost(90)).toBe('$7.20');
  });

  it('listens with the browser, then the agent, then OpenAI through the office, then a clip per turn (#658)', () => {
    const all = { recognition: true, stream: true, stt: true, recorder: true };
    expect(agentListener(undefined, all)).toBe('browser');
    expect(agentListener('browser', all)).toBe('browser');
    expect(agentListener('browser', { ...all, recognition: false })).toBe('elevenlabs'); // Firefox
    expect(agentListener('elevenlabs', all)).toBe('elevenlabs');
    expect(agentListener(undefined, { recognition: false, stream: false, stt: true, recorder: true })).toBe('clip');
    expect(nextListener('browser', all)).toBe('elevenlabs');
    expect(nextListener('elevenlabs', all)).toBe('openai'); // the agent never heard: OpenAI next
    expect(nextListener('elevenlabs', { ...all, stt: false })).toBe('clip'); // no OpenAI key
    expect(nextListener('openai', all)).toBe('clip');
    expect(nextListener('clip', all)).toBeNull();
    expect(voiceAgentSettings(DEFAULT_VOICE_AGENT, { listen: 'elevenlabs' }).listen).toBe('elevenlabs');
    expect(voiceAgentSettings(DEFAULT_VOICE_AGENT, { listen: 'whisper' }).listen).toBeUndefined();
  });

  it('starts with the listener the setting forces, for testing each mode, when the call can use it (#665)', () => {
    const all = { recognition: true, stream: true, stt: true, recorder: true };
    expect(agentListener('auto', all)).toBe('browser');
    expect(agentListener('openai', all)).toBe('openai');
    expect(agentListener('clip', all)).toBe('clip');
    expect(agentListener('elevenlabs', all)).toBe('elevenlabs');
    expect(agentListener('openai', { ...all, stt: false })).toBe('browser'); // no OpenAI key: auto's choice
    expect(agentListener('browser', { ...all, recognition: false })).toBe('elevenlabs'); // Firefox: auto's choice
    for (const l of ['auto', 'openai', 'clip'] as const) expect(voiceAgentSettings(DEFAULT_VOICE_AGENT, { listen: l }).listen).toBe(l);
  });
});
