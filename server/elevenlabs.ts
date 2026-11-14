// ElevenLabs' REST API through Node's fetch: checking a key, listing the account's voices, speaking a message,
// turning the manager's speech into text. The key travels only in the xi-api-key header; error messages are
// ElevenLabs' own words, never the key.
import type { VoiceOption } from '../shared/types.ts';
import { clipExtension } from '../shared/clipLimits.ts';
import { probeClip } from './clipProbe.ts';
import { isV4Voice } from '../shared/voices.ts';
import { STT_MODEL, synthBody, VoiceApiError, type VoiceApi } from './voice.ts';
import { agentBody, agentHash, type ReachAnswer } from './voiceAgent.ts';
import { streamChat } from './voiceFast.ts';

const API = 'https://api.elevenlabs.io';
const CHECK_TIMEOUT_MS = 10_000;
const MAX_VOICE_PAGES = 5; // 100 voices a page

async function call(key: string, pathname: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${pathname}`, { ...init, signal, headers: { ...init.headers, 'xi-api-key': key } });
  } catch (err) {
    throw new VoiceApiError(0, signal.aborted ? 'it took too long to answer' : `it couldn't be reached (${(err as Error).message})`);
  }
  if (!res.ok) throw new VoiceApiError(res.status, await reason(res));
  return res;
}

/** ElevenLabs' errors carry `detail` as a string, as { message, status }, or as a list of validation errors. */
async function reason(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  let text = '';
  try {
    const d = (JSON.parse(body) as { detail?: unknown }).detail;
    if (typeof d === 'string') text = d;
    else if (Array.isArray(d)) text = d.map((x) => (x as { msg?: unknown })?.msg).filter(Boolean).join('; ');
    else if (d && typeof d === 'object') text = String((d as { message?: unknown }).message ?? (d as { status?: unknown }).status ?? '');
  } catch {
    // not JSON
  }
  return `${res.status}${text ? `: ${text}` : ''}`.slice(0, 200);
}

const s = (v: unknown) => (typeof v === 'string' ? v : '');

interface ApiVoice {
  voice_id?: unknown;
  name?: unknown;
  category?: unknown;
  labels?: Record<string, unknown> | null;
  preview_url?: unknown;
  high_quality_base_model_ids?: unknown;
  verified_languages?: unknown;
}

/** The models a voice says it was made or verified for (both lists are optional in the API). */
function voiceModels(v: ApiVoice): string[] {
  const hq = Array.isArray(v.high_quality_base_model_ids) ? v.high_quality_base_model_ids.map(s) : [];
  const verified = Array.isArray(v.verified_languages) ? v.verified_languages.map((l) => s((l as { model_id?: unknown })?.model_id)) : [];
  return [...hq, ...verified].filter(Boolean);
}

export function voiceOption(v: ApiVoice): Omit<VoiceOption, 'recommended'> {
  const l = v.labels ?? {};
  return {
    id: s(v.voice_id),
    name: s(v.name),
    category: s(v.category),
    labels: { accent: s(l.accent), gender: s(l.gender), age: s(l.age), description: s(l.description) || s(l.descriptive), use_case: s(l.use_case) || s(l['use case']) },
    previewUrl: s(v.preview_url) || null,
    ...(isV4Voice(voiceModels(v)) ? { v4: true } : {}),
  };
}

