// The call trace (#650, shared/callTrace.ts): what this browser's mic, audio and speech services really do on a call,
// sent to the office at the call's start (before any mic code, so it arrives even when that throws), every 5 s and at
// hang-up. Everything here is a no-op outside a call. Only counts, states and short labels: never audio.
// Each turn's steps (#665) are timed here too, and the trace goes at once as a turn's voice starts, so a slow or deaf
// turn is in the office's log while the call is still on.
import { markTurn, newTurn, shortAgent, TRACE_EVENTS, TRACE_POSTS, TRACE_TURNS, type CallTrace, type CallTraceMode, type CallTurn, type TurnStep } from '../../../shared/callTrace';

const EVERY_MS = 5_000;

let cur: CallTrace | null = null;
let began = 0;
let rmsSum = 0;
let rmsCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;
/** The turn under way: its conversation's session and its number on it, which the office matches to its own timing. */
let turn: (CallTurn & { session: string; s: number }) | null = null;
let turnsOnSession = { session: '', n: 0 };
let session = ''; // the Jarvis conversation under way
let onTurn: ((t: CallTurn | null) => void) | null = null;

const since = () => Math.round(performance.now() - began);

function send(t: CallTrace) {
  try {
    void fetch('/api/voice/trace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...t, ms: since() }), keepalive: true }).catch(() => undefined);
  } catch {
    // the trace never stops a call
  }
}

/** A call starts: a new trace, sent at once. */
export function traceStart(mode: CallTraceMode, listen: string, why = '') {
  traceEnd();
  began = performance.now();
  rmsSum = rmsCount = 0;
  const id = Date.now().toString(36);
  turn = null;
  turnsOnSession = { session: '', n: 0 };
  onTurn?.(null);
  cur = { id, ms: 0, final: false, ua: `${shortAgent(navigator.userAgent)}${globalThis.matchMedia?.('(display-mode: standalone)').matches ? ' app' : ''}`, mode, listen, gum: '', track: null, audio: '', meter: '', worklet: '', workletMsgs: 0, rmsMax: 0, rmsMean: 0, chunks: 0, chunkBytes: 0, nonZeroBytes: 0, inFormat: '', sentRate: 0, transcripts: 0, utterances: 0, replies: 0, recorder: null, posts: [], ws: {}, close: null, events: [], turns: [] };
  traceNote(`call starts: ${mode === 'jarvis' ? 'the Jarvis voice' : `the office's own voice${why ? ` (${why})` : ''}`}`);
  send(cur);
  timer = setInterval(() => cur && send(cur), EVERY_MS);
}

/** The call ended: the last trace goes. */
export function traceEnd() {
  if (timer) clearInterval(timer);
  timer = null;
  if (!cur) return;
  traceNote('call ends');
  send({ ...cur, final: true });
  cur = null;
}

/** A decision with its reason: a voice switch, a silent mic, a fallback. */
export function traceNote(what: string) {
  if (!cur) return;
  cur.events.push({ ms: since(), what });
  if (cur.events.length > TRACE_EVENTS) cur.events.splice(0, cur.events.length - TRACE_EVENTS);
}

/** Changes fields of the trace (mode, gum, worklet…). */
export function trace(patch: Partial<Pick<CallTrace, 'mode' | 'listen' | 'gum' | 'audio' | 'meter' | 'worklet' | 'inFormat' | 'sentRate' | 'close' | 'recorder'>>) {
  if (cur) Object.assign(cur, patch);
}

/** The mic's track, as the browser describes it. */
export function traceTrack(t: MediaStreamTrack | undefined) {
  if (!cur) return;
  const s = t?.getSettings?.() ?? {};
  cur.track = t ? { label: t.label, enabled: t.enabled, muted: t.muted, state: t.readyState, rate: s.sampleRate ?? 0, channels: s.channelCount ?? 0 } : null;
  if (t) {
    t.onmute = () => traceTrack(t);
    t.onunmute = () => traceTrack(t);
    t.onended = () => (traceTrack(t), traceNote('the mic track ended'));
  }
}

/** An audio context as "state Hz". */
export const ctxLabel = (c: BaseAudioContext | null | undefined) => (c ? `${c.state} ${c.sampleRate}` : 'none');

/** One block of the mic's samples (its RMS), from the worklet or the meter. */
export function traceLevel(rms: number, fromWorklet: boolean) {
  if (!cur) return;
  if (fromWorklet) cur.workletMsgs++;
  rmsSum += rms;
  rmsCount++;
  cur.rmsMax = Math.max(cur.rmsMax, rms);
  cur.rmsMean = rmsSum / rmsCount;
}

/** A user_audio_chunk sent to ElevenLabs: its PCM bytes and the bytes that weren't zero. */
export function traceChunk(bytes: number, nonZero: number) {
  if (!cur) return;
  cur.chunks++;
  cur.chunkBytes += bytes;
  cur.nonZeroBytes += nonZero;
}

/** A user_transcript from ElevenLabs: the agent heard the manager. */
export function traceTranscript() {
  if (cur) cur.transcripts++;
}

/** An utterance the browser, OpenAI or a clip heard, sent to the agent as a user_message (#658): a count, never the words. */
export function traceUtterance() {
  if (cur) cur.utterances++;
}

/** One of the agent's replies (agent_response). */
export function traceReply() {
  if (cur) cur.replies++;
}

/** A message from ElevenLabs' socket, by type. */
export function traceWs(type: string) {
  if (cur) cur.ws[type] = (cur.ws[type] ?? 0) + 1;
}

/** A /api/voice/transcribe answer. */
export function tracePost(status: number, error: string) {
  if (!cur) return;
  cur.posts.push({ status, error });
  if (cur.posts.length > TRACE_POSTS) cur.posts.shift();
}

// ---------- turns (#665) ----------

/** The call screen's details follow the latest turn. */
export function onTraceTurn(fn: ((t: CallTurn | null) => void) | null) {
  onTurn = fn;
}

/** The turn's latest state, in the trace (replacing its older one) and on the call screen. */
function keepTurn(t: CallTurn & { session: string; s: number }) {
  turn = t;
  if (!cur) return;
  const i = cur.turns.findIndex((x) => x.n === t.n);
  if (i >= 0) cur.turns[i] = t;
  else cur.turns.push(t);
  if (cur.turns.length > TRACE_TURNS) cur.turns.splice(0, cur.turns.length - TRACE_TURNS);
  onTurn?.(t);
}

/**
 * The manager is talking (words or sound heard by `listener`): a new turn once the last one has been sent, and its
 * end of speech moves with every new word until the words are ready.
 */
export function turnHearing(listener: string) {
  if (!cur) return;
  const t = !turn || turn.sent ? startTurn(listener) : turn;
  keepTurn(markTurn(t.speechStart ? t : markTurn(t, 'speechStart', since()), 'speechEnd', since()) as typeof t);
}

/** A step of the turn under way (one with no speech yet, a typed turn or a transcript out of nowhere, starts one). */
export function turnStep(step: Exclude<TurnStep, 'speechStart' | 'speechEnd'>, listener: string, laterMs = 0) {
  if (!cur) return;
  const at = since() + laterMs;
  const fresh = step === 'transcript' || step === 'sent';
  const t = !turn || (fresh && turn.sent) ? startTurn(listener) : turn;
  if ((step === 'firstAudio' || step === 'playback') && !t.sent) return; // the greeting or a CEO line: no turn of the manager's
  const next = { ...(markTurn(t, step, at) as typeof t), ...(fresh && !t[step] && { listener }) }; // the listener that got the words
  if (next[step] === t[step]) return;
  keepTurn(next);
  if (step === 'playback') send(cur); // the turn's answer is playing: the office sees the whole turn now, mid-call
}

/** The Jarvis conversation now on ('' between them): its turns are numbered from 1 for the office to match. */
export function turnSession(id: string) {
  session = id;
}

function startTurn(listener: string) {
  if (turnsOnSession.session !== session) turnsOnSession = { session, n: 0 };
  turnsOnSession.n++;
  return { ...newTurn((cur?.turns.at(-1)?.n ?? 0) + 1, listener), session, s: turnsOnSession.n };
}

/** The trace so far (the probe's). */
export const currentTrace = () => cur;
