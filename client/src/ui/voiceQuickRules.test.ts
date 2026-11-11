import { describe, expect, it } from 'vitest';
import type { UsageSource, VoiceSettings } from '../../../shared/types';
import { chooseVoicePatch, elevenLabsUse, moreSettingsTarget, readAloudPatch } from './voiceQuickRules';

const voice: VoiceSettings = { provider: 'elevenlabs', voiceId: 'a', voiceName: 'Ada', model: 'm', speakOffice: false, keepDays: 7, speed: 1, favourites: [], agentsSpeak: true };
// What the quick sheet saves is applied over settings.voice, the object Settings → Voice reads.
const saved = (patch: Partial<VoiceSettings>) => ({ ...voice, ...patch });

describe("the Sound sheet's voice block (#500)", () => {
  it('turns read-aloud off and back to what it was', () => {
    expect(saved(readAloudPatch(false, true, null)).provider).toBe('off');
    expect(saved(readAloudPatch(true, true, 'browser')).provider).toBe('browser');
    expect(saved(readAloudPatch(true, true, null)).provider).toBe('elevenlabs');
    expect(saved(readAloudPatch(true, false, null)).provider).toBe('browser');
    expect(saved(readAloudPatch(true, false, 'off')).provider).toBe('browser');
  });

  it('picks a voice into the same fields as Settings → Voice', () => {
    expect(saved(chooseVoicePatch({ id: 'b', name: 'Ben' }))).toMatchObject({ voiceId: 'b', voiceName: 'Ben', provider: 'elevenlabs', speed: 1 });
  });

  it('"More sound settings" opens Settings → Voice, the 3D office too', () => {
    expect(moreSettingsTarget('sound')).toEqual({ kind: 'manager', tab: 'voice' });
    expect(moreSettingsTarget('access')).toEqual({ kind: 'manager', tab: 'access' });
  });

  it("shows ElevenLabs' character use when usage has it", () => {
    const src = (windows: UsageSource['windows']) => [{ id: 'elevenlabs', windows }];
    expect(elevenLabsUse(src([{ name: 'Characters', usedPct: 61, used: 61000, limit: 100000, unit: 'chars', resetsAt: null }]))).toBe('61,000 of 100,000 characters used this month');
    expect(elevenLabsUse(src([]))).toBeNull();
    expect(elevenLabsUse(undefined)).toBeNull();
  });
});
