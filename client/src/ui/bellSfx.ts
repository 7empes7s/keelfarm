// The trading floor's merge bell (#370), played instead of the gong, through sfx.ts's tones and its merge-strike limits.

import { mergeStrike, noise, tone } from './sfx';

/** A bright brass strike, its partials near a bell's (minor third, fifth, octave and the hum below), ringing ~3 s. */
export function bell(level = 1) {
  if (!mergeStrike()) return;
  const o = { name: 'bell', group: 'alerts' } as const;
  const k = Math.max(0, Math.min(1, level));
  const f0 = 523.25;
  noise({ ...o, dur: 0.05, peak: 0.06 * k, filter: 'bandpass', freq: 4200, q: 1.2, attack: 0.001 });
  for (const [ratio, peak, dur] of [
    [0.5, 0.08, 3.4],
    [1, 0.16, 3],
    [1.19, 0.06, 2.2],
    [1.5, 0.05, 2],
    [2, 0.06, 1.6],
    [2.67, 0.03, 1.1],
  ] as const)
    for (const at of [0, 0.32, 0.64]) tone({ ...o, freq: f0 * ratio, at, dur, peak: peak * k * (at ? 0.7 : 1), attack: 0.003 });
}
