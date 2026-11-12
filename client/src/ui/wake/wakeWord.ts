// The wake word (#537, docs/voice.md "Wake word"): its choices and this device's settings, when it listens, and the
// gate that turns the model's scores into one wake per phrase. Pure, so it's tested without a mic or a model;
// wakePipeline.ts feeds it, wakeEngine.ts runs it in the browser.

export type WakeWordId = 'hey-mimoun' | 'hey-jarvis';

export interface WakeWordInfo {
  id: WakeWordId;
  label: string;
  /** The classifier under /wake/ (openWakeWord's input: 16 frames x 96). */
  model: string;
  note: string;
}

export const WAKE_WORDS: readonly WakeWordInfo[] = [
  { id: 'hey-mimoun', label: 'Hey Mimoun', model: 'hey_mimoun.onnx', note: 'trained here on synthetic voices' },
  { id: 'hey-jarvis', label: 'Hey Jarvis', model: 'hey_jarvis_v0.1.onnx', note: "openWakeWord's stock model" },
];

export const wakeWord = (id: WakeWordId) => WAKE_WORDS.find((w) => w.id === id) ?? WAKE_WORDS[0];

/** This device's wake word (localStorage `cubefarm:wake`): the mic is this device's, so the choice is too. */
export interface WakePrefs {
  on: boolean;
  word: WakeWordId;
  /** 0 (only a clear "Hey Mimoun") .. 1 (wakes easily). */
  sensitivity: number;
}

export const DEFAULT_WAKE: WakePrefs = { on: false, word: 'hey-mimoun', sensitivity: 0.5 };

/** Saved prefs, or the defaults for anything missing or nonsense. */
export function parseWakePrefs(saved: string | null): WakePrefs {
  let raw: Partial<Record<keyof WakePrefs, unknown>> = {};
  try {
    raw = JSON.parse(saved ?? '{}') ?? {};
  } catch {
    // nonsense: the defaults
  }
  const s = Number(raw.sensitivity);
  return {
    on: raw.on === true,
    word: WAKE_WORDS.some((w) => w.id === raw.word) ? (raw.word as WakeWordId) : DEFAULT_WAKE.word,
    sensitivity: Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : DEFAULT_WAKE.sensitivity,
  };
}

/** The score that wakes: 0.8 at the lowest sensitivity, 0.5 in the middle, 0.2 at the highest. */
export const wakeThreshold = (sensitivity: number) => 0.8 - 0.6 * Math.min(1, Math.max(0, sensitivity));

export const sensitivityLabel = (s: number) => (s < 0.34 ? 'Strict' : s > 0.66 ? 'Easy' : 'Balanced');

// ---------- when it listens ----------

export type WakePause = '' | 'off' | 'call' | 'dictating' | 'hidden' | 'battery' | 'no-mic';

/** Why it isn't listening right now ('' when it is). */
export function wakePause(s: { on: boolean; inCall: boolean; dictating?: boolean; hidden: boolean; batterySaver: boolean; micRefused: boolean }): WakePause {
  if (!s.on) return 'off';
  if (s.micRefused) return 'no-mic';
  if (s.inCall) return 'call';
  if (s.dictating) return 'dictating';
  if (s.hidden) return 'hidden';
  if (s.batterySaver) return 'battery';
  return '';
}

export const PAUSE_WORDS: Record<WakePause, string> = {
  '': 'Listening',
  off: 'Off',
  'no-mic': 'The microphone was refused: allow it for this site, then turn the wake word on again',
  call: 'Paused during the call',
  dictating: 'Paused while the message box listens',
  hidden: 'Paused while the office is in the background',
  battery: 'Paused on low battery',
};

/** Battery saver, as far as a browser can tell: unplugged and at 20% or less (Chrome's Battery API; Safari has none). */
export const batterySaver = (b: { charging: boolean; level: number } | null) => !!b && !b.charging && b.level <= 0.2;

// ---------- one wake per phrase ----------

/** 80 ms frames: a wake is followed by at least 2 s without another. */
export const REFRACTORY_FRAMES = 25;

/** Turns per-frame scores into wakes: one when a score reaches the threshold, then none until the phrase is over (2 s and the score back down). */
export class WakeGate {
  private quiet = 0; // frames left before it can wake again
  private armed = true;
  constructor(public threshold: number) {}

  push(score: number): boolean {
    if (this.quiet > 0) this.quiet--;
    if (!this.armed) {
      if (score < this.threshold / 2 && this.quiet === 0) this.armed = true;
      return false;
    }
    if (score < this.threshold) return false;
    this.armed = false;
    this.quiet = REFRACTORY_FRAMES;
    return true;
  }

  reset() {
    this.quiet = 0;
    this.armed = true;
  }
}
