// The Jarvis call's OpenAI listener (#658, docs/voice.md "Who listens"): when the browser can't recognise speech and
// the ElevenLabs agent doesn't hear the manager, the call's mic goes to the office over /ws/voice-stt and on to OpenAI
// Realtime transcription (gpt-4o-mini-transcribe, a transcription-only session with server VAD), so the key never
// reaches the browser. The browser sends {audio} (base64 PCM16, 24 kHz mono); it gets back {type:'delta'|'final', text}
// and {type:'error', message}. Protocol: https://developers.openai.com/api/docs/guides/realtime-transcription
import WebSocket from 'ws';
import { chunkPeak } from './voiceAgentFake.ts';

export const STT_PATH = '/ws/voice-stt';
const OPENAI_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
const STT_MODEL = 'gpt-4o-mini-transcribe';
/** The rate the browser sends at: OpenAI Realtime's PCM16 rate. */
const STT_RATE = 24_000;

/** The transcription-only session: PCM16 at 24 kHz in, gpt-4o-mini-transcribe, server VAD ending each turn after half a second of quiet. */
export const sttSessionUpdate = (language = 'en') => ({
  type: 'session.update',
  session: {
    type: 'transcription',
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: STT_RATE },
        transcription: { model: STT_MODEL, language },
        turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
      },
    },
  },
});

/** What the browser gets for one OpenAI event, or null for events it doesn't need. */
export function sttOut(raw: string): { type: 'delta' | 'final'; text: string } | { type: 'error'; message: string } | null {
  let m: { type?: string; delta?: unknown; transcript?: unknown; error?: { message?: unknown } };
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (m.type === 'conversation.item.input_audio_transcription.delta' && typeof m.delta === 'string') return { type: 'delta', text: m.delta };
  if (m.type === 'conversation.item.input_audio_transcription.completed' && typeof m.transcript === 'string') return { type: 'final', text: m.transcript.trim() };
  // A turn OpenAI couldn't transcribe (an account out of credit says so here, not as an error) ends this listener too.
  if (m.type === 'error' || m.type === 'conversation.item.input_audio_transcription.failed') return { type: 'error', message: typeof m.error?.message === 'string' ? m.error.message.slice(0, 200) : 'OpenAI sent an error' };
  return null;
}

/** The browser's {audio} message as OpenAI's input_audio_buffer.append, or null for anything else. */
export function sttIn(raw: string): string | null {
  try {
    const m = JSON.parse(raw) as { audio?: unknown };
    return typeof m.audio === 'string' && m.audio.length <= 200_000 ? JSON.stringify({ type: 'input_audio_buffer.append', audio: m.audio }) : null;
  } catch {
    return null;
  }
}

const sendTo = (ws: WebSocket, m: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));

/** Relays one call's mic to OpenAI with `key` (server memory only); `log` gets counts, never words or the key. */
export function openaiRelay(browser: WebSocket, key: string, log: (line: string) => void, connect = (url: string, headers: Record<string, string>) => new WebSocket(url, { headers })) {
  const up = connect(OPENAI_URL, { Authorization: `Bearer ${key}` });
  const started = Date.now();
  const n = { chunks: 0, finals: 0 };
  const queue: string[] = []; // audio before OpenAI's socket opened
  up.on('open', () => {
    up.send(JSON.stringify(sttSessionUpdate()));
    for (const q of queue.splice(0)) up.send(q);
  });
  up.on('message', (raw) => {
    const out = sttOut(String(raw));
    if (!out) return;
    if (out.type === 'final') n.finals++;
    if (out.type === 'error') log(`voice stt: OpenAI error: ${out.message}`);
    sendTo(browser, out);
  });
  up.on('error', (err) => {
    log(`voice stt: OpenAI unreachable: ${err.message}`);
    sendTo(browser, { type: 'error', message: `OpenAI couldn't be reached (${err.message})` });
    browser.close(1011, 'OpenAI unreachable');
  });
  up.on('close', (code) => {
    if (browser.readyState === WebSocket.OPEN) browser.close(code === 1000 ? 1000 : 1011, 'OpenAI closed');
  });
  browser.on('message', (raw) => {
    const m = sttIn(String(raw));
    if (!m) return;
    n.chunks++;
    if (up.readyState === WebSocket.OPEN) up.send(m);
    else if (up.readyState === WebSocket.CONNECTING && queue.length < 100) queue.push(m);
  });
  browser.on('close', () => {
    log(`voice stt: relayed ${n.chunks} chunks, ${n.finals} transcripts in ${Math.round((Date.now() - started) / 1000)} s`);
    up.close();
  });
}

/**
 * The demo's OpenAI (no network): the manager talking then half a second of quiet is one turn, its words a fixed line
 * (the demo has no speech to text), sent as a delta at the first sound and a final at the pause, as server VAD does.
 */
export function fakeRelay(browser: WebSocket, log: (line: string) => void) {
  let talking = 0;
  let pause: ReturnType<typeof setTimeout> | null = null;
  browser.on('message', (raw) => {
    const m = sttIn(String(raw));
    if (!m) return;
    const peak = chunkPeak((JSON.parse(m) as { audio: string }).audio);
    if (peak < 0.1) return;
    if (!talking++) sendTo(browser, { type: 'delta', text: 'What' });
    if (pause) clearTimeout(pause);
    pause = setTimeout(() => {
      pause = null;
      if (talking >= 3) {
        sendTo(browser, { type: 'final', text: "What's the office doing?" });
        log('voice stt (demo): a turn transcribed');
      }
      talking = 0;
    }, 500);
  });
  browser.on('close', () => pause && clearTimeout(pause));
}
