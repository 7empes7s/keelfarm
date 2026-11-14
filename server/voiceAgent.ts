// The Jarvis voice's ElevenLabs side (#534, docs/voice.md "ElevenLabs Agents"): the office's agent on ElevenLabs
// (its custom LLM is the office's /v1/chat/completions, its voice the CEO's), and the OpenAI-style answers that
// endpoint streams back. Pure; elevenlabs.ts makes the calls and swarm/voiceAgent.ts runs the calls.
import crypto from 'node:crypto';

/** What the office's agent on ElevenLabs is made with. */
export interface AgentConfig {
  name: string;
  llmUrl: string; // the office's OpenAI-compatible base, e.g. https://office.example.com/v1 (ElevenLabs adds /chat/completions)
  llmSecretId: string; // the workspace secret holding the bearer token ElevenLabs sends to it
  voiceId: string;
  firstMessage: string;
}

/** The office's agent and its LLM secret on ElevenLabs, saved so the next call reuses them. */
export interface AgentIds {
  agentId: string;
  secretId: string;
  hash: string; // agentHash() of the config the agent was last made or updated with
}

/** English agents speak with Flash v2 (ElevenLabs Agents' low-latency voice for English). */
const AGENT_TTS_MODEL = 'eleven_flash_v2';

/**
 * Faster first audio (#665): the TTS's streaming latency optimisation (0–4; 4 also skips text normalisation, which
 * misreads numbers, so 3), and turn eagerness "eager", which answers at the earliest pause instead of "normal"'s
 * natural break (https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow). Speculative turns stay
 * off: a turn the office answers can hand work to the CEO, which a discarded guess must never do.
 */
const AGENT_TTS_LATENCY = 3;

/** The audio both ways: 16 kHz PCM16, which the call's mic is resampled to (#656). */
const AGENT_AUDIO = 'pcm_16000';

/**
 * What ElevenLabs sends the call (#656): without user_transcript the call never sees a turn. Names from the Create
 * agent API's conversation.client_events (https://elevenlabs.io/docs/api-reference/agents/create).
 */
const AGENT_CLIENT_EVENTS = ['conversation_initiation_metadata', 'audio', 'interruption', 'user_transcript', 'agent_response', 'agent_response_correction', 'vad_score', 'ping'] as const;

/**
 * The agent's conversation config for POST /v1/convai/agents/create and PATCH /v1/convai/agents/:id. The prompt is
 * a formality: the custom LLM (the office) decides every word. Interruptions and the per-call extra body are on; the
 * input and output formats and the events the call needs are set, not left to the account's defaults (#656).
 */
export function agentBody(c: AgentConfig) {
  return {
    name: c.name,
    conversation_config: {
      agent: {
        first_message: c.firstMessage,
        language: 'en',
        prompt: { prompt: 'You are the voice of the cubefarm office. The custom LLM writes every reply.', llm: 'custom-llm', custom_llm: { url: c.llmUrl, model_id: 'cubefarm-voice', api_key: { secret_id: c.llmSecretId } } },
      },
      asr: { user_input_audio_format: AGENT_AUDIO },
      tts: { model_id: AGENT_TTS_MODEL, voice_id: c.voiceId, agent_output_audio_format: AGENT_AUDIO, optimize_streaming_latency: AGENT_TTS_LATENCY },
      turn: { turn_eagerness: 'eager' },
      conversation: { client_events: [...AGENT_CLIENT_EVENTS] },
    },
    platform_settings: { overrides: { custom_llm_extra_body: true } },
  };
}

/** Changes to these remake the agent's config on ElevenLabs. */
export const agentHash = (c: AgentConfig) => crypto.createHash('sha256').update(JSON.stringify(agentBody(c))).digest('hex').slice(0, 16);

/** A fresh bearer token for ElevenLabs' requests to the office's endpoint. */
export const newLlmToken = () => crypto.randomBytes(24).toString('base64url');

