// The demo's ElevenLabs Agents (#534): a fake agent socket on the office itself (/ws/voice-agent, demo only) that
// speaks ElevenLabs' conversation protocol, so the client's Jarvis call runs end to end with no network: it greets,
// answers every typed turn (user_message) through the office's own custom LLM, "speaks" a soft tone as PCM 16 kHz
// for about as long as saying the words would take, and is interrupted by a turn sent while it talks.
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

type Llm = (session: string, messages: { role: 'user' | 'assistant'; content: string }[]) => Promise<string>;

/** One conversation on the fake agent socket; `llm` is the office's /v1/chat/completions, called in process. */
export function fakeAgent(ws: WebSocket, llm: Llm, firstMessage: () => string) {
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let session = '';
  let event = 0;
  let speakingUntil = 0;
  let started = false;
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
    let m: { type?: string; text?: string; custom_llm_extra_body?: { cubefarm_session?: unknown } };
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.type === 'conversation_initiation_client_data' && !started) {
      started = true;
      session = typeof m.custom_llm_extra_body?.cubefarm_session === 'string' ? m.custom_llm_extra_body.cubefarm_session : '';
      send({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: `demo-${Date.now()}`, agent_output_audio_format: 'pcm_16000', user_input_audio_format: 'pcm_16000' } });
      speak(firstMessage());
      return;
    }
    if (m.type !== 'user_message' || typeof m.text !== 'string' || !m.text.trim()) return; // user_audio_chunk, pong, user_activity: nothing to hear in a demo
    if (Date.now() < speakingUntil) send({ type: 'interruption', interruption_event: { event_id: event } });
    speakingUntil = 0;
    if (!m.text.startsWith('[[cubefarm:')) send({ type: 'user_transcript', user_transcription_event: { user_transcript: m.text } });
    history.push({ role: 'user', content: m.text });
    void llm(session, history.slice(-20)).then(speak, (err: Error) => speak(`Sorry, that went wrong: ${err.message}`));
  });
}
