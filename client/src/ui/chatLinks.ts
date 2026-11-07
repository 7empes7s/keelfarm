// Links in the phone chat, pure: the CEO's `#123` become links to that floor's issue or pull request on GitHub,
// "floor 3" becomes a chip that opens the floor, and plain URLs in the manager's own texts become clickable.

/** A floor as the chat links to it. */
export interface FloorRef {
  floor: number;
  fullName: string; // owner/repo
  prs?: readonly number[]; // its pull requests' numbers, so #N links to /pull/N rather than /issues/N
}

/** The href of a floor chip (ui/Markdown.tsx renders it as a button, never as a link); `repo`: its name, shown inline. */
export const floorHref = (floor: number, repo?: string) => `cubefarm:floor/${floor}${repo ? `/${repo}` : ''}`;
export const FLOOR_HREF = /^cubefarm:floor\/(\d+)(?:\/([\w.-]+))?$/;

// "floor 3 (`keelfarm`)", "floor 3 [keelfarm]", "floor 3 `keelfarm`": the floor's own repo name right after it joins
// its chip (#150), so it reads as one line instead of a chip and a code pill.
const FLOOR_REPO = /\bfloor\s+(\d+)\s*(?:\(\s*`?([\w.-]+)`?\s*\)|\[\s*`?([\w.-]+)`?\s*\](?!\()|`([\w.-]+)`)/gi;

function withRepos(seg: string, floors: readonly FloorRef[]): string {
  return seg.replace(FLOOR_REPO, (all, n: string, a?: string, b?: string, c?: string) => {
    const repo = a ?? b ?? c;
    const f = floors.find((x) => x.floor === Number(n));
    return f && repo && f.fullName.split('/').pop()?.toLowerCase() === repo.toLowerCase() ? `[floor ${n}](${floorHref(Number(n), repo)})` : all;
  });
}

const FLOOR_WORD = /\bfloor\s+(\d+)\b/gi;

/** Which floor `#N` at `index` means: the nearest "floor N" before it, else the first one the message names, else the lowest floor. */
export function floorAt(text: string, index: number, floors: readonly FloorRef[]): FloorRef | undefined {
  const known = (n: number) => floors.find((f) => f.floor === n);
  let before: FloorRef | undefined;
  let first: FloorRef | undefined;
  for (const m of text.matchAll(FLOOR_WORD)) {
    const f = known(Number(m[1]));
    if (!f) continue;
    first ??= f;
    if (m.index < index) before = f;
  }
  return before ?? first ?? [...floors].sort((a, b) => a.floor - b.floor)[0];
}

/** GitHub's page for issue or pull request `n` on a floor. */
export const githubUrl = (f: FloorRef, n: number) => `https://github.com/${f.fullName}/${f.prs?.includes(n) ? 'pull' : 'issues'}/${n}`;

// Things left as they are: existing links, autolinks and bare URLs. Then the floor names and the #N to link.
const TOKENS = /(!?\[[^\]]*\]\([^)]*\)|<https?:[^>]*>|https?:\/\/[^\s<>]+)|\b(floor\s+(\d+))\b|(^|[^\w&#/[\]])#(\d+)\b/gi;

function linkSegment(seg: string, whole: string, offset: number, floors: readonly FloorRef[]): string {
  return seg.replace(TOKENS, (all, keep: string | undefined, word: string | undefined, n: string | undefined, pre: string | undefined, num: string | undefined, at: number) => {
    if (keep) return all;
    if (word) return floors.some((f) => f.floor === Number(n)) ? `[${word}](${floorHref(Number(n))})` : all;
    const f = floorAt(whole, offset + at + (pre?.length ?? 0), floors);
    return f ? `${pre}[#${num}](${githubUrl(f, Number(num))})` : all;
  });
}

/** The CEO's Markdown with its `#N` linked to GitHub and its floor names as chips. Code (fenced or inline) is left alone. */
export function linkCeoText(raw: string, floors: readonly FloorRef[]): string {
  if (!floors.length) return raw;
  const md = raw
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((p, i) => (i % 2 ? p : withRepos(p, floors)))
    .join('');
  // Odd parts are code: fenced blocks first, then inline spans.
  const parts = md.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
  let offset = 0;
  return parts
    .map((p, i) => {
      const out = i % 2 ? p : linkSegment(p, md, offset, floors);
      offset += p.length;
      return out;
    })
    .join('');
}

/** The manager's plain text split into text and URLs, for clickable links (http and https only). */
export function urlParts(text: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>]+/g)) {
    const url = m[0].replace(/[.,;:!?)\]'"»]+$/, '');
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: url, url });
    last = m.index + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
