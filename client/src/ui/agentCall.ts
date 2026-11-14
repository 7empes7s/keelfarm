// The Jarvis voice on a call (#534, docs/voice.md "ElevenLabs Agents"): ElevenLabs' conversation protocol as plain
// events, the audio it carries (PCM16 in base64, both ways) and what the orb shows. Pure, so it's tested without a
// socket or a microphone; agentCallEngine.ts runs it.

/** What one message from the agent's socket means to the call. */
export type AgentEvent =
  | { kind: 'ready'; rate: number; inFormat: string }
  | { kind: 'audio'; event: number; pcm: string }
  | { kind: 'said'; text: string } // the agent's reply, for the captions
  | { kind: 'heard'; text: string } // the manager's words, as ElevenLabs understood them
  | { kind: 'interrupted'; event: number }
  | { kind: 'ping'; event: number }
  | { kind: 'vad'; score: number }
  | { kind: 'other' };

const s = (v: unknown) => (typeof v === 'string' ? v : '');
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** ElevenLabs' output format ("pcm_16000", "pcm_22050"…) as a sample rate; anything else is read as 16 kHz. */
export const formatRate = (format: unknown) => Number(/^pcm_(\d{4,6})$/.exec(s(format))?.[1] ?? 16000);

/** One socket message, parsed. */
export function agentEvent(raw: string): AgentEvent {
  let m: Record<string, Record<string, unknown> | string | undefined>;
  try {
    m = JSON.parse(raw);
  } catch {
    return { kind: 'other' };
  }
  const body = (key: string) => (m[key] && typeof m[key] === 'object' ? (m[key] as Record<string, unknown>) : {});
  switch (m.type) {
    case 'conversation_initiation_metadata': {
      const meta = body('conversation_initiation_metadata_event');
      return { kind: 'ready', rate: formatRate(meta.agent_output_audio_format), inFormat: s(meta.user_input_audio_format) };
    }
    case 'audio': {
      const a = body('audio_event');
      return { kind: 'audio', event: n(a.event_id), pcm: s(a.audio_base_64) };
    }
    case 'agent_response':
      return { kind: 'said', text: s(body('agent_response_event').agent_response) };
    case 'agent_response_correction':
      return { kind: 'said', text: s(body('agent_response_correction_event').corrected_agent_response) };
    case 'user_transcript':
      return { kind: 'heard', text: s(body('user_transcription_event').user_transcript) };
    case 'interruption':
      return { kind: 'interrupted', event: n(body('interruption_event').event_id) };
    case 'ping':
      return { kind: 'ping', event: n(body('ping_event').event_id) };
    case 'vad_score':
      return { kind: 'vad', score: n(body('vad_score_event').vad_score) };
    default:
      return { kind: 'other' };
  }
}

/** The message's type, for the call trace (#650): '' when it has none. */
export const eventType = (raw: string) => /"type"\s*:\s*"([a-z_]{1,40})"/.exec(raw)?.[1] ?? '';

/**
 * ElevenLabs closed the conversation's socket (not the office, #650): while dialling, today's voice mode takes the call;
 * after the manager's "that's all" it rests (tap the orb); otherwise it dials again once, and a second drop in the same
 * call hands it to today's voice mode, whose mic still hears the manager. Never a call left with no mic.
 */
export function afterClose(o: { dialling: boolean; ending: boolean; drops: number }): 'fallback' | 'idle' | 'redial' {
  if (o.dialling) return 'fallback';
  if (o.ending) return 'idle';
  return o.drops < 1 ? 'redial' : 'fallback';
}

/** A closed socket's code and reason, in the words the call screen and the trace use. */
export const closeWords = (code: number, reason: string) => `ElevenLabs closed the call (${code}${reason ? `: ${reason.slice(0, 120)}` : ''})`;

/** The first message on the socket: the call's session, so the office's LLM knows which call a turn belongs to. */
export const initMessage = (session: string) => JSON.stringify({ type: 'conversation_initiation_client_data', custom_llm_extra_body: { cubefarm_session: session } });

// ---------- audio ----------

/** PCM16 little-endian in base64 → samples in -1..1. */
export function pcmToFloat(b64: string): Float32Array {
  const bin = atob(b64);
  const out = new Float32Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    out[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
  }
  return out;
}

/** Samples in -1..1 → PCM16 little-endian in base64, as ElevenLabs takes the manager's voice. */
export function floatToPcm(samples: Float32Array): string {
  let bin = '';
  for (const x of samples) {
    const v = Math.round(Math.max(-1, Math.min(1, x)) * 0x7fff) & 0xffff;
    bin += String.fromCharCode(v & 0xff, v >> 8);
  }
  return btoa(bin);
}

/** `input` at `from` Hz down to `to` Hz, averaging each step (the mic's 44.1/48 kHz to ElevenLabs' 16 kHz). */
export function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from <= to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j];
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}

// ---------- the manager's voice in (#656) ----------

/** The audio the agent takes the manager's voice in (its user_input_audio_format): 16-bit LE PCM or μ-law, mono, at `rate`. */
export interface InFormat {
  codec: 'pcm' | 'ulaw';
  rate: number;
  /** False for a format this call can't send (it sends pcm_16000, ElevenLabs' default, and says so). */
  ok: boolean;
}