export const elevenLabs: VoiceApi = {
  // The cheapest call a voices-reading key can make: one voice.
  async checkKey(key) {
    await call(key, '/v2/voices?page_size=1&include_total_count=false', {}, AbortSignal.timeout(CHECK_TIMEOUT_MS));
  },

  async listVoices(key) {
    const out: Omit<VoiceOption, 'recommended'>[] = [];
    let token = '';
    for (let page = 0; page < MAX_VOICE_PAGES; page++) {
      const q = new URLSearchParams({ page_size: '100', include_total_count: 'false', ...(token ? { next_page_token: token } : {}) });
      const res = await call(key, `/v2/voices?${q}`, {}, AbortSignal.timeout(CHECK_TIMEOUT_MS));
      const body = (await res.json()) as { voices?: ApiVoice[]; has_more?: boolean; next_page_token?: string | null };
      for (const v of body.voices ?? []) if (s(v.voice_id)) out.push(voiceOption(v));
      token = s(body.next_page_token);
      if (!body.has_more || !token) break;
    }
    return out;
  },

  async synthesize(key, req, signal) {
    const res = await call(
      key,
      `/v1/text-to-speech/${encodeURIComponent(req.voiceId)}?output_format=mp3_44100_128`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(synthBody(req)) },
      signal,
    );
    return Buffer.from(await res.arrayBuffer());
  },

  probe: probeClip, // a clip ffprobe can't decode never costs a transcription (#658)

  // Speech to Text (POST /v1/speech-to-text, multipart): no "(laughter)" tags and no timestamps, just the words.
  async transcribe(key, { audio, type }, signal) {
    const form = new FormData();
    form.append('model_id', STT_MODEL);
    form.append('tag_audio_events', 'false');
    form.append('timestamps_granularity', 'none');
    form.append('file', new Blob([new Uint8Array(audio)], { type }), `speech.${clipExtension(type)}`);
    const res = await call(key, '/v1/speech-to-text', { method: 'POST', body: form }, signal);
    return s(((await res.json()) as { text?: unknown }).text);
  },

  // ElevenLabs Agents (#534): the LLM token as a workspace secret, then the agent made or patched to the config.
  async ensureAgent(key, config, have, llmToken) {
    const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
    const json = { 'Content-Type': 'application/json' };
    let secretId = have?.secretId ?? '';
    if (!secretId) {
      const res = await call(key, '/v1/convai/secrets', { method: 'POST', headers: json, body: JSON.stringify({ type: 'new', name: 'cubefarm-voice-llm', value: llmToken }) }, signal);
      secretId = s(((await res.json()) as { secret_id?: unknown }).secret_id);
    }
    const cfg = { ...config, llmSecretId: secretId };
    const hash = agentHash(cfg);
    if (have?.agentId && have.secretId === secretId && have.hash === hash) return have;
    if (have?.agentId) {
      await call(key, `/v1/convai/agents/${encodeURIComponent(have.agentId)}`, { method: 'PATCH', headers: json, body: JSON.stringify(agentBody(cfg)) }, signal);
      return { agentId: have.agentId, secretId, hash };
    }
    const res = await call(key, '/v1/convai/agents/create', { method: 'POST', headers: json, body: JSON.stringify(agentBody(cfg)) }, signal);
    return { agentId: s(((await res.json()) as { agent_id?: unknown }).agent_id), secretId, hash };
  },

  async agentUrl(key, agentId) {
    const res = await call(key, `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, {}, AbortSignal.timeout(CHECK_TIMEOUT_MS));
    return s(((await res.json()) as { signed_url?: unknown }).signed_url);
  },

  chatStream: streamChat, // the Jarvis voice's fast answers (#665): not ElevenLabs, but the call's voice
  reach, // the reply address checked as ElevenLabs would reach it (#682)
};

/** How long the reply address may take to answer before a call opens without the Jarvis voice. */
const REACH_TIMEOUT_MS = 2_500;

/** POSTs to the office's public custom LLM address without the token, through the internet as ElevenLabs would. */
async function reach(url: string): Promise<ReachAnswer> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', redirect: 'manual', signal: AbortSignal.timeout(REACH_TIMEOUT_MS) });
    const body = (await res.text().catch(() => '')).slice(0, 2000);
    return { status: res.status, body, ...(res.headers.get('location') && { location: res.headers.get('location')! }) };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    return { status: 0, body: '', error: e.name === 'TimeoutError' ? `no answer in ${REACH_TIMEOUT_MS / 1000} s` : (e.cause?.code ?? e.message) };
  }
}
