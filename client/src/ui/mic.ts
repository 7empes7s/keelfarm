// The 🎙: talking instead of typing (docs/voice.md). One listening session at a time, in whichever message box asked
// (MicButton.tsx registers them): the browser's speech recognition fills the box as you speak, or a recording goes to
// ElevenLabs through the office and comes back as text. Holding the 🎙 or V talks, a tap listens until you stop
// talking, and the phone's hands-free conversation opens the mic after the CEO's spoken reply. The mic is only ever on
// while one of those shows its pulsing 🎙; while it is, the jukebox and the CEO's voice dip and cues wait (sfx.ts).
// The rules are pure (micSilence.ts, handsFree.ts, micKeys.ts, micText.ts); window.__swarmMic is the probe.
import { create } from 'zustand';
import { CLIP_MAX_BYTES, clipProblem } from '../../../shared/clipLimits';
import type { ListenProvider } from '../../../shared/types';
import { api } from '../api';
import { callAudio } from './agentCallStore';
import { ctxLabel, trace, traceLevel, tracePost, traceTrack } from './callTrace';
import { useStore } from '../store';
import { isConfirmOpen } from './Confirm';
import { bindings } from './controls';
import { HANDS_FREE_IDLE, handsFree, type HandsFree, type HandsFreeEvent, type Room } from './handsFree';
import { closesMic, HOLD_MS, isTalkKey, type KeyPlace } from './micKeys';
import { useMicPause } from './micPause';
import { deadMic, drainOf, freshEars, heardLevel, heardWords, listenRules, sendsWhenDone, SILENT_MIC_MS, verdict, type Drain, type Ears, type MicMode } from './micSilence';
import { AUDIO_ASLEEP, callListens, cantListen, joinHeard, MIC_NO_START, MIC_SILENT, micErrorLine, phrasesText, speechFailed, withoutTrailingFillers, withTranscript, type MicCaps, type Phrase } from './micText';
import { FakeRecognition, fakeLive, type Recognition, type RecognitionClass } from './micFake';
import { holdMusicDuck } from './music';
import { getAudioPrefs, listenChime, setMicOpen, subscribeAudio } from './sfx';

export type MicState = 'idle' | 'listening' | 'transcribing' | 'error';

/** What the 🎙 buttons show. */
export interface MicView {
  state: MicState;
  mode: MicMode | null;
  /** The message box listening (or that last failed). */
  target: string | null;
  /** The microphone itself is on: listening shows a moment before it is. */
  live: boolean;
  /** The hands-free phone is chiming before it listens. */
  chiming: boolean;
  /** The quiet after speech is draining towards "done" (the ring around the 🎙); null while you talk. */
  drain: Drain | null;
}

export const useMic = create<MicView>(() => ({ state: 'idle', mode: null, target: null, live: false, chiming: false, drain: null }));

/** A message box with a 🎙. */
export interface MicTarget {
  id: string;
  kind: 'phone' | 'agent' | 'console' | 'call';
  /** The box's form: a key in a field of this form is a key in the box. */
  form(): HTMLFormElement | null;
  text(): string;
  setText(text: string): void;
  send(text: string): void;
  disabled(): boolean;
}

const targets = new Map<string, MicTarget>(); // oldest first

/** Adds a message box; returns its removal (which stops any listening there). */
export function registerTarget(t: MicTarget): () => void {
  targets.delete(t.id);
  targets.set(t.id, t);
  return () => {
    if (targets.get(t.id) !== t) return;
    targets.delete(t.id);
    if (session?.target.id === t.id) cancel('gone');
  };
}

// ---------- what this browser can do ----------

let fakeOn = false;
const browserRecognition = (): RecognitionClass | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const recognitionClass = (): RecognitionClass | null => (fakeOn ? FakeRecognition : browserRecognition());

export function micCaps(): MicCaps {
  return {
    recognition: !!recognitionClass(),
    recorder: typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  };
}

const listening = () => useStore.getState().settings.listen ?? { provider: 'off' as ListenProvider, autoSend: false, handsFree: false };

/** How a voice call listens, whatever Talk instead of type says (#645). */
export const callProvider = () => callListens(useStore.getState().voiceKeySet, micCaps());

