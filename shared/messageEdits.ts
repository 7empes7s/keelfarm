// Message edits (#125), their pure rules for the server and both chats (the CEO's, and agents'): the versions a
// message keeps, the word diff between two of them, how each side's edit looks, how the manager's edit reaches whoever
// it was for, and when a message gets the Versions sheet.

import type { MessageVersion, PhoneMessage } from './types.ts';
import { excerpt } from './chat.ts';

/** The most versions a message keeps, its current text included: the oldest earlier ones go first. */
export const MESSAGE_VERSIONS_MAX = 10;

/** Shorter messages (in characters, every version) show their edit inline only, without the Versions sheet. */
const VERSIONS_SHEET_CHARS = 140;

/** How much of each side an edit note quotes. */
const NOTE_CHARS = 300;

/** A message's text replaced by `text` at `now`: the text it had joins its versions (capped). Null when nothing changed. */
export function applyEdit(m: Pick<PhoneMessage, 'text' | 'at' | 'edited' | 'versions'>, text: string, now: number, reason?: string): Pick<PhoneMessage, 'text' | 'edited' | 'versions'> | null {
  if (text === m.text) return null;
  const old: MessageVersion = { text: m.text, at: m.edited ?? m.at, ...(reason && { reason: reason.slice(0, 200) }) };
  const versions = [...(m.versions ?? []), old].slice(-(MESSAGE_VERSIONS_MAX - 1));
  return { text, edited: now, versions };
}

/** Every version of a message, oldest first, the current one last. */
export function allVersions(m: Pick<PhoneMessage, 'text' | 'at' | 'edited' | 'versions'>): MessageVersion[] {
  return [...(m.versions ?? []), { text: m.text, at: m.edited ?? m.at }];
}

/**
 * How an edited message shows: the manager's own just shows the new text ('replace'); the CEO's and agents' show their
 * old words struck through next to the new ones ('diff'), so the manager sees what changed in what they were told.
 */
export function editLook(from: PhoneMessage['from'] | 'agent'): 'replace' | 'diff' {
  return from === 'manager' ? 'replace' : 'diff';
}

/** Whether a message offers the Versions sheet: it was edited, and it's longer than an inline diff reads well. */
export function hasVersionsSheet(m: Pick<PhoneMessage, 'text' | 'versions'>): boolean {
  return !!m.versions?.length && [m.text, ...m.versions.map((v) => v.text)].some((t) => t.length > VERSIONS_SHEET_CHARS);
}

// ---------- the word diff ----------

export type DiffPart = { op: 'same' | 'del' | 'add'; text: string };

/** Past this many words on a side, the diff is the whole old text struck and the whole new text (no quadratic table). */
const DIFF_TOKENS_MAX = 2500;

const tokens = (s: string) => s.split(/(\s+)/).filter(Boolean);

/** The word-level diff from `a` to `b` (a longest common subsequence of words and the spaces between), runs merged. */
export function wordDiff(a: string, b: string): DiffPart[] {
  const x = tokens(a);
  const y = tokens(b);
  const out: DiffPart[] = [];
  const push = (op: DiffPart['op'], text: string) => {
    const last = out[out.length - 1];
    if (last?.op === op) last.text += text;
    else out.push({ op, text });
  };
  if (x.length > DIFF_TOKENS_MAX || y.length > DIFF_TOKENS_MAX) {
    if (a) push('del', a);
    if (b) push('add', b);
    return out;
  }
  // lcs[i][j]: the common length of x[i..] and y[j..], in one flat table.
  const w = y.length + 1;
  const lcs = new Uint16Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push('same', x[i]);
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) push('del', x[i++]);
    else push('add', y[j++]);
  }
  while (i < x.length) push('del', x[i++]);
  while (j < y.length) push('add', y[j++]);
  return out;
}

/** Markdown's own punctuation, escaped so a struck word shows as written. */
const escapeMd = (t: string) => t.replace(/[\\`*_{}[\]()#+\-.!|~<>]/g, '\\$&');

/**
 * The new text as Markdown with the old words struck through before the words that replaced them (`~~old~~ new`):
 * kept and added text stay as written, so the reply's formatting survives; deleted spacing is dropped.
 */
export function diffMarkdown(parts: readonly DiffPart[]): string {
  let out = '';
  for (const p of parts) {
    if (p.op !== 'del') {
      out += p.text;
      continue;
    }
    const words = p.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    if (out && !/\s$/.test(out)) out += ' ';
    out += `${words.map((t) => `~~${escapeMd(t)}~~`).join(' ')} `;
  }
  return out;
}

/** What a bubble shows for an edited message that shows its changes (editLook): the last edit, struck through, as Markdown. Null for any other. */
export function struckText(m: Pick<PhoneMessage, 'text' | 'versions'>, from: PhoneMessage['from'] | 'agent'): string | null {
  const before = m.versions?.at(-1);
  return before && editLook(from) === 'diff' ? diffMarkdown(wordDiff(before.text, m.text)) : null;
}

// ---------- the manager's edits ----------

/**
 * How the manager's edit reaches the CEO (or an agent): still queued, the job just carries the new text; their last
 * message, already taken, is asked again; an earlier one, already worked on or answered, comes as a note (editNote).
 */
export function editDelivery(o: { queued: boolean; last: boolean }): 'queued' | 'reask' | 'note' {
  return o.queued ? 'queued' : o.last ? 'reask' : 'note';
}

/** The note the CEO (or an agent) gets for the manager's edit of a message they already took. */
export function editNote(id: number, before: string, after: string): string {
  return `[manager edited message #${id}: "${excerpt(before, NOTE_CHARS)}" → "${excerpt(after, NOTE_CHARS)}"]`;
}