/** ElevenLabs' user_input_audio_format ("pcm_16000", "pcm_48000", "ulaw_8000"…); none said means its default, pcm_16000. */
export function inputFormat(format: string): InFormat {
  const pcm = /^pcm_(\d{4,6})$/.exec(format);
  if (pcm) return { codec: 'pcm', rate: Number(pcm[1]), ok: true };
  if (format === 'ulaw_8000') return { codec: 'ulaw', rate: 8000, ok: true };
  return { codec: 'pcm', rate: 16_000, ok: format === '' };
}

/** `input` at `from` Hz to `to` Hz: averaged going down, interpolated going up (one 100 ms chunk at a time, so no block edges drift). */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || !input.length) return input;
  if (from > to) return downsample(input, from, to);
  const ratio = from / to;
  const out = new Float32Array(Math.round(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const a = Math.min(input.length - 1, Math.floor(x));
    const b = Math.min(input.length - 1, a + 1);
    out[i] = input[a] + (input[b] - input[a]) * (x - a);
  }
  return out;
}

/** One sample in -1..1 as G.711 μ-law. */
function ulawByte(x: number): number {
  let v = Math.round(Math.max(-1, Math.min(1, x)) * 0x7fff);
  const sign = v < 0 ? 0x80 : 0;
  v = Math.min(Math.abs(v), 32635) + 0x84;
  let exp = 7;
  for (let mask = 0x4000; (v & mask) === 0 && exp > 0; mask >>= 1) exp--;
  return ~(sign | (exp << 4) | ((v >> (exp + 3)) & 0x0f)) & 0xff;
}

/** A chunk of the mic at `from` Hz as the agent takes it: resampled to its rate, then PCM16 LE or μ-law, in base64. */
export function encodeMic(samples: Float32Array, from: number, f: InFormat): { b64: string; samples: Float32Array } {
  const at = resample(samples, from, f.rate);
  if (f.codec === 'pcm') return { b64: floatToPcm(at), samples: at };
  let bin = '';
  for (const x of at) bin += String.fromCharCode(ulawByte(x));
  return { b64: btoa(bin), samples: at };
}

/** How long the manager can talk with no user_transcript back before the call says the voice isn't hearing them. */
export const DEAF_MS = 5_000;
/** A chunk this loud (level()) is the manager talking, not a quiet room. */
export const TALK_LEVEL = 0.1;

/**
 * The voice isn't hearing the manager: they talked (first and last loud chunk since the last transcript) and no
 * user_transcript came back within DEAF_MS of starting and 2 s after they stopped (or 15 s of talking). The words, or ''.
 */
export function deafWhy(o: { firstTalk: number; lastTalk: number; now: number; format: string; sent: InFormat }): string {
  if (!o.firstTalk || o.now - o.firstTalk < DEAF_MS) return '';
  if (o.now - o.lastTalk < 2_000 && o.now - o.firstTalk < 15_000) return '';
  if (!inputFormat(o.format).ok) return `The voice isn't hearing you: it wants ${o.format} audio, which this call can't send. Hang up and call again on the office's own voice.`;
  return `The voice isn't hearing you: ElevenLabs gets your audio (${o.sent.codec === 'ulaw' ? 'μ-law' : 'PCM'} ${o.sent.rate} Hz) but sends no words back. Hang up and call again, or use the office's own voice.`;
}

/** A level 0..1 for the orb from samples' loudness. */
export function level(samples: Float32Array): number {
  let sum = 0;
  for (const x of samples) sum += x * x;
  return Math.min(1, Math.sqrt(sum / Math.max(1, samples.length)) * 4);
}

/**
 * The backstop for the end of a reply: ms until it's checked again, or 0 when it's over. An audio context that isn't
 * running (no output device, a headless browser, an interrupted iPhone session) never moves its clock or fires onended,
 * so its reply ends on the wall clock; a paused call waits, and a running one waits for the audio still queued (`left`, s).
 */
export function replyLeftMs(o: { paused: boolean; running: boolean; left: number }): number {
  if (o.paused) return 500;
  return o.running && o.left > 0.05 ? Math.ceil(o.left * 1000) + 250 : 0;
}

// ---------- the orb ----------

/** The conversation on the call: dialling, talking, ended by "that's all" (tap the orb to talk again), or not the Jarvis voice. */
export type AgentMode = 'off' | 'connecting' | 'live' | 'idle';

/** ElevenLabs UI's Orb states: listening, thinking, talking, or resting (null). */
export type OrbState = 'listening' | 'thinking' | 'talking' | null;

/** What the orb shows for the call's phase (voiceCall.ts) and the conversation. */
export function orbState(phase: string, paused: boolean, mode: AgentMode): OrbState {
  if (paused || mode === 'idle' || mode === 'connecting') return null;
  if (phase === 'speaking') return 'talking';
  if (phase === 'thinking') return 'thinking';
  if (phase === 'listening') return 'listening';
  return null;
}