/** Why the 🎙 can't listen now, or '' when it can. */
export function micProblem(): string {
  const { provider } = listening();
  return provider === 'off' ? '' : cantListen(provider, micCaps(), useStore.getState().voiceKeySet);
}

// ---------- one listening session ----------

interface Hearing {
  /** Finish: the last words (or the recording) still arrive. */
  stop(): void;
  /** Drop it all. */
  abort(): void;
  /** The recording's mic track, to tell a dead mic from a quiet room. */
  track?: MediaStreamTrack;
  /** The levels' audio has stopped (an iPhone's, as the mic opened): no levels come, which isn't a silent mic. */
  asleep?: () => boolean;
}

interface Session {
  n: number;
  target: MicTarget;
  mode: MicMode;
  provider: Exclude<ListenProvider, 'off'>;
  /** The box's text before listening. */
  base: string;
  transcript: string;
  /** What the browser's earlier recognitions heard, when it stopped by itself and listening went on. */
  heardBefore: string;
  /** Null until the mic is live. */
  ears: Ears | null;
  hearing: Hearing | null;
  began: number;
  finishing: boolean;
  release: (() => void) | null;
  tick: ReturnType<typeof setInterval>;
}

/** One listening session, for window.__swarmMic. */
export interface MicRecord {
  provider: Exclude<ListenProvider, 'off'>;
  mode: MicMode;
  start: number;
  end: number | null;
  transcript: string;
  /** sent, put in the box, nothing heard, stopped (Esc, M, typing, the box went away) or an error. */
  outcome: 'sent' | 'filled' | 'nothing' | 'stopped' | 'error' | null;
}

let session: Session | null = null;
let sessions = 0;
const history: MicRecord[] = [];
let record: MicRecord | null = null;
let lastTranscript = '';
let lastError = '';
/** The browser lets the office use the mic (it said so, or a session got a live mic): hands-free never asks unprompted. */
let micAllowed = false;
let askedToAllow = false;
const STARTUP_MS = 10_000; // a mic that never comes on (a permission prompt left open) gives up

const set = (patch: Partial<MicView>) => useMic.setState(patch);

/** Starts listening in box `id`. A held 🎙 or V, a tap, or the hands-free phone. */
export function listen(id: string, mode: MicMode) {
  const target = targets.get(id);
  if (!target || session || target.disabled()) return;
  const provider = mode === 'call' ? callProvider() : listening().provider;
  if (provider === 'off') return;
  const why = cantListen(provider, micCaps(), useStore.getState().voiceKeySet);
  if (why) return void (mode === 'call' ? callEars?.problem(why) : explain(why, id));
  const n = ++sessions;
  const s: Session = {
    n,
    target,
    mode,
    provider,
    base: target.text(),
    transcript: '',
    heardBefore: '',
    ears: null,
    hearing: null,
    began: performance.now(),
    finishing: false,
    release: quiet(mode),
    tick: setInterval(() => check(n), 100),
  };
  session = s;
  record = { provider, mode, start: s.began, end: null, transcript: '', outcome: null };
  history.push(record);
  if (history.length > 30) history.splice(0, history.length - 30);
  lastError = '';
  set({ state: 'listening', mode, target: id, live: false, chiming: false });
  if (provider === 'browser') s.hearing = recognise(n);
  else void recordClip(n);
}

/** The press became a tap: keep listening until you stop talking. */
export function keepListening(id: string) {
  if (session?.target.id !== id || session.mode !== 'hold') return;
  session.mode = 'tap';
  if (record) record.mode = 'tap';
  set({ mode: 'tap' });
}

/** Finish listening in box `id` (a released 🎙, a second tap): what was said still arrives. */
export function finishListening(id?: string) {
  if (session && (!id || session.target.id === id)) finish();
}

/** Stop listening in box `id` without sending (a message sent by hand, Esc). */
export function stopListening(id?: string, why: 'stopped' | 'gone' = 'stopped') {
  if (session && (!id || session.target.id === id)) cancel(why);
}

/** The session the mic is in, if it's still `n`. */
const live = (n: number) => (session?.n === n ? session : null);

