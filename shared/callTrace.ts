// A voice call's trace (#650, docs/voice.md "Call traces"): what the real browser's mic, audio and speech services did
// on one call, sent by the client at the call's start, every 5 s and at hang-up, logged by the office as one line
// (`voice: call trace {…}`) and kept in memory (the last 20). Only counts, states and short labels: never audio, never
// a key. cleanTrace() is the only way a trace gets in, so whatever the browser sends, only these fields come out.

export type CallTraceMode = 'jarvis' | 'office' | 'tap';

interface CallTrack {
  label: string;
  enabled: boolean;
  muted: boolean;
  state: string;
  /** The track's settings: Hz and channels (0 when the browser doesn't say). */
  rate: number;
  channels: number;
}

export interface CallTrace {
  /** The call (one per call, so the 5 s updates replace each other). */
  id: string;
  /** Sent this long after the call started. */
  ms: number;
  /** Sent at hang-up. */
  final: boolean;
  ua: string;
  mode: CallTraceMode;
  /** Who hears the manager: the office's own voice's elevenlabs (speech to text) or browser; on a Jarvis call (#658) browser, elevenlabs, openai or clip, the last one that ran. */
  listen: string;
  /** getUserMedia: '' not asked yet, 'ok', or the error's name. */
  gum: string;
  track: CallTrack | null;
  /** callAudio()'s state and Hz, and the office voice's meter's (often the same context). */
  audio: string;
  meter: string;
  /** The Jarvis mic's AudioWorklet module: '' not loaded yet, 'ok', or the error. */
  worklet: string;
  workletMsgs: number;
  rmsMax: number;
  rmsMean: number;
  /** Jarvis: user_audio_chunk messages sent, their PCM bytes and the bytes that weren't zero. */
  chunks: number;
  chunkBytes: number;
  nonZeroBytes: number;
  /** The user_input_audio_format ElevenLabs asked for (it gets 16 kHz PCM unless it says otherwise). */
  inFormat: string;
  /** The rate the mic was actually sent at (#656), Hz. */
  sentRate: number;
  /** user_transcript events back from ElevenLabs: 0 with chunks sent is a call that can't hear the manager. */
  transcripts: number;
  /** Utterances sent to the agent as user_message (#658, a count, never the words) and the agent's replies. */
  utterances: number;
  replies: number;
  /** The office voice's MediaRecorder: type, chunks, bytes. */
  recorder: { mime: string; chunks: number; bytes: number } | null;
  /** /api/voice/transcribe answers: HTTP status and error text (the last 10). */
  posts: { status: number; error: string }[];
  /** ElevenLabs socket messages seen, by type. */
  ws: Record<string, number>;
  close: { code: number; reason: string } | null;
  /** Voice switches, silent-mic and fallback decisions, with their reasons (the last 40). */
  events: { ms: number; what: string }[];
}

const MODES: readonly CallTraceMode[] = ['jarvis', 'office', 'tap'];
export const TRACE_EVENTS = 40;
export const TRACE_POSTS = 10;
const TRACE_WS_TYPES = 24;

/** A short label: a string, one line, at most `max` characters, and nothing that looks like base64 audio or a key. */
function short(v: unknown, max = 80): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return s.replace(/[A-Za-z0-9+/=_-]{32,}/g, '…');
}
const num = (v: unknown, max = 1e12) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
const int = (v: unknown, max = 1e12) => Math.round(num(v, max));
const level = (v: unknown) => Math.round(num(v, 1) * 10_000) / 10_000;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(-max) : []);

/** The trace the browser sent, reduced to its known fields (every text through `scrub`, the office's secret redaction); null when it isn't one. */
export function cleanTrace(raw: unknown, scrub: (s: string) => string = (s) => s): CallTrace | null {
  const label = (v: unknown, max?: number) => scrub(short(v, max));
  const r = obj(raw);
  const id = short(r.id, 24);
  if (!/^[\w-]{1,24}$/.test(id)) return null;
  const mode = MODES.includes(r.mode as CallTraceMode) ? (r.mode as CallTraceMode) : 'office';
  const t = r.track ? obj(r.track) : null;
  const rec = r.recorder ? obj(r.recorder) : null;
  const close = r.close ? obj(r.close) : null;
  const ws: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(r.ws)).slice(0, TRACE_WS_TYPES)) if (/^[a-z_]{1,40}$/.test(k)) ws[k] = int(v);
  return {
    id,
    ms: int(r.ms),
    final: r.final === true,
    ua: label(r.ua, 120),
    mode,
    listen: label(r.listen, 16),
    gum: label(r.gum, 40),
    track: t && { label: label(t.label, 60), enabled: t.enabled === true, muted: t.muted === true, state: label(t.state, 12), rate: int(t.rate, 384_000), channels: int(t.channels, 8) },
    audio: label(r.audio, 40),
    meter: label(r.meter, 40),
    worklet: label(r.worklet, 120),
    workletMsgs: int(r.workletMsgs),
    rmsMax: level(r.rmsMax),
    rmsMean: level(r.rmsMean),
    chunks: int(r.chunks),
    chunkBytes: int(r.chunkBytes),
    nonZeroBytes: int(r.nonZeroBytes),
    inFormat: label(r.inFormat, 20),
    sentRate: int(r.sentRate, 384_000),
    transcripts: int(r.transcripts),
    utterances: int(r.utterances),
    replies: int(r.replies),
    recorder: rec && { mime: label(rec.mime, 40), chunks: int(rec.chunks), bytes: int(rec.bytes) },
    posts: list(r.posts, TRACE_POSTS).map((p) => ({ status: int(obj(p).status, 999), error: label(obj(p).error, 160) })),
    ws,
    close: close && { code: int(close.code, 9999), reason: label(close.reason, 120) },
    events: list(r.events, TRACE_EVENTS).map((e) => ({ ms: int(obj(e).ms), what: label(obj(e).what, 200) })),
  };
}

/** The traces kept (the newest last, at most `max`): a call's newer trace replaces its older one. */
export function keepTrace(list: readonly CallTrace[], t: CallTrace, max = 20): CallTrace[] {
  return [...list.filter((x) => x.id !== t.id), t].slice(-max);
}

/** A short user agent: the browser and the device, not the whole string. */
export function shortAgent(ua: string): string {
  const device = /iPhone|iPad|Android|Macintosh|Windows|Linux/.exec(ua)?.[0] ?? '';
  const browser = /(CriOS|FxiOS|EdgiOS|Edg|Chrome|Firefox|Version)\/[\d.]+/.exec(ua)?.[0]?.replace(/^Version/, 'Safari') ?? '';
  return `${browser || 'browser'} ${device}`.trim();
}

/** Bytes in a PCM16 little-endian sample block that aren't zero (two per sample). */
export function nonZeroPcmBytes(samples: Float32Array): number {
  let n = 0;
  for (const x of samples) if (Math.round(Math.max(-1, Math.min(1, x)) * 0x7fff) !== 0) n += 2;
  return n;
}
