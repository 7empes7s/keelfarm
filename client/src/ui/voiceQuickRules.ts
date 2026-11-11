// The Sound sheet's Voice block (#500): turning read-aloud on and off, picking a voice, where "More sound settings"
// goes, and ElevenLabs' character use. Patches go to settings.voice, the same settings Settings → Voice reads.
import type { UsageSource, VoiceOption, VoiceProvider, VoiceSettings } from '../../../shared/types';

/** Read messages aloud on or off: off keeps what was on (`last`) to turn back to, else ElevenLabs with a key, else the browser. */
export function readAloudPatch(on: boolean, keySet: boolean, last: VoiceProvider | null): Pick<VoiceSettings, 'provider'> {
  if (!on) return { provider: 'off' };
  return { provider: last && last !== 'off' ? last : keySet ? 'elevenlabs' : 'browser' };
}

/** An ElevenLabs voice picked in any picker of the voice settings. */
export const chooseVoicePatch = (v: Pick<VoiceOption, 'id' | 'name'>): Pick<VoiceSettings, 'voiceId' | 'voiceName'> => ({ voiceId: v.id, voiceName: v.name });

/** "More …" under the quick cards: Settings → Voice for the sound, in both offices, or Accessibility. */
export const moreSettingsTarget = (what: 'sound' | 'access') => ({ kind: 'manager' as const, tab: what === 'access' ? ('access' as const) : ('voice' as const) });

/** "61,000 of 100,000 characters used this month", from the ElevenLabs usage source; null when it has no count. */
export function elevenLabsUse(sources: Pick<UsageSource, 'id' | 'windows'>[] | undefined): string | null {
  const w = sources?.find((s) => s.id === 'elevenlabs')?.windows.find((x) => x.unit === 'chars' && x.used !== undefined && x.limit !== undefined);
  return w ? `${w.used!.toLocaleString('en')} of ${w.limit!.toLocaleString('en')} characters used this month` : null;
}
