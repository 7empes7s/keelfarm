// The CEO's NOTES.md as the memory sheet shows it (#417), pure: its `#`–`###` sections as cards (title, item count,
// last date, ARCHIVE folded), the search that narrows them to matching items, and each section's Markdown with its
// lead-ins ("msg 1855 (2026-11-08):"), `#123`, `file.ts:42` and "Why:" / "How to apply:" turned into chips.

import { floorAt, githubUrl, type FloorRef } from './chatLinks';

export interface NoteSection {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  /** The `##` it sits under, for a `###`. */
  parent?: string;
  /** The Markdown under the heading, up to the next `#`–`###`. */
  body: string;
  /** Its top-level list items, else its paragraphs. */
  count: number;
  /** The latest YYYY-MM-DD in it. */
  updated: string | null;
  /** ARCHIVE, or under it: folded until opened or searched. */
  archived: boolean;
}

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const ITEM = /^(?:[-*+]|\d+[.)])\s/;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const ARCHIVE = /\barchived?\b/i;

/** Each line with whether it's inside a fenced code block (headings and lead-ins there are code). */
function fenced(lines: string[]): boolean[] {
  let open = false;
  return lines.map((l) => {
    if (FENCE.test(l)) {
      open = !open;
      return true;
    }
    return open;
  });
}

/** Top-level blocks: each list item with its indented lines, or each paragraph. */
function blocks(body: string): string[] {
  const lines = body.split('\n');
  const code = fenced(lines);
  const out: string[] = [];
  let cur: string[] = [];
  let inList = false;
  const flush = () => {
    if (cur.some((l) => l.trim())) out.push(cur.join('\n').trim());
    cur = [];
  };
  lines.forEach((l, i) => {
    if (!code[i] && ITEM.test(l)) {
      flush();
      inList = true;
    } else if (!code[i] && !l.trim()) {
      if (!inList) flush();
    } else if (!code[i] && inList && !/^\s/.test(l)) {
      flush();
      inList = false;
    }
    cur.push(l);
  });
  flush();
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'notes';

/** NOTES.md in sections. A lone `#` title with nothing under it is dropped (the sheet has its own). */
export function noteSections(text: string): NoteSection[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const code = fenced(lines);
  const raw: { title: string; level: 1 | 2 | 3; lines: string[] }[] = [{ title: 'Notes', level: 1, lines: [] }];
  lines.forEach((l, i) => {
    const h = code[i] ? null : l.match(HEADING);
    if (h) raw.push({ title: h[2].replace(/\*\*/g, ''), level: h[1].length as 1 | 2 | 3, lines: [] });
    else raw[raw.length - 1].lines.push(l);
  });
  const ids = new Set<string>();
  let parent: { title: string; archived: boolean } | undefined;
  const out: NoteSection[] = [];
  for (const s of raw) {
    const body = s.lines.join('\n').trim();
    if (s.level < 3) parent = s.level === 2 ? { title: s.title, archived: ARCHIVE.test(s.title) } : undefined;
    if (s.level === 1 && !body) continue;
    const under = s.level === 3 ? parent : undefined;
    let id = slug(s.title);
    for (let n = 2; ids.has(id); n++) id = `${slug(s.title)}-${n}`;
    ids.add(id);
    const items = body.split('\n').filter((l) => ITEM.test(l)).length;
    const dates = `${s.title}\n${body}`.match(DATE) ?? [];
    out.push({
      id,
      title: s.title,
      level: s.level,
      ...(under && { parent: under.title }),
      body,
      count: items || blocks(body).length,
      updated: dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null,
      archived: ARCHIVE.test(s.title) || !!under?.archived,
    });
  }
  return out;
}

/** The sections holding every word of `q` (any case): a matching title keeps its section whole, else only its matching items. */
export function searchSections(sections: readonly NoteSection[], q: string): NoteSection[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...sections];
  const has = (s: string) => words.every((w) => s.toLowerCase().includes(w));
  return sections.flatMap((s) => {
    if (has(s.title)) return [s];
    const kept = blocks(s.body).filter(has);
    return kept.length ? [{ ...s, body: kept.join('\n\n'), count: kept.length }] : [];
  });
}

// ---------- chips ----------