function check(n: number) {
  const s = live(n);
  if (!s || s.finishing) return;
  const now = performance.now();
  if (!s.ears) {
    if (now - s.began > STARTUP_MS) {
      if (s.mode === 'call') fail(n, MIC_NO_START); // a call says so, and offers Talk
      else cancel('stopped');
    }
    return;
  }
  if (s.mode === 'call' && s.hearing?.asleep?.()) return void (now - s.ears.start >= SILENT_MIC_MS && fail(n, AUDIO_ASLEEP));
  if (s.mode === 'call' && deadMic(s.ears, now, s.hearing?.track)) return fail(n, MIC_SILENT);
  const rules = listenRules(s.mode, listening().autoSend, useMicPause.getState().ms);
  const v = verdict(s.ears, now, rules, s.transcript);
  const drain = drainOf(s.ears, now, rules, s.transcript);
  const shown = useMic.getState().drain;
  if (drain?.from !== shown?.from || drain?.ms !== shown?.ms) set({ drain });
  if (v === 'no-speech') cancel('nothing');
  else if (v !== 'listening') finish();
}

/** The mic is live. */
function started(n: number) {
  const s = live(n);
  if (!s || s.ears) return;
  s.ears = freshEars(performance.now());
  micAllowed = true;
  set({ live: true });
}

function heard(n: number, text: string, speaking: boolean) {
  const s = live(n);
  if (!s) return;
  if (!s.ears) started(n);
  if (speaking && s.ears) s.ears = heardWords(s.ears, performance.now());
  if (speaking && s.mode === 'call') callEars?.speech(text);
  text = joinHeard(s.heardBefore, text);
  s.transcript = text;
  if (record) record.transcript = text;
  lastTranscript = text;
  s.target.setText(withTranscript(s.base, text));
}

function finish() {
  const s = session;
  if (!s || s.finishing) return;
  s.finishing = true;
  if (!s.hearing) return deliver(s);
  s.hearing.stop();
  // A recognition that never says it ended still delivers what it heard.
  const n = s.n;
  setTimeout(() => {
    if (live(n) && s.provider === 'browser') deliver(s);
  }, 2500);
}

/** Listening is over: put the words in the box, and send them when the rules say so. */
function deliver(s: Session) {
  if (session !== s) return;
  const words = withoutTrailingFillers(s.transcript);
  const text = withTranscript(s.base, words);
  if (words) s.target.setText(text);
  const send = !!words && sendsWhenDone(s.mode, listening().autoSend) && !s.target.disabled();
  close(words ? (send ? 'sent' : 'filled') : 'nothing');
  if (send) {
    s.target.setText('');
    s.target.send(text);
  }
}

function cancel(why: 'stopped' | 'gone' | 'nothing') {
  const s = session;
  if (!s) return;
  s.hearing?.abort();
  close(why === 'nothing' ? 'nothing' : 'stopped');
}

/** Listening went wrong: `line` says why, or null when it simply stopped (what was heard still counts). A call's problem is reported to the office unless the office said it (`fromOffice`). */
function fail(n: number, line: string | null, fromOffice = false) {
  const s = live(n);
  if (!s) return;
  if (!line) {
    // Stopped, or nothing said: whatever was heard still counts.
    if (s.transcript) deliver(s);
    else close('nothing');
    return;
  }
  s.hearing?.abort();
  lastError = line;
  if (s.mode === 'call') callEars?.problem(line); // the call screen says it, and falls back to tap-to-talk
  if (s.mode === 'call' && !fromOffice) void api.voiceProblem(line).catch(() => undefined); // an IT ticket (#645)
  close('error');
  if (s.mode !== 'call') useStore.getState().pushToast('error', line);
  set({ state: 'error', target: s.target.id });
  setTimeout(() => useMic.getState().state === 'error' && !session && set({ state: 'idle', target: null }), 3000);
}

function close(outcome: NonNullable<MicRecord['outcome']>) {
  const s = session;
  if (!s) return;
  session = null;
  clearInterval(s.tick);
  s.release?.();
  s.release = null;
  if (record) {
    record.end = performance.now();
    record.outcome = outcome;
    record = null;
  }
  set({ state: 'idle', mode: null, target: null, live: false, drain: null });
  if (s.mode === 'call') callEars?.closed(outcome);
  if (s.mode === 'handsfree') {
    if (outcome !== 'sent') listenChime(false);
    step({ type: 'closed' });
  }
}

