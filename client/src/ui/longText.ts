// When a chat message is long enough to fold behind "Show more" (#51), and where it folds (#339). Pure.

import { COLLAPSE_LINES } from './codeBlock';

const LONG_CHARS = 1400;
const LONG_LINES = 24;

export const isLong = (text: string) => text.length > LONG_CHARS || text.split('\n').length > LONG_LINES;

/** About a phone's line of chat text, in characters. */
const ROW_CHARS = 45;
/** The folded view's height in rows; a message with commands to paste shows more. */
const FOLD_ROWS = 12;
const FOLD_ROWS_CODE = 30;
/** Not worth a fold: this many rows or fewer left to hide. */
const TAIL_ROWS = 3;

interface Block {
  text: string;
  /** The line after its last, in the message. */
  end: number;
  kind: 'code' | 'table' | 'text';
}

/** A Markdown link's target, which doesn't show (the chat's floor and ref links add them). */
const TARGET = /\]\([^)]*\)/g;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** The message's top-level Markdown blocks: fenced code whole, else runs of lines between blank lines. */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  let run: string[] = [];
  const flush = (end: number) => {
    if (run.length) out.push({ text: run.join('\n'), end, kind: run.every((l) => l.trimStart().startsWith('|')) ? 'table' : 'text' });
    run = [];
  };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE)?.[1];
    if (open) {
      flush(i);
      let j = i + 1;
      while (j < lines.length && !(lines[j].match(FENCE)?.[1] ?? '').startsWith(open)) j++;
      out.push({ text: lines.slice(i, j + 1).join('\n'), end: Math.min(j + 1, lines.length), kind: 'code' });
      i = j;
    } else if (!lines[i].trim()) flush(i);
    else run.push(lines[i]);
  }
  flush(lines.length);
  return out;
}

/** Rows a block takes on a phone: wrapped prose (link targets don't show), or a code card up to its own fold. */
function rows(b: Block): number {
  const lines = b.text.split('\n');
  if (b.kind === 'code') return Math.min(lines.length - 2, COLLAPSE_LINES) + 2;
  return lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.replace(TARGET, ']').length / ROW_CHARS)), 0) + 1;
}

const plural = (n: number, one: string) => `${n} more ${one}${n === 1 ? '' : 's'}`;

export interface Fold {
  /** The whole blocks shown while folded, as Markdown; null: one long run of prose, folded by height as before. */
  shown: string | null;
  /** "Show more · 2 more code blocks": what the fold hides. */
  more: string;
}

/**
 * Where a long message folds: after the last whole block that fits, never inside a code block or table. A code block
 * that starts within the fold is shown whole (its own fold takes over past 12 lines), and a message with code keeps
 * at least its first code block in view. Null when nothing (or only a line or two) would be hidden.
 * Prose with no code whose first block alone is far over the fold is cut by height instead.
 */
export function foldText(text: string): Fold | null {
  if (!isLong(text.replace(TARGET, ']'))) return null;
  const all = blocks(text);
  const firstCode = all.findIndex((b) => b.kind === 'code');
  const budget = firstCode < 0 ? FOLD_ROWS : FOLD_ROWS_CODE;
  let used = 0;
  let end = 0;
  for (; end < all.length; end++) {
    const r = rows(all[end]);
    // a code block is shown whole if it starts within the fold; the first one always is
    const over = all[end].kind === 'code' ? used >= budget : used + r > budget;
    if (over && end > 0 && end > firstCode) break;
    used += r;
  }
  if (firstCode < 0 && used > 2 * budget) return { shown: null, more: 'Show more' };
  const hidden = all.slice(end);
  if (hidden.reduce((n, b) => n + rows(b), 0) <= TAIL_ROWS) return null;
  const code = hidden.filter((b) => b.kind === 'code').length;
  const tables = hidden.filter((b) => b.kind === 'table').length;
  const parts = [code && plural(code, 'code block'), tables && plural(tables, 'table')].filter(Boolean);
  return { shown: text.split('\n').slice(0, all[end - 1].end).join('\n'), more: ['Show more', ...parts].join(' · ') };
}
