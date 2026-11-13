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
 * The agent's conversation config for POST /v1/convai/agents/create and PATCH /v1/convai/agents/:id. The prompt is
 * a formality: the custom LLM (the office) decides every word. Interruptions and the per-call extra body are on.
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
      tts: { model_id: AGENT_TTS_MODEL, voice_id: c.voiceId },
      turn: { turn_eagerness: 'normal' },
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

/** The same as server-sent events (stream: true): a chunk per sentence, so ElevenLabs starts speaking at once, then [DONE]. */
export function completionEvents(text: string, model: string, now = Date.now()): string[] {
  const base = { id: `chatcmpl-${now}`, object: 'chat.completion.chunk', created: Math.floor(now / 1000), model };
  const parts = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  return [
    ...parts.map((content, i) => `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: i ? { content } : { role: 'assistant', content }, finish_reason: null }] })}\n\n`),
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
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