function explain(line: string, id: string) {
  lastError = line;
  useStore.getState().pushToast('info', line);
  set({ state: 'error', target: id });
  setTimeout(() => useMic.getState().state === 'error' && !session && set({ state: 'idle', target: null }), 3000);
}

/** While the mic listens: the jukebox, other sounds and the CEO's voice dip, the browser's voice pauses, cues wait. */
function quiet(mode: MicMode): () => void {
  const unduck = holdMusicDuck();
  if (mode === 'call') return unduck; // a call listens over the CEO's voice, for barge-in
  setMicOpen(true);
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  const paused = !!synth?.speaking && !synth.paused;
  if (paused) synth!.pause();
  return () => {
    unduck();
    setMicOpen(false);
    if (paused) synth!.resume();
  };
}

// ---------- the browser's recognition ----------

/** How often a session starts the browser's recognition again after it stopped by itself. */
export const MAX_RESTARTS = 20;

function recognise(n: number): Hearing | null {
  const R = recognitionClass();
  if (!R) {
    queueMicrotask(() => fail(n, micProblem() || micErrorLine('audio-capture')));
    return null;
  }
  let r: Recognition;
  let restarts = 0;
  const begin = (): boolean => {
    const cur = new R();
    r = cur;
    cur.lang = navigator.language || 'en-US';
    cur.continuous = true;
    cur.interimResults = true;
    let error = '';
    cur.onstart = () => started(n);
    cur.onresult = (e) => {
      if (r !== cur) return;
      const phrases: Phrase[] = Array.from(e.results, (x) => ({ transcript: x[0]?.transcript ?? '', final: x.isFinal }));
      const { text, speaking } = phrasesText(phrases);
      heard(n, text, speaking);
    };
    cur.onerror = (e) => {
      error = e.error;
    };
    cur.onend = () => {
      const s = live(n);
      if (!s || r !== cur) return;
      if (error && error !== 'no-speech') return fail(n, micErrorLine(error));
      // Mobile browsers stop by themselves after a short quiet, continuous or not: listen on until our rules say done.
      if (!s.finishing && restarts < MAX_RESTARTS) {
        restarts++;
        s.heardBefore = s.transcript;
        if (begin()) return;
      }
      deliver(s); // stopped by us, out of restarts, or it can't start again
    };
    try {
      cur.start();
      return true;
    } catch {
      return false;
    }
  };
  if (!begin()) {
    queueMicrotask(() => fail(n, micErrorLine('audio-capture')));
    return null;
  }
  return { stop: () => r.stop(), abort: () => r.abort() };
}

// ---------- recording for ElevenLabs ----------

const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

async function recordClip(n: number) {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    if (live(n)?.mode === 'call') trace({ gum: (err as DOMException)?.name || 'error' });
    return fail(n, micErrorLine((err as DOMException)?.name || 'audio-capture'));
  }
  const off = () => stream.getTracks().forEach((t) => t.stop());
  const s = live(n);
  if (s?.mode === 'call') {
    trace({ gum: 'ok' });
    traceTrack(stream.getAudioTracks()[0]);
  }
  if (!s || s.finishing) return off(); // let go before the mic came on
  const type = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  } catch {
    off();
    return fail(n, micErrorLine('audio-capture'));
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  let aborted = false;
  // A call's levels on the call's own audio, woken in the tap that started it: one made now (no tap) stays suspended on iPhones.
  const shared = s.mode === 'call' ? callAudio() : null;
  const levels = meter(stream, shared, (level) => {
    const cur = live(n);
    if (cur?.mode === 'call') traceLevel(level, false);
    const now = performance.now();
    if (cur?.ears) cur.ears = heardLevel(cur.ears, level, now);
    if (cur?.mode === 'call' && cur.ears?.lastSpeech === now) callEars?.speech('');
  });
  const traced = s.mode === 'call';
  if (traced) trace({ recorder: { mime: rec.mimeType || type || '', chunks: 0, bytes: 0 } });
  rec.ondataavailable = (e) => {
    chunks.push(e.data);
    bytes += e.data.size;
    if (traced) trace({ recorder: { mime: rec.mimeType || type || '', chunks: chunks.length, bytes } });
    if (bytes > CLIP_MAX_BYTES * 0.95) finish(); // the cap is near: send what there is
  };
  rec.onstop = () => {
    off();
    levels();
    const cur = live(n);
    if (!cur || aborted) return;
    void transcribe(cur, new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }), performance.now() - (cur.ears?.start ?? cur.began));
  };
  s.hearing = {
    track: stream.getAudioTracks()[0],
    asleep: () => !!shared && shared.state !== 'running',
    stop: () => rec.state !== 'inactive' && rec.stop(),
    abort: () => {
      aborted = true;
      if (rec.state !== 'inactive') rec.stop();
      else off();
    },
  };
  rec.start(1000);
  started(n);
}