/** Compares a request's Authorization header with the token, in constant time. */
export function bearerOk(header: string | undefined, token: string): boolean {
  const got = Buffer.from(/^Bearer\s+(.+)$/i.exec(header ?? '')?.[1]?.trim() ?? '');
  const want = Buffer.from(token);
  return !!token && got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** The OpenAI-style chat completion for `text`, whole (stream: false). */
export function completionJson(text: string, model: string, now = Date.now()) {
  return { id: `chatcmpl-${now}`, object: 'chat.completion', created: Math.floor(now / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
}

const sentences = (text: string) => text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];

/** One streamed completion's events: a piece (the first carries the role), then the stop and [DONE]. */
function completionChunks(model: string, now: number) {
  const base = { id: `chatcmpl-${now}`, object: 'chat.completion.chunk', created: Math.floor(now / 1000), model };
  let first = true;
  return {
    piece(content: string) {
      const delta = first ? { role: 'assistant', content } : { content };
      first = false;
      return `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
    },
    end: () => [`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n'],
  };
}

/**
 * Streams a turn's pieces as they come (#665): each written the moment it exists (a sentence per event), so ElevenLabs
 * speaks the first sentence while the rest is still being made. `start` runs before the first write (the headers);
 * an error before the first piece is thrown, so the route can answer it as an error.
 */
export async function streamCompletion(pieces: AsyncIterable<string>, model: string, start: () => void, write: (ev: string) => void, now = Date.now()) {
  const it = pieces[Symbol.asyncIterator]();
  let r = await it.next();
  start();
  const c = completionChunks(model, now);
  try {
    for (; !r.done; r = await it.next()) for (const part of sentences(r.value)) write(c.piece(part));
  } catch (err) {
    console.log(`voice agent: a turn failed while streaming: ${(err as Error).message}`);
  }
  for (const ev of c.end()) write(ev);
}

/** The call a turn belongs to: the client's conversation_initiation_client_data puts it in custom_llm_extra_body. */
export function sessionOf(body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const s = b.cubefarm_session ?? (b.elevenlabs_extra_body as Record<string, unknown> | undefined)?.cubefarm_session;
  return typeof s === 'string' && /^[\w-]{1,64}$/.test(s) ? s : '';
}

/**
 * The log line for a request to a voice route (#650: IT sees what reached the office, and what it answered), or null
 * for routes that aren't voice or log themselves (a call trace that went in). Never a session id or a body.
 */
export function voiceRouteLine(method: string, url: string, status: number, ms: number): string | null {
  const p = url.split('?')[0];
  if (!p.startsWith('/api/voice/') && p !== '/v1/chat/completions') return null;
  if (p === '/api/voice/trace' && status < 300) return null;
  return `voice: ${method} ${p.replace(/^\/api\/voice\/agent\/[^/]+\/end$/, '/api/voice/agent/:session/end')} ${status} (${Math.round(ms)} ms)`;
}

/** What the reply address answered a request without the agent token (#682): a status, the body's start, a redirect. */
export interface ReachAnswer {
  status: number; // 0: no answer
  body: string;
  location?: string;
  error?: string;
}

/** The body /v1/chat/completions answers without the agent token: proof the request reached a cubefarm office. */
const OFFICE_401 = 'Not the office voice agent';

/** Which office answered (#682): a short hash of its agent token, safe to show, so a shared address can't pass for another office. */
export const officeVoiceId = (token: string) => crypto.createHash('sha256').update(`office:${token}`).digest('hex').slice(0, 10);

/** The 401 an office answers without its agent token, naming the office. */
export const office401 = (token: string) => `${OFFICE_401} (office ${officeVoiceId(token)})`;

/**
 * Why ElevenLabs can't reach the office's custom LLM at the reply address ('' when it can): only the office's own 401
 * proves a request got through; a login page, someone else's 404 or no answer at all means a call would hang.
 */
export function reachWhy(a: ReachAnswer, office = ''): string {
  if (a.status === 401 && a.body.includes(OFFICE_401)) {
    const who = /\(office (\w+)\)/.exec(a.body)?.[1];
    return office && who && who !== office ? 'it answered as another cubefarm office' : '';
  }
  if (!a.status) return `it couldn't be reached (${a.error || 'no answer'})`;
  if (/cloudflareaccess\.com|cdn-cgi\/access/i.test(a.location ?? '') || /Cloudflare Access/i.test(a.body)) return 'Cloudflare Access is in front of it: add a bypass for /v1/chat/completions';
  if (a.status === 404) return "it answered 404, so the address leads somewhere else (check the tunnel's route)";
  if (a.status === 401) return 'it answered 401 but not as the office (something else asks for a login)';
  return `it answered ${a.status}${a.location ? ` (a redirect to ${a.location.slice(0, 80)})` : ''}, not the office`;
}
