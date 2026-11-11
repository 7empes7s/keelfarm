// References in the phone chat (#26): what the CEO or the manager writes to point at something in the office
// (@Ada, @Ada/terminal, floor 2, floor 2 #13, file: floor 1 src/app.ts:42, qa: floor 3 #13, preview: floor 2),
// found when a message is posted and kept on it as spans of its text. The text stays as written, so it reads the same
// wherever refs don't render (Telegram, speech). Anything unknown stays plain text.

import type { ChatRef } from './types.ts';

const MAX_REFS = 40;

export interface RefContext {
  floors: readonly { floor: number; repoId: string }[];
  agents: readonly { id: string; name: string }[]; // who can be @named (not the CEO)
  /** The file is a plain file on the floor's main checkout: refs to missing ones stay text. */
  hasFile: (repoId: string, path: string) => boolean;
  /** Whether issue or PR `n` is on that floor's board, for a bare `#N` (#505). */
  hasNumber?: (repoId: string, n: number) => boolean;
  /** The floor the message is from (an agent's question): a bare `#N` means it there, unless a floor is named before it. */
  home?: string;
}

/** A repo-relative path as refs keep it (forward slashes), or null: absolute, climbing out, under .git or a .env file. */
export function cleanRefPath(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, '/');
  if (!p || p.includes('\0') || p.startsWith('/') || /^[a-z]:/i.test(p)) return null;
  const parts = p.split('/').filter((s) => s && s !== '.');
  if (!parts.length || parts.some((s) => s === '..' || s.toLowerCase() === '.git')) return null;
  if (parts.some((s) => /^\.env(\..*)?$/i.test(s) && !/\.(example|sample|template)$/i.test(s))) return null;
  return parts.join('/');
}

/** "src/a b.ts:42" → the path and its line. */
function pathAndLine(raw: string): { path: string; line?: number } | null {
  const m = raw.match(/^(.*?)(?::(\d{1,6}))?$/)!;
  const path = cleanRefPath(m[1]);
  const line = m[2] ? Number(m[2]) : undefined;
  return path ? { path, ...(line && { line }) } : null;
}

