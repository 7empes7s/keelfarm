// The CEO's suggestion boxes and artifacts: fenced blocks in their final message that the office lifts out of the
// bubble's text when it posts it (```suggestions, one option per line; ```artifact title="…", markdown). A block that
// breaks the rules stays in the text as written, so nothing the CEO wrote is ever lost.

import type { ChatArtifact, PhoneMessage } from './types.ts';

export const MAX_SUGGESTIONS = 4;
export const SUGGESTION_CHARS = 60;
export const MAX_ARTIFACTS = 3;
/** An artifact's markdown, at most (characters). A longer one stays in the text. */
export const ARTIFACT_CHARS = 20_000;
export const ARTIFACT_TITLE_CHARS = 80;
/** How much artifact markdown the snapshot carries, newest first; older bodies are fetched when opened. */
export const SNAPSHOT_ARTIFACT_CHARS = 60_000;

export interface ParsedMessage {
  text: string;
  suggestions?: string[];
  artifacts?: { title: string; markdown: string }[];
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

function suggestionsOf(body: string[]): string[] | null {
  const out = body.map((l) => l.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
  if (!out.length || out.length > MAX_SUGGESTIONS || out.some((s) => s.length > SUGGESTION_CHARS)) return null;
  return out;
}

function artifactOf(info: string, body: string[]): { title: string; markdown: string } | null {
  const t = info.match(/^artifact\s+title\s*=\s*(?:"([^"]*)"|'([^']*)'|“([^”]*)”)\s*$/i);
  const title = (t?.[1] ?? t?.[2] ?? t?.[3] ?? '').trim();
  const markdown = body.join('\n').replace(/^\s*\n|\s+$/g, '');
  if (!title || !markdown || markdown.length > ARTIFACT_CHARS) return null;
  return { title: title.length > ARTIFACT_TITLE_CHARS ? `${title.slice(0, ARTIFACT_TITLE_CHARS - 1).trimEnd()}…` : title, markdown };
}

/** Lifts the suggestion and artifact blocks out of a CEO message. A message without valid ones comes back as it was. */
export function parseCeoMessage(raw: string): ParsedMessage {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const keep: string[] = [];
  let suggestions: string[] | undefined;
  const artifacts: { title: string; markdown: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(FENCE);
    if (!f) {
      keep.push(lines[i]);
      continue;
    }
    const info = f[3].trim();
    const kind = /^suggestions$/i.test(info) ? 'suggestions' : /^artifact\b/i.test(info) ? 'artifact' : null;
    const end = closing(lines, i + 1, f[2], kind === 'artifact');
    if (end < 0) {
      // unclosed: everything from here is text, as written
      keep.push(...lines.slice(i));
      break;
    }
    const body = lines.slice(i + 1, end);
    const s = kind === 'suggestions' && !suggestions ? suggestionsOf(body) : null;
    const a = kind === 'artifact' && artifacts.length < MAX_ARTIFACTS ? artifactOf(info, body) : null;
    if (s) suggestions = s;
    else if (a) artifacts.push(a);
    else keep.push(...lines.slice(i, end + 1));
    i = end;
  }
  if (!suggestions && !artifacts.length) return { text: raw };
  const text = keep.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, ...(suggestions && { suggestions }), ...(artifacts.length && { artifacts }) };
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
