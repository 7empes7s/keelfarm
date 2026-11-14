// The Jarvis voice's fast answers (#665, docs/voice.md "How fast a call answers"): a question the office's own
// answers (shared/voiceBrain.ts) don't cover goes to a fast model with the office's facts, streamed so ElevenLabs
// speaks its first sentence while the rest is still coming; a question that needs real work is handed to the CEO in
// the background, as before. Which key and model, the prompt, the stream's parsing and its sentences are pure here;
// the HTTP call is the VoiceApi's chatStream (the demo fakes it).

/** An OpenAI-style chat endpoint and model for the fast answers. */
export interface FastModel {
  provider: string;
  url: string;
  key: string;
  model: string;
}

/** The fast models, fastest first: low-latency hosts of open models, then OpenAI's and OpenRouter's small models (no reasoning: the first word matters). */
const FAST: { provider: string; url: string; model: string }[] = [
  { provider: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
  { provider: 'cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', model: 'llama3.1-8b' },
  { provider: 'openai', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini' },
  { provider: 'openrouter', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4.1-mini' },
];

/** The first provider with a key, or null (the call then hands every open question to the CEO, as before). */
export function fastModel(keyFor: (provider: string) => string | undefined): FastModel | null {
  for (const f of FAST) {
    const key = keyFor(f.provider);
    if (key) return { ...f, key };
  }
  return null;
}

/** What the fast model answers with when the question needs the CEO. */
const HANDOFF = 'HANDOFF';

/** The system prompt: the office's facts, short spoken answers, and HANDOFF for real work. */
export function fastPrompt(ceoName: string, facts: string): string {
  return [
    `You are ${ceoName}, the CEO of a software office, answering the manager on a phone call.`,
    'Answer in one or two short spoken sentences, plain words, no lists, no markdown.',
    'Use only these facts about the office; never invent numbers or names.',
    `If the question needs work, research, code, a change, or facts not given here, reply with exactly ${HANDOFF}.`,
    `Facts: ${facts}`,
  ].join('\n');
}

/** The content pieces in one chunk of an OpenAI-style server-sent event stream; `rest` is the unfinished line to keep. */
export function sseDeltas(buffered: string): { pieces: string[]; rest: string; done: boolean } {
  const lines = buffered.split('\n');
  const rest = lines.pop() ?? '';
  const pieces: string[] = [];
  let done = false;
  for (const l of lines) {
    const m = /^data:\s*(.*)$/.exec(l.trim());
    if (!m) continue;
    if (m[1] === '[DONE]') {
      done = true;
      continue;
    }
    try {
      const c = (JSON.parse(m[1]) as { choices?: { delta?: { content?: unknown } }[] }).choices?.[0]?.delta?.content;
      if (typeof c === 'string' && c) pieces.push(c);
    } catch {
      // a keep-alive or a broken line
    }
  }
  return { pieces, rest, done };
}

/** A sentence's end: . ! ? … then a space (or a comma after a few words, as ElevenLabs speaks from there too); never "3." of "3.5". */
const SENTENCE = /^(.*?[.!?…]\s|.{24,}?,\s)/s;

/**
 * The model's tokens as spoken pieces: each sentence the moment it's complete (the first long before the model is
 * done), the rest at the end. Returns 'handoff' (nothing said) when the model hands the question to the CEO.
 */
export async function* fastSentences(tokens: AsyncIterable<string>): AsyncGenerator<string, 'handoff' | 'done'> {
  let buf = '';
  let said = false;
  for await (const t of tokens) {
    buf += t;
    if (!said) {
      const head = buf.trimStart();
      if (head.startsWith(HANDOFF)) return 'handoff';
      if (HANDOFF.startsWith(head)) continue; // could still be HANDOFF
    }
    for (let m = SENTENCE.exec(buf); m; m = SENTENCE.exec(buf)) {
      said = true;
      buf = buf.slice(m[0].length);
      yield m[0];
    }
  }
  const last = buf.trim();
  if (!said && (!last || last.startsWith(HANDOFF))) return 'handoff';
  if (last) yield buf;
  return 'done';
}

/** The request body for a streamed fast answer. */
function fastBody(model: string, system: string, history: { role: 'user' | 'assistant'; content: string }[]) {
  return { model, stream: true, temperature: 0.3, max_tokens: 160, messages: [{ role: 'system', content: system }, ...history.slice(-8)] };
}

/** Streams an OpenAI-style chat completion's content (the real VoiceApi.chatStream). */
export async function* streamChat(m: FastModel, history: { role: 'user' | 'assistant'; content: string }[], system: string, signal: AbortSignal): AsyncGenerator<string> {
  const res = await fetch(m.url, { method: 'POST', headers: { Authorization: `Bearer ${m.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(fastBody(m.model, system, history)), signal });
  if (!res.ok || !res.body) throw new Error(`${m.provider} answered ${res.status}`);
  const dec = new TextDecoder();
  let rest = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    const d = sseDeltas(rest + dec.decode(chunk, { stream: true }));
    rest = d.rest;
    yield* d.pieces;
    if (d.done) return;
  }
}
