// When the manager has stopped talking to the 🎙 (mic.ts). Speech shows up either as words the browser recognised or
// as microphone levels (recording for ElevenLabs); a short quiet after it means "done", and a mic that never hears
// anything closes. A sentence left hanging ("…the, uh") waits longer. Pure, so it's tested without a microphone.
import { CLIP_MAX_MS } from '../../../shared/clipLimits';
import { unfinished } from './micText';

/** Quiet after speech that means you've finished, unless this device picked another pause (micPause.ts). */
export const SILENCE_MS = 3000;
/** The pauses Settings → Voice offers ("Pause before I'm done"). */
export const PAUSE_CHOICES = [1500, 3000, 5000, 8000] as const;
/** A sentence left hanging waits this many times the pause… */
const UNFINISHED_FACTOR = 3;
/** …but never longer than this. */
export const UNFINISHED_CAP_MS = 15_000;
/** Quiet shorter than this is just a breath: the drain only shows after it. */
export const DRAIN_SHOW_MS = 500;
/** How long a tapped 🎙 or the hands-free phone waits for you to start talking. */
export const NO_SPEECH_MS = 8000;
/** Below this level (RMS, 0-1) nothing counts as speech, however quiet the room. */
export const MIN_SPEECH_LEVEL = 0.02;
/** Speech is at least this many times the room's noise. */
export const SPEECH_RATIO = 3;
/** The room's noise is the quietest of the last this many levels (3 s at 20 a second): speech always has gaps. */
export const FLOOR_SAMPLES = 60;
/** The first levels only teach the mic the room. */
export const WARMUP_SAMPLES = 6;

/** How a session started: held (🎙 or V), tapped (listens until you stop talking), opened by the hands-free phone, or a voice call's turn. */
export type MicMode = 'hold' | 'tap' | 'handsfree' | 'call';

/** What the mic has heard so far. Times are the caller's clock (performance.now()). */
export interface Ears {
  start: number;
  /** When speech was last heard; null until it starts. */
  lastSpeech: number | null;
  /** The latest microphone levels (RMS), newest last, at most FLOOR_SAMPLES. */
  levels: number[];
  /** How many levels it has heard in all. */
  heard: number;
}

export const freshEars = (now: number): Ears => ({ start: now, lastSpeech: null, levels: [], heard: 0 });

/** The room's noise: the quietest recent level. */
export const noiseFloor = (e: Ears) => (e.levels.length ? Math.min(...e.levels) : 0);

/** Words the browser is still recognising: someone is talking now. */
export const heardWords = (e: Ears, now: number): Ears => ({ ...e, lastSpeech: now });

/** One microphone level (about every 50 ms). Speech stands well above the room's noise, so a steady hum never counts. */
export function heardLevel(e: Ears, level: number, now: number): Ears {
  if (!Number.isFinite(level) || level < 0) return e;
  const levels = [...e.levels, level].slice(-FLOOR_SAMPLES);
  const speech = e.heard >= WARMUP_SAMPLES && level >= Math.max(MIN_SPEECH_LEVEL, noiseFloor({ ...e, levels }) * SPEECH_RATIO);
  return { ...e, levels, heard: e.heard + 1, lastSpeech: speech ? now : e.lastSpeech };
}

/** A mic that gave nothing but silence this long, nobody heard, can't hear you (#645): a muted or dead stream, audio that never ran. */
export const SILENT_MIC_MS = 5000;
/** Below this level (RMS) the mic gives pure silence: a working one always hears some room noise. */
export const SILENT_LEVEL = 1e-5;

/** The mic gives silence, not a quiet room: its track muted or ended, or every level since it opened pure silence. */
export function deadMic(e: Ears, now: number, track?: { muted: boolean; readyState: string }): boolean {
  if (now - e.start < SILENT_MIC_MS || e.lastSpeech !== null) return false;
  if (track && (track.muted || track.readyState === 'ended')) return true;
  return e.heard >= WARMUP_SAMPLES && Math.max(...e.levels) < SILENT_LEVEL;
}

/** When a session ends by itself: after this quiet once speech was heard, with no speech this long, or at the cap. */
export interface ListenRules {
  silenceMs: number | null;
  noSpeechMs: number | null;
  maxMs: number;
}

/**
 * A held 🎙 listens until you let go (with auto-send on, also until you stop talking); a tap and the hands-free phone
 * end on a short quiet and give up when nobody speaks. Nothing listens longer than a clip may be.
 */
export function listenRules(mode: MicMode, autoSend: boolean, pauseMs: number = SILENCE_MS): ListenRules {
  return {
    silenceMs: mode === 'hold' && !autoSend ? null : pauseMs,
    noSpeechMs: mode === 'hold' ? null : NO_SPEECH_MS,
    maxMs: CLIP_MAX_MS,
  };
}

/** Whether what was heard is sent when listening ends by itself or by letting go: hands-free and calls always, else with auto-send on. */
export const sendsWhenDone = (mode: MicMode, autoSend: boolean) => mode === 'handsfree' || mode === 'call' || autoSend;

export type Verdict = 'listening' | 'done' | 'no-speech' | 'too-long';

/** The quiet that means "done" after `text` (what was heard so far; '' for a recording): longer while it's unfinished. */
function quietNeeded(rules: ListenRules, text: string): number | null {
  if (rules.silenceMs === null) return null;
  return unfinished(text) ? Math.min(rules.silenceMs * UNFINISHED_FACTOR, UNFINISHED_CAP_MS) : rules.silenceMs;
}

/** Whether to keep listening at `now`: 'done' (you've stopped talking), 'no-speech' (nobody spoke) or 'too-long'. */
export function verdict(e: Ears, now: number, rules: ListenRules, text = ''): Verdict {
  if (now - e.start >= rules.maxMs) return 'too-long';
  if (e.lastSpeech === null) return rules.noSpeechMs !== null && now - e.start >= rules.noSpeechMs ? 'no-speech' : 'listening';
  const need = quietNeeded(rules, text);
  return need !== null && now - e.lastSpeech >= need ? 'done' : 'listening';
}

/** The pause draining before "done", for the ring around the 🎙: from when, and how long in all; null while talking. */
export interface Drain {
  from: number;
  ms: number;
}

export function drainOf(e: Ears | null, now: number, rules: ListenRules, text = ''): Drain | null {
  if (!e || e.lastSpeech === null || now - e.lastSpeech < DRAIN_SHOW_MS) return null;
  const need = quietNeeded(rules, text);
  return need === null ? null : { from: e.lastSpeech, ms: need };
}