// Left alone: code (fenced and inline), Markdown links and URLs.
const SKIP = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|!?\[[^\]]*\]\([^)]*\)|<https?:[^>]*>|https?:\/\/[^\s<>]+/g;
const FLOOR_WORD = /\bfloor\s+(\d+)\b/gi;
const QA = /\bqa:\s*floor\s+(\d+)\s+#(\d+)\b/gi;
const PREVIEW = /\bpreview:\s*floor\s+(\d+)(?:\s+#(\d+)\b)?/gi;
const FILE = /\bfile:\s*floor\s+(\d+)\s+(?:`([^`\n]+)`|"([^"\n]+)"|([^\s`"]+))/gi;
const FLOOR_ISSUE = /\bfloor\s+(\d+)\s+#(\d+)\b/gi;
const ISSUE = /(^|[^\w&#/])#(\d+)\b/g;
type Target = ChatRef extends infer R ? (R extends ChatRef ? Omit<R, 'start' | 'end'> : never) : never;

/** The refs in `text`, in order and never overlapping. */
export function parseRefs(text: string, ctx: RefContext): ChatRef[] {
  const skip = [...text.matchAll(SKIP)].map((m) => [m.index, m.index + m[0].length] as const);
  const inSkip = (a: number, b = a + 1) => skip.some(([s, e]) => a < e && b > s);
  const repoOf = (n: string) => ctx.floors.find((f) => f.floor === Number(n))?.repoId;
  const found: ChatRef[] = [];
  const add = (start: number, end: number, t: Target | null, startOnly = false) => {
    if (!t || (startOnly ? inSkip(start) : inSkip(start, end)) || found.some((r) => start < r.end && end > r.start)) return;
    found.push({ start, end, ...t } as ChatRef);
  };

  // Prefixed refs first: a file's quoted path is code, so only where they start counts.
  for (const m of text.matchAll(QA)) {
    const repoId = repoOf(m[1]);
    add(m.index, m.index + m[0].length, repoId ? { kind: 'qa', repoId, number: Number(m[2]) } : null, true);
  }
  for (const m of text.matchAll(PREVIEW)) {
    const repoId = repoOf(m[1]);
    add(m.index, m.index + m[0].length, repoId ? { kind: 'preview', repoId, ...(m[2] && { number: Number(m[2]) }) } : null, true);
  }
  for (const m of text.matchAll(FILE)) {
    const repoId = repoOf(m[1]);
    const bare = m[4]?.replace(/[.,;:!?)\]'"»]+$/, '');
    const raw = m[2] ?? m[3] ?? bare ?? '';
    const at = pathAndLine(raw);
    const end = m.index + m[0].length - (m[4] ? m[4].length - bare!.length : 0);
    add(m.index, end, repoId && at && ctx.hasFile(repoId, at.path) ? { kind: 'file', repoId, ...at } : null, true);
  }
  for (const m of text.matchAll(FLOOR_ISSUE)) {
    const repoId = repoOf(m[1]);
    add(m.index, m.index + m[0].length, repoId ? { kind: 'issue', repoId, number: Number(m[2]) } : null);
  }

  // @Name: the longest known name there, not part of an email; two agents of that name make it nobody.
  const names = [...ctx.agents].sort((a, b) => b.name.length - a.name.length);
  for (let i = text.indexOf('@'); i >= 0; i = text.indexOf('@', i + 1)) {
    if (i > 0 && /[\w.]/.test(text[i - 1])) continue;
    const after = text.slice(i + 1);
    const hit = names.find((a) => a.name && after.slice(0, a.name.length).toLowerCase() === a.name.toLowerCase() && !/[\w-]/.test(after[a.name.length] ?? ''));
    if (!hit || names.filter((a) => a.name.toLowerCase() === hit.name.toLowerCase()).length > 1) continue;
    const terminal = /^\/terminal\b/i.test(after.slice(hit.name.length));
    add(i, i + 1 + hit.name.length + (terminal ? 9 : 0), { kind: 'agent', agentId: hit.id, ...(terminal && { terminal: true as const }) });
  }

  const mentions = [...text.matchAll(FLOOR_WORD)].filter((m) => !inSkip(m.index));
  for (const m of mentions) {
    const repoId = repoOf(m[1]);
    add(m.index, m.index + m[0].length, repoId ? { kind: 'floor', repoId } : null);
  }

  // #N on its own: the nearest floor named before it, else the sender's floor, else the first one the message names, else
  // the only floor. A guess that isn't on its board gives way to the floors whose boards have it (more than one: `alts`).
  for (const m of text.matchAll(ISSUE)) {
    const at = m.index + m[1].length;
    const n = Number(m[2]);
    const before = mentions.filter((f) => f.index < at).pop();
    const guess = before ? repoOf(before[1]) : (ctx.home ?? (mentions[0] ? repoOf(mentions[0][1]) : ctx.floors.length === 1 ? ctx.floors[0].repoId : undefined));
    const boards = !before && ctx.hasNumber ? ctx.floors.filter((f) => ctx.hasNumber!(f.repoId, n)).map((f) => f.repoId) : [];
    const onBoards = boards.length > 0 && !(guess && boards.includes(guess));
    const repoId = onBoards ? boards[0] : guess;
    const alts = onBoards ? boards.slice(1) : [];
    add(at, at + 1 + m[2].length, repoId ? { kind: 'issue', repoId, number: n, ...(alts.length && { alts }) } : null);
  }
  return found.sort((a, b) => a.start - b.start).slice(0, MAX_REFS);
}

/** The ref `text` is, whole (a table cell like "floor 3" or "#12"), or null when it is free text that only mentions one. */
export function soleRef(text: string, ctx: RefContext): ChatRef | null {
  const t = text.trim();
  const [ref, more] = parseRefs(t, ctx);
  return ref && !more && ref.start === 0 && ref.end === t.length ? ref : null;
}

/** Refs that fit `text` as given: in order, inside it, never overlapping (anything else is dropped). */
function validRefs(text: string, refs: readonly ChatRef[] | undefined): { ref: ChatRef; index: number }[] {
  const out: { ref: ChatRef; index: number }[] = [];
  let last = 0;
  refs?.forEach((ref, index) => {
    if (!(ref.start >= last && ref.end > ref.start && ref.end <= text.length)) return;
    out.push({ ref, index });
    last = ref.end;
  });
  return out;
}

/** The href a ref's chip has in the rendered Markdown (ui/Markdown.tsx renders it as a chip, never as a link). */
const refHref = (index: number) => `cubefarm:ref/${index}`;
export const REF_HREF = /^cubefarm:ref\/(\d+)$/;

/** The CEO's Markdown with each ref as a link to its chip; the label is the text as written, without backticks. */
export function refsMarkdown(text: string, refs: readonly ChatRef[] | undefined): string {
  let out = '';
  let last = 0;
  for (const { ref, index } of validRefs(text, refs)) {
    const label = text.slice(ref.start, ref.end).replace(/`/g, '').replace(/([\\[\]*_~])/g, '\\$1');
    out += `${text.slice(last, ref.start)}[${label}](${refHref(index)})`;
    last = ref.end;
  }
  return out + text.slice(last);
}

/** The manager's plain text cut into text and refs (by index), for their bubble. */
export function refParts(text: string, refs: readonly ChatRef[] | undefined): { text: string; ref?: number }[] {
  const out: { text: string; ref?: number }[] = [];
  let last = 0;
  for (const { ref, index } of validRefs(text, refs)) {
    if (ref.start > last) out.push({ text: text.slice(last, ref.start) });
    out.push({ text: text.slice(ref.start, ref.end), ref: index });
    last = ref.end;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** What a ref means, for the CEO: "agent ada-1", "o/r#13", "o/r:src/app.ts:42", "QA of o/r#13", "preview of o/r". */
function describeRef(r: ChatRef): string {
  if (r.kind === 'agent') return `${r.terminal ? 'the terminal of ' : ''}agent ${r.agentId}`;
  if (r.kind === 'floor') return r.repoId;
  if (r.kind === 'issue') return `${r.repoId}#${r.number}`;
  if (r.kind === 'file') return `${r.repoId}:${r.path}${r.line ? `:${r.line}` : ''}`;
  if (r.kind === 'qa') return `QA of ${r.repoId}#${r.number}`;
  return `preview of ${r.repoId}${r.number ? `#${r.number}` : ''}`;
}

/** The manager's refs spelled out for the CEO, one line ('' without any). */
export function refsLine(text: string, refs: readonly ChatRef[] | undefined): string {
  const list = validRefs(text, refs).map(({ ref }) => `${text.slice(ref.start, ref.end)} = ${describeRef(ref)}`);
  return list.length ? `(Refs: ${list.join('; ')})` : '';
}

/** A file on GitHub at its line: the viewer's "Open on GitHub". */
export const fileUrl = (fullName: string, branch: string, path: string, line?: number | null) =>
  `https://github.com/${fullName}/blob/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''}`;
