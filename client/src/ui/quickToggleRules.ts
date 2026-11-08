// The top bar's Sound and CC buttons (#267) and their keys (M and C by default, Help → Controls): one tap mutes or
// unmutes and turns captions on or off, through the same stores as Settings, so every control shows the change at once.
import { getA11y, setA11y } from './a11y';
import { isBound, type Bindings } from './keymap';
import { getAudioPrefs, setAudioPrefs } from './sfx';

export type QuickToggle = 'mute' | 'captions';

/** Mutes or unmutes (the volume and each group's level stay); the toast to show, or null when nothing changed. */
export function setMuted(muted: boolean, muteKey: string): string | null {
  if (getAudioPrefs().muted === muted) return null;
  setAudioPrefs({ muted });
  return muted ? `Sound off (${muteKey} to turn it back on)` : 'Sound on';
}

/** Captions on or off, saved in this browser; the toast to show, or null when nothing changed. */
export function setCaptions(on: boolean): string | null {
  if (getA11y().captions === on) return null;
  setA11y({ captions: on });
  return on ? 'Captions on' : 'Captions off';
}

/** Flips one of them; the toast to show. */
export const flip = (t: QuickToggle, muteKey: string) => (t === 'mute' ? setMuted(!getAudioPrefs().muted, muteKey) : setCaptions(!getA11y().captions));

export interface KeyPress {
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Which toggle a key press is for: none while typing in a field or a dialog is up (`blocked`), with a modifier held,
 * or on auto-repeat; captions also rest in photo mode, whose camera has C.
 */
export function quickKey(b: Bindings, e: KeyPress, blocked: boolean, photo: boolean): QuickToggle | null {
  if (blocked || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isBound(b, 'mute', e.code)) return 'mute';
  if (!photo && isBound(b, 'captions', e.code)) return 'captions';
  return null;
}
