import { trackSteps, type StepTracker } from '../../ui/footstepRules';
import type { Surface } from '../layout';

// When the dog makes a sound, kept free of WebAudio so it can be tested: a woof or bark at most every so often, a
// breath of panting on a beat while it's out of breath, and its claws tapping on hard floors (not rugs) with each paw,
// using the footsteps' own step tracker and surfaces. DogSounds.tsx turns these into sounds, all quiet.
// Its woofs, barks and yips are short recordings (CC0), loaded on the first one; the synthesized ones stay as the fallback.

/** Shortest gap between two woofs, barks or yips (s). */
export const VOICE_GAP = 1.2;
/** Between two breaths of panting (s), and two claw taps (s): a gallop's taps are thinned out. */
export const PANT_GAP = 0.32;
export const TAP_GAP = 0.11;
/** Beyond this (m) its little sounds (claws, panting, sniffing) aren't played at all. */
export const HEAR = 9;

export const mayVoice = (last: number, now: number) => now - last >= VOICE_GAP;

/** How loud claws are on a surface: not at all on a rug, brightest on the lobby's tiles. */
export function clawLevel(surface: Surface): number {
  switch (surface) {
    case 'rug':
      return 0;
    case 'lobby':
      return 1.2;
    case 'cabin':
      return 0.9;
    default:
      return 1;
  }
}

/** Whether a paw comes down this frame: four a stride (the gait's phase in radians), as the footsteps count them. */
export const pawDown = (t: StepTracker, phase: number, moving: boolean) => trackSteps(t, phase * 2, moving) === 'step';

/** Whether a claw tap plays: a paw came down on a hard floor, near enough, and not too soon after the last. */
export const tapDue = (paw: boolean, surface: Surface, distance: number, last: number, now: number) => paw && clawLevel(surface) > 0 && distance < HEAR && now - last >= TAP_GAP;

/** Whether a breath of panting plays now. */
export const pantDue = (panting: boolean, distance: number, last: number, now: number) => panting && distance < HEAR && now - last >= PANT_GAP;

// ---------- recorded voice ----------

export type DogVoice = 'woof' | 'bark' | 'yip';

/** The recorded clips per voice, in client/public/sounds/dog/ (each in docs/third-party-sounds.md, all CC0). */
export const DOG_CLIPS: Readonly<Record<DogVoice, readonly string[]>> = {
  woof: ['woof-1', 'woof-2', 'woof-3'],
  bark: ['bark-1', 'bark-2'],
  yip: ['yip'],
};

/** How loud each voice's clip plays (the clips are peak-normalized), near the synthesized woof's level. */
export const CLIP_PEAK: Readonly<Record<DogVoice, number>> = { woof: 0.09, bark: 0.12, yip: 0.08 };

/** A queued voice waits this long (s) for the clips to load, else it plays synthesized. */
export const CLIP_WAIT = 0.4;

/** Which voice the brain's events ask for (a bark beats a yip beats a woof), or null. Bits from DOG_EVENT. */
export function voiceOf(ev: number, bits: { woof: number; bark: number; yip: number }): DogVoice | null {
  if (ev & bits.bark) return 'bark';
  if (ev & bits.yip) return 'yip';
  if (ev & bits.woof) return 'woof';
  return null;
}

/** A clip's file: .ogg where the browser plays it, else .mp3 (older Safari). */
export const clipUrl = (name: string, ogg: boolean, base = '/') => `${base}sounds/dog/${name}.${ogg ? 'ogg' : 'mp3'}`;

/** A random playback rate within ±5%, so the same clip doesn't sound the same twice. */
export const clipRate = (rnd: number) => 0.95 + rnd * 0.1;

/**
 * The clips, loaded on the first voice (not at startup) through `load`. `voice` says what to play right now: a clip,
 * 'wait' while they load (call again), or 'synth' when they failed or loading takes longer than CLIP_WAIT.
 */
export function createClipBank<T>(load: (name: string) => Promise<T>) {
  let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  const clips = new Map<string, T>();
  return {
    get state() {
      return state;
    },
    /** `asked` is when the voice was first asked for (s), `now` the clock; `rnd` in [0, 1) picks the clip. */
    voice(kind: DogVoice, asked: number, now: number, rnd: number): T | 'wait' | 'synth' {
      if (state === 'idle') {
        state = 'loading';
        const names = Object.values(DOG_CLIPS).flat();
        Promise.all(names.map((n) => load(n).then((c) => clips.set(n, c)))).then(
          () => (state = 'ready'),
          () => (state = 'failed'),
        );
      }
      if (state === 'ready') {
        const names = DOG_CLIPS[kind];
        return clips.get(names[Math.min(names.length - 1, Math.floor(rnd * names.length))])!;
      }
      return state === 'loading' && now - asked < CLIP_WAIT ? 'wait' : 'synth';
    },
  };
}
