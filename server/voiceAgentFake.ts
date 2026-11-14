// The demo's ElevenLabs Agents (#534): a fake agent socket on the office itself (/ws/voice-agent, demo only) that
// speaks ElevenLabs' conversation protocol, so the client's Jarvis call runs end to end with no network: it greets,
// answers every typed turn (user_message) through the office's own custom LLM, "speaks" a soft tone as PCM 16 kHz
// for about as long as saying the words would take, and is interrupted by a turn sent while it talks. It is strict about
// the mic (#656): audio that isn't the user_input_audio_format it announced (SWARM_DEMO_VOICE_IN, default pcm_16000)
// closes the call as ElevenLabs' ASR would hear only noise, and the manager talking then pausing is heard (a fixed reply).
import type { WebSocket } from 'ws';

export const FAKE_AGENT_PATH = '/ws/voice-agent';
const RATE = 16_000;
const CHUNK_S = 0.5;

/** "Speech" for `text`: a soft tone with a syllable-like wobble, as base64 PCM16 chunks (about 14 characters a second, at most 8 s). */
function fakeSpeech(text: string): { chunks: string[]; ms: number } {
  const seconds = Math.min(0.5 + text.length / 14, 8);
  const n = Math.round(RATE * seconds);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, t * 20, (seconds - t) * 20) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t));
    pcm.writeInt16LE(Math.round(5000 * env * Math.sin(2 * Math.PI * (220 + 30 * Math.sin(2 * Math.PI * 0.7 * t)) * t)), i * 2);
  }
  const step = RATE * CHUNK_S * 2;
  const chunks: string[] = [];
  for (let o = 0; o < pcm.length; o += step) chunks.push(pcm.subarray(o, o + step).toString('base64'));
  return { chunks, ms: Math.round(seconds * 1000) };
}

/** The formats the fake can announce, as bytes per sample and rate. */
const FORMATS: Record<string, { bytes: number; rate: number }> = { pcm_8000: { bytes: 2, rate: 8000 }, pcm_16000: { bytes: 2, rate: 16_000 }, pcm_22050: { bytes: 2, rate: 22_050 }, pcm_24000: { bytes: 2, rate: 24_000 }, pcm_44100: { bytes: 2, rate: 44_100 }, pcm_48000: { bytes: 2, rate: 48_000 }, ulaw_8000: { bytes: 1, rate: 8000 } };

/** The user_input_audio_format the fake announces: SWARM_DEMO_VOICE_IN when it's one ElevenLabs has, else pcm_16000. */
export const fakeInFormat = (env = process.env.SWARM_DEMO_VOICE_IN) => (env && FORMATS[env] ? env : 'pcm_16000');

/**
 * Why a user_audio_chunk isn't `format` ('' when it is). The call sends 100 ms of mono audio per chunk (#656), so a chunk's
 * bytes say its rate and sample size: 48 kHz sent as 16 kHz is three times too long, PCM16 sent as μ-law twice.
 */
export function chunkProblem(b64: string, format: string): string {
  const f = FORMATS[format] ?? FORMATS.pcm_16000;
  const bytes = Buffer.from(b64, 'base64').length;
  const want = (f.rate / 10) * f.bytes;
  if (bytes % f.bytes) return `${bytes} bytes isn't ${format} (${f.bytes}-byte samples)`;
  return Math.abs(bytes - want) > want * 0.1 ? `${bytes} bytes for 100 ms isn't ${format} (${Math.round(want)} expected)` : '';
}

/** The loudest sample in a chunk of `format`, 0..1. */
export function chunkPeak(b64: string, format = 'pcm_16000'): number {
  const buf = Buffer.from(b64, 'base64');
  let peak = 0;
  if (format.startsWith('ulaw')) {
    for (const u of buf) {
      const v = ~u & 0xff;
      const mag = ((((v & 0x0f) << 3) + 0x84) << ((v >> 4) & 7)) - 0x84;
      peak = Math.max(peak, mag);
    }
  } else for (let i = 0; i + 1 < buf.length; i += 2) peak = Math.max(peak, Math.abs(buf.readInt16LE(i)));
  return peak / 0x8000;
}

