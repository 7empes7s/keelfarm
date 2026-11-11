// A themed floor's ambience (#370), quietly under everything in the score's mixer group: the game studio's low synth
// pad and distant arcade blips, the trading floor's murmur of voices and keys, the lab's and ops room's server hum and
// beeps (#371). Short sounds scheduled every few
// seconds rather than a loop, and none while you're behind a panel, between floors or in another tab.
import { useStore } from '../../store';
import { noise, tone } from '../../ui/sfx';
import type { ThemePack } from './packs';

const STEP_MS = 2200;
const PAD = [110, 130.81, 164.81, 196]; // A minor, low

function synth(n: number) {
  const o = { name: 'ambience:synth', group: 'score' } as const;
  if (n % 3 === 0) for (const [i, f] of PAD.entries()) tone({ ...o, freq: f * (n % 6 === 0 ? 1 : 0.89), type: 'sine', dur: 6.5, peak: 0.011 - i * 0.002, attack: 2 });
  if (Math.random() < 0.45) {
    const base = [523.25, 659.25, 783.99, 1046.5][Math.floor(Math.random() * 4)];
    const pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < 3; i++) tone({ ...o, name: 'ambience:blip', freq: base * (1 + i * 0.25), type: 'square', at: i * 0.07, dur: 0.06, peak: 0.006, attack: 0.002, pan });
  }
}

function murmur() {
  const o = { name: 'ambience:murmur', group: 'score' } as const;
  noise({ ...o, dur: 3.6, peak: 0.018, filter: 'bandpass', freq: 380 + Math.random() * 260, q: 0.7, attack: 1.3, pan: Math.random() - 0.5 });
  if (Math.random() < 0.5) for (let i = 0; i < 4; i++) noise({ ...o, name: 'ambience:keys', at: 0.4 + i * 0.11 + Math.random() * 0.05, dur: 0.03, peak: 0.004, filter: 'bandpass', freq: 3200, q: 2, attack: 0.002, pan: Math.random() - 0.5 });
}

function hum(n: number) {
  const o = { name: 'ambience:hum', group: 'score' } as const;
  if (n % 3 === 0) noise({ ...o, dur: 6.8, peak: 0.012, filter: 'lowpass', freq: 180, q: 0.5, attack: 2 });
  if (Math.random() < 0.3) tone({ ...o, name: 'ambience:beep', freq: Math.random() < 0.5 ? 1760 : 2093, type: 'sine', dur: 0.08, peak: 0.004, attack: 0.004, pan: Math.random() * 1.4 - 0.7 });
}

/** Starts the pack's ambience; returns its stop. */
export function startAmbience(kind: ThemePack['ambience']) {
  let n = 0;
  const t = setInterval(() => {
    const s = useStore.getState();
    if (document.hidden || s.travel !== null || s.overlay !== null) return;
    if (kind === 'synth') synth(n++);
    else if (kind === 'hum') hum(n++);
    else murmur();
  }, STEP_MS);
  return () => clearInterval(t);
}