/** Microphone levels (RMS) about 20 times a second, for the silence detector, on `shared` or an audio context of its own. Returns its stop. */
function meter(stream: MediaStream, shared: AudioContext | null, onLevel: (rms: number) => void): () => void {
  let ctx: AudioContext | null = null;
  let src: MediaStreamAudioSourceNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  try {
    ctx = shared ?? new AudioContext();
    void ctx.resume().catch(() => undefined);
    if (shared) trace({ meter: ctxLabel(ctx) });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src = ctx.createMediaStreamSource(stream);
    src.connect(analyser); // never to the speakers
    const buf = new Float32Array(analyser.fftSize);
    const audio = ctx;
    timer = setInterval(() => {
      if (audio.state !== 'running') return; // a stopped clock gives zeros, not the mic's silence (#648)
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const x of buf) sum += x * x;
      onLevel(Math.sqrt(sum / buf.length));
    }, 50);
  } catch {
    // no levels: a tap ends when you tap again, and nothing is lost
  }
  return () => {
    if (timer) clearInterval(timer);
    src?.disconnect();
    if (!shared) void ctx?.close().catch(() => undefined);
  };
}

async function transcribe(s: Session, clip: Blob, ms: number) {
  if (s.mode === 'handsfree' && s.ears?.lastSpeech == null) return close('nothing'); // nobody spoke: don't pay to hear silence
  const bad = clipProblem({ bytes: clip.size, ms, type: clip.type });
  if (bad) return fail(s.n, bad.message);
  set({ state: 'transcribing', live: false });
  s.release?.(); // the mic is off: sounds come back while the text is on its way
  s.release = null;
  try {
    const res = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': clip.type, 'X-Clip-Ms': String(Math.round(ms)), ...(s.mode === 'call' && { 'X-Voice-Call': '1' }) }, body: clip });
    const data = (await res.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
    if (s.mode === 'call') tracePost(res.status, typeof data.error === 'string' ? data.error : '');
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
    if (session !== s) return; // stopped meanwhile
    s.transcript = typeof data.text === 'string' ? data.text : '';
    lastTranscript = s.transcript;
    if (record) record.transcript = s.transcript;
    deliver(s);
  } catch (err) {
    if (s.mode === 'call' && err instanceof TypeError) tracePost(0, err.message); // never reached the office
    // The office files its own failures as an IT ticket, with the real error.
    if (session === s) fail(s.n, s.mode === 'call' ? speechFailed((err as Error).message) : (err as Error).message, true);
  }
}

// ---------- a voice call's ears ----------

/** A voice call (voiceCallEngine.ts) hears its turns' speech, and its mic closing or failing. */
export interface CallEars {
  speech(text: string): void;
  closed(outcome: MicRecord['outcome']): void;
  problem(line: string): void;
}
let callEars: CallEars | null = null;
export const setCallEars = (ears: CallEars | null) => void (callEars = ears);

// ---------- the hands-free phone ----------

let hf: HandsFree = HANDS_FREE_IDLE;
let hfTimer: ReturnType<typeof setTimeout> | null = null;

const phoneTarget = () => [...targets.values()].reverse().find((t) => t.kind === 'phone') ?? null;

function room(): Room {
  const st = useStore.getState();
  const l = listening();
  const o = st.overlay;
  const phone = phoneTarget();
  return {
    enabled: l.handsFree && l.provider !== 'off' && st.settings.voice.provider !== 'off' && !micProblem() && micAllowed,
    phoneChat: o?.kind === 'phone' && (o.tab ?? 'chat') === 'chat' && !!phone && !phone.disabled() && document.visibilityState === 'visible' && !isConfirmOpen(),
    micFree: !session,
    draft: !!phone?.text().trim(),
    muted: getAudioPrefs().muted,
  };
}

function step(ev: HandsFreeEvent) {
  const r = handsFree(hf, ev);
  hf = r.state;
  set({ chiming: hf.kind === 'chime' });
  if (hfTimer && hf.kind !== 'chime') {
    clearTimeout(hfTimer);
    hfTimer = null;
  }
  if (r.effect === 'chime') {
    listenChime(true);
    hfTimer = setTimeout(() => {
      hfTimer = null;
      step({ type: 'tick', now: performance.now(), room: room() });
    }, Math.max(0, (hf.kind === 'chime' ? hf.until : 0) - performance.now()));
  }
  if (r.effect === 'open') {
    const phone = phoneTarget();
    if (phone) listen(phone.id, 'handsfree');
    if (!session) step({ type: 'closed' });
  }
}

/** voiceMessages.ts: a CEO message read aloud in this tab ended by itself, with nothing else waiting to be read. */
export function replyEnded() {
  const r = room();
  if (listening().handsFree && !micAllowed && r.phoneChat && !askedToAllow) {
    // The browser hasn't been asked for the mic yet, and hands-free never asks out of the blue.
    askedToAllow = true;
    useStore.getState().pushToast('info', 'Hold the mic once to let the office use your microphone, then hands-free can listen.');
  }
  step({ type: 'reply-ended', now: performance.now(), room: r });
}

/** Why hands-free can't be turned on now, or ''. */
export function handsFreeProblem(ceoName: string): string {
  return micProblem() || (useStore.getState().settings.voice.provider === 'off' ? `Hands-free needs ${ceoName}'s voice: turn on Speak messages in Settings → Voice.` : '');
}

/** The hands-free switch (the phone's 🎧, Settings → Voice). Turning it on asks for the mic now, from the click. */
export async function setHandsFree(on: boolean, ceoName: string) {
  const why = on ? handsFreeProblem(ceoName) : '';
  if (why) return useStore.getState().pushToast('info', why);
  if (on && !(await allowMic())) return;
  await api.updateSettings({ listen: { ...listening(), handsFree: on } }).catch(() => undefined);
}

/** Asks for the microphone (once per page at most), so hands-free never asks later unprompted. */
async function allowMic(): Promise<boolean> {
  if (micAllowed) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    micAllowed = true;
    return true;
  } catch (err) {
    const line = micErrorLine((err as DOMException)?.name || 'audio-capture');
    if (line) useStore.getState().pushToast('error', line);
    return false;
  }
}

