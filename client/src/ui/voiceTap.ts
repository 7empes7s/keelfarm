// The ▶ on a CEO message and the ⋯ menu's "Read the whole message" (#532), in the main bundle so their tap does its
// work inside the click: iOS Safari and Android Chrome only let sound start from a tap, and the player
// (voiceMessages.ts) loads lazily and waits for the clip. So the tap wakes the shared AudioContext, plays a moment of
// silence on the one <audio> element replays use (unlocked, it plays the clip when it arrives) and, for the browser's
// voice, starts it with an empty line. It also keeps the ▶'s loading and error state.
import { create } from 'zustand';
import type { PhoneMessage } from '../../../shared/types';
import { useStore } from '../store';
import { audioUnlocked, unlockAudio } from './sfx';
import { elevenOnTap, type ReplayKind } from './voiceQueue';

/** A tap's replay: the ▶'s kind, or 'whole' (the ⋯ menu's whole message, by ElevenLabs when it can). */
export type Replay = ReplayKind | 'whole';

/** The ▶'s state: the message whose audio is being made or fetched, and the last one that failed and why. */
export const useReplay = create<{ loading: number | null; error: { id: number; text: string } | null }>(() => ({ loading: null, error: null }));

const SILENT = 'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

let el: HTMLAudioElement | null = null;
let primed = false;

/** The one <audio> element replays play through, and live messages when the AudioContext is asleep. */
export function voiceElement(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!el) {
    el = new Audio();
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
  }
  return el;
}

/** The element has played inside a tap, so iOS lets it play a clip that arrives later. */
export const elementPrimed = () => primed;

/** A moment of silence on the element, from a tap; never over a clip that's playing. */
function primeElement() {
  const a = voiceElement();
  if (!a || (!a.paused && a.src !== SILENT)) return;
  a.src = SILENT;
  a.play()?.then(
    () => (primed = true),
    () => undefined,
  );
}

/** Starts the browser's voice from a tap (iOS speaks only after one), with an empty line. */
function primeSpeech() {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined' || speechSynthesis.speaking) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

/** Inside a tap (Settings → Voice's Test, #545): wakes the audio and unlocks the element a clip fetched later plays on. */
export function primeVoice(): HTMLAudioElement | null {
  unlockAudio();
  primeElement();
  return voiceElement();
}

/** Inside the tap: wakes the audio for `kind`, then plays message `m` (voiceMessages.ts). */
export function tapReplay(m: PhoneMessage, kind: Replay, browser: boolean) {
  unlockAudio();
  if (browser) primeSpeech();
  else primeElement();
  useReplay.setState({ error: null });
  void import('./voiceMessages').then((v) => v.replayMessage(m, kind));
}

/** Who reads "Read the whole message" on a tap: ElevenLabs when it can, else the browser's voice, else nobody. */
export function wholeVoice(): 'elevenlabs' | 'browser' | null {
  const { settings, voiceKeySet } = useStore.getState();
  if (elevenOnTap({ provider: settings.voice.provider, keySet: voiceKeySet })) return 'elevenlabs';
  return typeof speechSynthesis !== 'undefined' ? 'browser' : null;
}

/** Inside the tap on ⏹ or the spinner: stops the message being read, or cancels the audio being made. */
export function tapStop() {
  void import('./voiceMessages').then((v) => v.stopSpeaking());
}

// Every tap wakes the AudioContext again, not just the first (sfx.ts): iOS stops it when the app goes to the background,
// and only a tap may start it. Coming back to the tab tries too, where the browser allows it. While messages are read
// aloud, the first tap also unlocks the element, so a message arriving while iOS keeps the context asleep still plays;
// never with the voice off, as on iOS an <audio> element pauses other apps' music.
const onGesture = () => {
  if (audioUnlocked()) unlockAudio();
  if (!primed && useStore.getState().settings.voice.provider !== 'off') primeElement();
};
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, onGesture, { capture: true });
window.addEventListener('visibilitychange', () => audioUnlocked() && document.visibilityState === 'visible' && unlockAudio());
