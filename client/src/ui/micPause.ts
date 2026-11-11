// "Pause before I'm done" (Settings → Voice): how much quiet after speech means you've finished, one choice per device
// (localStorage `cubefarm:micPause`). The 🎙, hands-free and voice calls all wait this long (micSilence.ts).
import { create } from 'zustand';
import { PAUSE_CHOICES, SILENCE_MS } from './micSilence';

const PREF = 'cubefarm:micPause';

/** The saved pause, or the default when nothing (or nonsense) is saved. */
export function parsePause(saved: string | null): number {
  const n = Number(saved);
  return (PAUSE_CHOICES as readonly number[]).includes(n) ? n : SILENCE_MS;
}

function read(): number {
  try {
    return parsePause(localStorage.getItem(PREF));
  } catch {
    return SILENCE_MS; // private mode, or no storage
  }
}

export const useMicPause = create<{ ms: number; set: (ms: number) => void }>((set) => ({
  ms: read(),
  set: (ms) => {
    const v = parsePause(String(ms));
    set({ ms: v });
    try {
      localStorage.setItem(PREF, String(v));
    } catch {
      // private mode: just this visit
    }
  },
}));

/** "1.5 s", "3 s". */
export const pauseLabel = (ms: number) => `${ms / 1000} s`;
