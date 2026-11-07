// The CEO's suggestion boxes, idea cards and artifacts: fenced blocks in their final message that the office lifts out
// of the bubble's text when it posts it (```suggestions, one option per line; ```idea <kind>, a title line then the
// message Accept sends; ```artifact title="…", markdown; ```chart / ```table / ```dashboard, JSON: shared/chatVisuals.ts). A block that breaks the rules stays in the text as written,
// so nothing the CEO wrote is ever lost.

import { cleanTerminalText } from './terminalText.ts';
import type { ChatArtifact, ChatIdea, PhoneMessage } from './types.ts';
import { MAX_VISUALS, parseVisual, visualKind, type ChatVisual } from './chatVisuals.ts';

export const MAX_SUGGESTIONS = 4;
export const SUGGESTION_CHARS = 60;
const ASK_CHARS = 200;
export const MAX_ARTIFACTS = 3;
/** An artifact's markdown, at most (characters). A longer one stays in the text. */
export const ARTIFACT_CHARS = 20_000;
export const ARTIFACT_TITLE_CHARS = 80;
const IDEA_KINDS: readonly ChatIdea['kind'][] = ['objective', 'focus', 'mandate', 'experiment', 'research', 'charter', 'team', 'plan'];
const IDEA_TITLE_CHARS = 100;
const IDEA_MESSAGE_CHARS = 400;
/** How much artifact markdown the snapshot carries, newest first; older bodies are fetched when opened. */
export const SNAPSHOT_ARTIFACT_CHARS = 60_000;

export interface ParsedMessage {
  text: string;
  suggestions?: string[];
  ask?: string;
  idea?: ChatIdea;
  artifacts?: { title: string; markdown: string }[];
  visuals?: ChatVisual[];
}

const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*(.*)$/;

/** The fence closing `open` (same character, at least as long, no info string) from line `from`, skipping nested fences that carry a language. */
function closing(lines: string[], from: number, open: string, nestable: boolean): number {
  let depth = 0;
  for (let i = from; i < lines.length; i++) {
    const f = lines[i].match(FENCE);
    if (!f || f[2][0] !== open[0]) continue;
    if (f[3]) {
      if (nestable) depth++;
      continue;
    }
    if (depth > 0) depth--;
    else if (f[2].length >= open.length) return i;
  }
  return -1;
}