export type NoteChip =
  | { kind: 'lead'; msg?: number; date?: string }
  | { kind: 'issue'; number: number; url?: string }
  | { kind: 'file'; path: string; line: number }
  | { kind: 'label'; text: string };

const BULLET = /^(\s*(?:(?:[-*+]|\d+[.)])\s+)?)/;
const LEAD_BOLD = /^\*\*([^*\n]+?):?\*\*:?\s*/;
const LEAD_PLAIN = /^(msg\s*#?\d+(?:\s*\(\d{4}-\d{2}-\d{2}\))?|\d{4}-\d{2}-\d{2}(?:\s*\(?msg\s*#?\d+\)?)?):\s*/i;
const LABEL = /^(?:\*\*)?(Why|How to apply)(?::\*\*|\*\*:|:)\s*/i;
// Left as they are: code, Markdown links, autolinks and URLs.
const SKIP = /(`[^`\n]*`|!?\[[^\]]*\]\([^)]*\)|<https?:[^>]*>|https?:\/\/[^\s<>]+)/;
const INLINE = /(^|[^\w&#/[\]])#(\d+)\b|(^|[\s(])((?:[\w.-]+\/)*[\w.-]*[\w-]\.[A-Za-z]\w{0,5}):(\d{1,6})\b/g;

/** A bold or plain lead-in that is only a message number and/or a date, as a chip. */
function leadChip(inner: string): NoteChip | null {
  const msg = inner.match(/\bmsg\s*#?(\d+)/i)?.[1];
  const date = inner.match(DATE)?.[0];
  if (!msg && !date) return null;
  if (inner.replace(/\bmsg\s*#?\d+/i, '').replace(DATE, '').replace(/[\s()[\],·:—–-]/g, '')) return null;
  return { kind: 'lead', ...(msg && { msg: Number(msg) }), ...(date && { date }) };
}

/**
 * A section's Markdown with its chips as `cubefarm:ref/<i>` links into `chips` (rendered by Markdown's renderRef).
 * `#N` goes to the floor the section names (shared rule: chatLinks' floorAt), else the lowest floor.
 */
export function noteChips(section: Pick<NoteSection, 'title' | 'body'>, floors: readonly FloorRef[]): { md: string; chips: NoteChip[] } {
  const chips: NoteChip[] = [];
  const ref = (chip: NoteChip, label: string) => `[${label.replace(/[[\]]/g, '')}](cubefarm:ref/${chips.push(chip) - 1})`;
  const context = `${section.title}\n${section.body}`;
  let offset = section.title.length + 1;
  const lines = section.body.split('\n');
  const code = fenced(lines);
  const out = lines.map((line, i) => {
    const at = offset;
    offset += line.length + 1;
    if (code[i]) return line;
    const lead = line.match(BULLET)![1];
    let rest = line.slice(lead.length);
    let head = '';
    const m = rest.match(LEAD_BOLD) ?? rest.match(LEAD_PLAIN);
    const chip = m && leadChip(m[1]);
    const label = rest.match(LABEL);
    if (m && chip) {
      head = `${ref(chip, m[1])} `;
      rest = rest.slice(m[0].length);
    } else if (label) {
      const text = label[1][0].toUpperCase() + label[1].slice(1).toLowerCase();
      head = `${ref({ kind: 'label', text }, text)} `;
      rest = rest.slice(label[0].length);
    }
    let pos = at + line.length - rest.length;
    const body = rest
      .split(SKIP)
      .map((seg, j) => {
        const segAt = pos;
        pos += seg.length;
        if (j % 2) return seg;
        return seg.replace(INLINE, (_all, pre: string | undefined, num: string | undefined, fpre: string | undefined, path: string | undefined, ln: string | undefined, idx: number) => {
          if (num) {
            const f = floors.length ? floorAt(context, segAt + idx, floors) : undefined;
            return `${pre}${ref({ kind: 'issue', number: Number(num), ...(f && { url: githubUrl(f, Number(num)) }) }, `#${num}`)}`;
          }
          return `${fpre}${ref({ kind: 'file', path: path!, line: Number(ln) }, `${path}:${ln}`)}`;
        });
      })
      .join('');
    return lead + head + body;
  });
  return { md: out.join('\n'), chips };
}
