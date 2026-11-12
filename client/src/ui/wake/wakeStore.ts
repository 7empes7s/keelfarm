// The wake word's state (#537) apart from its engine (wakeEngine.ts, loaded only once it's on), so Settings and the
// header's mic light never load onnxruntime: this device's prefs (localStorage `cubefarm:wake`) and what it's doing.
import { create } from 'zustand';
import { parseWakePrefs, type WakePause, type WakePrefs } from './wakeWord';

const PREF = 'cubefarm:wake';

/** '' listening; 'starting' loading the models or asking for the mic; 'tap' waiting for a tap before audio can run; 'error' the models wouldn't load. */
export type WakeStatus = WakePause | 'starting' | 'tap' | 'error';

interface WakeView {
  prefs: WakePrefs;
  status: WakeStatus;
  /** The browser refused the mic: it stays off until the wake word is turned on again. */
  micRefused: boolean;
  /** The model's last score, 0..1. */
  score: number;
  /** Why it couldn't load, for Settings. */
  why: string;
  wakes: number;
}

function read(): WakePrefs {
  try {
    return parseWakePrefs(localStorage.getItem(PREF));
  } catch {
    return parseWakePrefs(null); // private mode, or no storage
  }
}

export const useWake = create<WakeView>(() => ({ prefs: read(), status: 'off', micRefused: false, score: 0, wakes: 0, why: '' }));

/** Changes this device's wake word settings; turning it on clears a refused mic, to ask again. */
export function setWakePrefs(patch: Partial<WakePrefs>) {
  const prefs = { ...useWake.getState().prefs, ...patch };
  useWake.setState(patch.on ? { prefs, micRefused: false } : { prefs });
  try {
    localStorage.setItem(PREF, JSON.stringify(prefs));
  } catch {
    // private mode: just this visit
  }
}

/** The header's mic light shows: it's listening, or about to. */
export const micLit = (s: WakeStatus) => s === '' || s === 'starting' || s === 'tap';