/** A suggestions block's options, and its question when its first line is `? <question>` (#183). */
function suggestionsOf(body: string[]): { options: string[]; ask?: string } | null {
  const out = body.map((l) => l.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
  const ask = out[0]?.startsWith('?') ? out.shift()!.slice(1).trim() : '';
  if (!out.length || out.length > MAX_SUGGESTIONS || out.some((s) => s.length > SUGGESTION_CHARS) || ask.length > ASK_CHARS) return null;
  return { options: out, ...(ask && { ask }) };
}

/** An ```idea block: a known kind, a title line, and optionally the message Accept sends (else the title). */
function ideaOf(info: string, body: string[]): ChatIdea | null {
  const kind = info.match(/^idea\s+(\w+)$/i)?.[1].toLowerCase() as ChatIdea['kind'] | undefined;
  const [title = '', ...rest] = body.map((l) => l.trim()).filter(Boolean);
  const message = rest.join(' ') || title;
  if (!kind || !IDEA_KINDS.includes(kind) || !title || title.length > IDEA_TITLE_CHARS || message.length > IDEA_MESSAGE_CHARS) return null;
  return { kind, title, message };
}

function artifactOf(info: string, body: string[]): { title: string; markdown: string } | null {
  const t = info.match(/^artifact\s+title\s*=\s*(?:"([^"]*)"|'([^']*)'|“([^”]*)”)\s*$/i);
  const title = (t?.[1] ?? t?.[2] ?? t?.[3] ?? '').trim();
  const markdown = body.join('\n').replace(/^\s*\n|\s+$/g, '');
  if (!title || !markdown || markdown.length > ARTIFACT_CHARS) return null;
  return { title: title.length > ARTIFACT_TITLE_CHARS ? `${title.slice(0, ARTIFACT_TITLE_CHARS - 1).trimEnd()}…` : title, markdown };
}

/**
 * A new message's parts: the CEO's blocks lifted out (parseCeoMessage); the office's notes, which may quote a tool's
 * output, without colour codes or unbreakable rules (#138); the manager's as written.
 */
export function parseMessage(from: PhoneMessage['from'], raw: string): ParsedMessage {
  if (from === 'ceo') return parseCeoMessage(raw);
  return { text: from === 'office' ? officeText(raw) : raw };
}

/** An office note as the chat shows it: also run when one renders, so notes stored before #138 come out clean too. */
export const officeText = (raw: string) => cleanTerminalText(raw, 6000);

/** Lifts the suggestion, idea, artifact and visual blocks out of a CEO message. A message without valid ones comes back as it was. */
export function parseCeoMessage(raw: string): ParsedMessage {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const keep: string[] = [];
  let suggestions: string[] | undefined;
  let ask: string | undefined;
  let idea: ChatIdea | undefined;
  const artifacts: { title: string; markdown: string }[] = [];
  const visuals: ChatVisual[] = [];
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(FENCE);
    if (!f) {
      keep.push(lines[i]);
      continue;
    }
    const info = f[3].trim();
    const kind = /^suggestions$/i.test(info) ? 'suggestions' : /^artifact\b/i.test(info) ? 'artifact' : /^idea\b/i.test(info) ? 'idea' : null;
    const end = closing(lines, i + 1, f[2], kind === 'artifact');
    if (end < 0) {
      // unclosed: everything from here is text, as written
      keep.push(...lines.slice(i));
      break;
    }
    const body = lines.slice(i + 1, end);
    const s = kind === 'suggestions' && !suggestions ? suggestionsOf(body) : null;
    const a = kind === 'artifact' && artifacts.length < MAX_ARTIFACTS ? artifactOf(info, body) : null;
    const d = kind === 'idea' && !idea ? ideaOf(info, body) : null;
    const vk = visualKind(info);
    const v = vk && visuals.length < MAX_VISUALS ? parseVisual(vk, body.join('\n')) : null;
    if (s) ({ options: suggestions, ask } = s);
    else if (a) artifacts.push(a);
    else if (d) idea = d;
    else if (v) visuals.push(v);
    else keep.push(...lines.slice(i, end + 1));
    i = end;
  }
  if (!suggestions && !idea && !artifacts.length && !visuals.length) return { text: raw };
  const text = keep.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, ...(suggestions && { suggestions }), ...(ask && { ask }), ...(idea && { idea }), ...(artifacts.length && { artifacts }), ...(visuals.length && { visuals }) };
}

/** An artifact's first line as plain words, for its card. */
export function artifactLead(markdown: string, max = 120): string {
  for (const line of markdown.split('\n')) {
    const t = line
      .replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/, '')
      .replace(/[*_`~]/g, '')
      .replace(/\s*\|\s*/g, ' · ')
      .replace(/^ · | · $/g, '')
      .trim();
    if (!t || /^[\s:·-]+$/.test(t) || /^`{3,}|~{3,}/.test(line.trim())) continue;
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  }
  return '';
}

/** The artifacts a message keeps: ids `<message id>-<n>`, their card's first line, and the body. */
export function makeArtifacts(messageId: number, parsed: ParsedMessage['artifacts']): ChatArtifact[] | undefined {
  return parsed?.map((a, i) => ({ id: `${messageId}-${i + 1}`, title: a.title, lead: artifactLead(a.markdown), markdown: a.markdown }));
}

/** The messages for a snapshot: the newest artifacts keep their markdown up to `budget` characters, older ones only their card. */
export function snapshotMessages(messages: readonly PhoneMessage[], budget = SNAPSHOT_ARTIFACT_CHARS): PhoneMessage[] {
  let left = budget;
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (!m.artifacts?.length) continue;
    const artifacts = m.artifacts.map((a) => {
      const size = a.markdown?.length ?? 0;
      if (size <= left) {
        left -= size;
        return a;
      }
      left = 0;
      return { id: a.id, title: a.title, lead: a.lead };
    });
    out[i] = { ...m, artifacts };
  }
  return out;
}

/** The CEO message whose suggestions the phone shows: their latest, while nobody has answered it. */
export function suggestionsFor(messages: readonly PhoneMessage[]): PhoneMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.from === 'manager') return null;
    if (m.from === 'ceo') return m.suggestions?.length && !m.requestId ? m : null;
  }
  return null;
}

/** A markdown file name for an artifact's download. */
export function artifactFileName(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'artifact'}.md`;
}