// ---------- keys ----------

let vPress: { target: MicTarget; key: string; box: HTMLInputElement | HTMLTextAreaElement | null; timer: ReturnType<typeof setTimeout> } | null = null;
let vTalking = false;

/** Where a key landed, and the message box it talks into ('none': the newest box on screen). */
function placeOf(el: EventTarget | null): { place: KeyPlace; target: MicTarget | null; box: HTMLInputElement | HTMLTextAreaElement | null } {
  const e = el as HTMLElement | null;
  if (e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable)) {
    const box = e as HTMLInputElement | HTMLTextAreaElement;
    const target = e.tagName !== 'SELECT' && box.form ? ([...targets.values()].find((t) => t.form() === box.form) ?? null) : null;
    return target && !box.disabled && !box.readOnly ? { place: 'mic-box', target, box } : { place: 'field', target: null, box: null };
  }
  const newest = [...targets.values()].reverse().find((t) => !t.disabled()) ?? null;
  return { place: 'none', target: newest, box: null };
}

/** Types the "v" a short press held back, at the caret, as if it had been typed (React hears an input event). */
function typeHeldV() {
  const p = vPress;
  if (!p) return;
  vPress = null;
  clearTimeout(p.timer);
  const box = p.box;
  if (!box || document.activeElement !== box) return;
  if (!document.execCommand('insertText', false, p.key)) {
    box.setRangeText(p.key, box.selectionStart ?? box.value.length, box.selectionEnd ?? box.value.length, 'end');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function onKeyDown(e: KeyboardEvent) {
  const { talk, mute } = bindings(); // the player's keys (Help → Controls): V and M unless rebound
  const isTalk = talk.includes(e.code);
  if (isTalk && e.repeat && (vPress || vTalking)) return void e.preventDefault();
  if (vPress && !isTalk) typeHeldV(); // typing on: the v comes first
  const { place, target, box } = placeOf(e.target);
  const s = session;
  if (s) {
    if (s.mode === 'call') return; // a call's keys are its own (voiceCallEngine.ts)
    if (closesMic(e, s.mode === 'handsfree', place, mute)) {
      e.preventDefault();
      e.stopImmediatePropagation(); // Esc stops listening; it doesn't also close the phone or the panel
      cancel('stopped');
    }
    return;
  }
  if (hf.kind === 'chime' && closesMic(e, true, place, mute)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    step({ type: 'closed' });
    return;
  }
  if (e.repeat || !target || !isTalkKey(e, place, talk) || isConfirmOpen() || listening().provider === 'off') return;
  e.preventDefault(); // held back: a tap types it on release
  vPress = {
    target,
    key: e.key,
    box,
    timer: setTimeout(() => {
      vPress = null;
      vTalking = true;
      listen(target.id, 'hold');
    }, HOLD_MS),
  };
}

function onKeyUp(e: KeyboardEvent) {
  if (!bindings().talk.includes(e.code)) return;
  if (vPress) typeHeldV();
  else if (vTalking) {
    vTalking = false;
    if (session?.mode === 'hold') finish();
  }
}

/** Typing in the box while it listens: the keyboard takes over. */
function onInput(e: Event) {
  const s = session;
  const el = e.target as HTMLInputElement | null;
  if (s && el?.form && el.form === s.target.form()) cancel('stopped');
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('input', onInput, true);
  // V's release can't be heard once the window loses focus: finish a V hold, forget a pending V. (The 🎙 button
  // captures the pointer, so its release still arrives.)
  window.addEventListener('blur', () => {
    if (vPress) {
      clearTimeout(vPress.timer);
      vPress = null;
    }
    if (vTalking && session?.mode === 'hold') finish();
    vTalking = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopListening();
      if (hf.kind === 'chime') step({ type: 'closed' });
    }
  });
  // Muting (M, or the sound settings) closes a mic that opened on its own.
  let wasMuted = getAudioPrefs().muted;
  subscribeAudio(() => {
    const muted = getAudioPrefs().muted;
    if (muted && !wasMuted && session && session.mode !== 'hold' && session.mode !== 'call') cancel('stopped');
    wasMuted = muted;
  });
  // Whether the browser already lets the office use the mic (from an earlier visit).
  void navigator.permissions
    ?.query({ name: 'microphone' as PermissionName })
    .then((p) => {
      micAllowed ||= p.state === 'granted';
      p.addEventListener('change', () => (micAllowed = p.state === 'granted'));
    })
    .catch(() => undefined);
}

// ---------- the probe ----------

const probe = {
  get state(): MicState {
    return useMic.getState().state;
  },
  get mode() {
    return useMic.getState().mode;
  },
  /** The microphone itself is on (listening can show a moment before it is). */
  get live() {
    return useMic.getState().live;
  },
  get provider(): ListenProvider {
    return listening().provider;
  },
  /** The last words heard (or transcribed). */
  get transcript() {
    return lastTranscript;
  },
  get error() {
    return lastError;
  },
  get supported() {
    return micCaps();
  },
  get handsFree() {
    return hf.kind;
  },
  /** Every session: provider, mode, start/end (performance.now()), transcript and outcome. */
  history,
  /** Use a fake recognition instead of the browser's (for tests: there's no mic). */
  fake(on = true) {
    fakeOn = on;
    if (on) micAllowed = true;
  },
  /** The (fake) browser stops recognising by itself, as phones do after a short quiet, or on an `error` ('not-allowed'). */
  browserStops(error?: string) {
    if (!fakeLive.now) return false;
    fakeLive.now.ends(error);
    return true;
  },
  /** What the mic hears now: words for the (fake) recognition, `final` once they're settled; or speech for a recording. */
  say(text: string, final = true) {
    const s = session;
    if (!s) return false;
    if (s.provider === 'elevenlabs') {
      if (s.ears) s.ears = heardWords(s.ears, performance.now());
      return true;
    }
    if (!fakeLive.now) return false;
    fakeLive.now.say(text, false);
    if (final) fakeLive.now.say(text, true);
    return true;
  },
};
(window as unknown as Record<string, unknown>).__swarmMic = probe;