type Llm = (session: string, messages: { role: 'user' | 'assistant'; content: string }[]) => Promise<string>;

/** One conversation on the fake agent socket; `llm` is the office's /v1/chat/completions, called in process. */
export function fakeAgent(ws: WebSocket, llm: Llm, firstMessage: () => string, log: (line: string) => void = () => undefined, inFormat = fakeInFormat()) {
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let session = '';
  let event = 0;
  let speakingUntil = 0;
  let started = false;
  const mic = { chunks: 0, sound: 0, peak: 0, talking: 0 }; // the manager's audio, for the log (#648): a call that can't hear shows here
  let pause: ReturnType<typeof setTimeout> | null = null; // the manager stopped talking: their turn, as ElevenLabs' turn detection hears it
  ws.on('close', () => {
    if (pause) clearTimeout(pause);
    if (mic.chunks) log(`voice agent (demo): the call's mic sent ${mic.chunks} audio chunks, ${mic.sound} with sound (peak ${mic.peak.toFixed(2)})`);
  });
  const send = (m: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));

  const speak = (text: string) => {
    event++;
    const { chunks, ms } = fakeSpeech(text);
    for (const audio_base_64 of chunks) send({ type: 'audio', audio_event: { audio_base_64, event_id: event } });
    send({ type: 'agent_response', agent_response_event: { agent_response: text } });
    speakingUntil = Date.now() + ms;
    history.push({ role: 'assistant', content: text });
  };

  ws.on('message', (raw) => {
    let m: { type?: string; text?: string; user_audio_chunk?: unknown; custom_llm_extra_body?: { cubefarm_session?: unknown } };
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.type === 'conversation_initiation_client_data' && !started) {
      started = true;
      session = typeof m.custom_llm_extra_body?.cubefarm_session === 'string' ? m.custom_llm_extra_body.cubefarm_session : '';
      send({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: `demo-${Date.now()}`, agent_output_audio_format: 'pcm_16000', user_input_audio_format: inFormat } });
      speak(firstMessage());
      return;
    }
    if (typeof m.user_audio_chunk === 'string') {
      const wrong = chunkProblem(m.user_audio_chunk, inFormat);
      if (wrong) {
        log(`voice agent (demo): the call's mic isn't ${inFormat}: ${wrong}`);
        return ws.close(1008, `audio isn't ${inFormat}: ${wrong}`.slice(0, 120));
      }
      const peak = chunkPeak(m.user_audio_chunk, inFormat);
      mic.chunks++;
      if (peak > 0.01 && ++mic.sound === 1) log(`voice agent (demo): the call's mic audio arrives (peak ${peak.toFixed(2)})`);
      mic.peak = Math.max(mic.peak, peak);
      if (peak > 0.1) {
        mic.talking++;
        if (pause) clearTimeout(pause);
        pause = setTimeout(() => {
          pause = null;
          if (mic.talking >= 5) heardAudio();
          mic.talking = 0;
        }, 800);
      }
      return;
    }
    if (m.type !== 'user_message' || typeof m.text !== 'string' || !m.text.trim()) return; // pong, user_activity: nothing to answer
    turn(m.text);
  });

  /** Talking then a pause on the mic: heard as a turn, answered with a fixed line (the demo has no speech to text, and the CEO's chat stays the typed turns'). */
  function heardAudio() {
    const secs = (mic.talking / 10).toFixed(1);
    if (Date.now() < speakingUntil) send({ type: 'interruption', interruption_event: { event_id: event } });
    send({ type: 'user_transcript', user_transcription_event: { user_transcript: `(${secs} s of you talking)` } });
    speak('I heard you. The demo has no speech to text, so type to me to ask something.');
  }

  /** The manager's typed turn (user_message). */
  function turn(text: string) {
    if (Date.now() < speakingUntil) send({ type: 'interruption', interruption_event: { event_id: event } });
    speakingUntil = 0;
    if (!text.startsWith('[[cubefarm:')) send({ type: 'user_transcript', user_transcription_event: { user_transcript: text } });
    history.push({ role: 'user', content: text });
    void llm(session, history.slice(-20)).then(speak, (err: Error) => speak(`Sorry, that went wrong: ${err.message}`));
  }
}
