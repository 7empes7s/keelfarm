// The phone chat's refs (shared/chatRefs.ts) in the browser, pure: where a chip jumps to in the 3D office and in
// pocket mode, what it shows (icon and status, from the store's state), the "@" and "#" picks in the message box,
// and the lines a file preview shows, lightly highlighted. RefChips.tsx draws them.

import { CEO_ID, type AgentView, type ChatRef, type QaView, type RepoView } from '../../../shared/types';
import type { Overlay } from '../store';
import type { ActionRef } from '../../../shared/ceoActions';

export interface RefWorld {
  repos: readonly Pick<RepoView, 'id' | 'floor' | 'fullName' | 'pulls' | 'issues' | 'preview'>[];
  agents: Readonly<Record<string, Pick<AgentView, 'id' | 'name' | 'repoId' | 'status' | 'issueNumber' | 'prNumber'>>>;
  qa: Readonly<Record<string, Pick<QaView, 'status' | 'commentUrl'>>>;
}

/** Where a chip goes: a panel (in 3D, after riding to `floor`), a floor, the chat's file viewer, or GitHub. */
export type Jump =
  | { kind: 'overlay'; overlay: Overlay; floor?: number }
  | { kind: 'floor'; floor: number; repoId: string }
  | { kind: 'file' }
  | { kind: 'url'; url: string }
  | { kind: 'decisions' }; // the decision log under the approvals (#208)

const ghUrl = (fullName: string, n: number, pull: boolean) => `https://github.com/${fullName}/${pull ? 'pull' : 'issues'}/${n}`;

/** The jump for a ref, or null when what it names is gone (an agent who left, a floor removed). */
export function jumpFor(ref: ChatRef, mode: 'office' | 'pocket', w: RefWorld): Jump | null {
  const floorOf = (repoId: string) => w.repos.find((r) => r.id === repoId)?.floor;
  const ride = (repoId: string) => {
    const floor = floorOf(repoId);
    return mode === 'office' && floor !== undefined ? { floor } : {};
  };
  if (ref.kind === 'agent') {
    const a = w.agents[ref.agentId];
    return a ? { kind: 'overlay', overlay: { kind: 'terminal', agentId: a.id, view: ref.terminal ? 'terminal' : 'chat' }, ...ride(a.repoId) } : null; // @Ada opens their chat (#120)
  }
  const repo = w.repos.find((r) => r.id === ref.repoId);
  if (!repo) return null;
  if (ref.kind === 'floor') return { kind: 'floor', floor: repo.floor, repoId: repo.id };
  if (ref.kind === 'file') return { kind: 'file' };
  const n = ref.number;
  const pull = n === undefined ? undefined : repo.pulls.find((p) => p.number === n);
  const open = pull?.state === 'OPEN';
  if (ref.kind === 'issue') {
    const n = ref.number;
    const issue = repo.issues.some((i) => i.number === n);
    // The whiteboard has open issues and open or merged PRs; anything else is on GitHub.
    if (issue || (pull && pull.state !== 'CLOSED')) {
      const key = pull ? `${pull.state === 'MERGED' ? 'm' : 'pr'}-${n}` : `i-${n}`;
      return { kind: 'overlay', overlay: { kind: 'card', repoId: repo.id, key, number: n, pr: !!pull }, ...ride(repo.id) };
    }
    return { kind: 'url', url: ghUrl(repo.fullName, n, !!pull) };
  }
  if (ref.kind === 'qa') {
    if (open) return { kind: 'overlay', overlay: { kind: 'app', repoId: repo.id, pr: ref.number, qa: true }, ...ride(repo.id) };
    return { kind: 'url', url: w.qa[`${repo.id}#${ref.number}`]?.commentUrl ?? ghUrl(repo.fullName, ref.number, true) };
  }
  if (n !== undefined && !open) return { kind: 'url', url: ghUrl(repo.fullName, n, true) };
  return { kind: 'overlay', overlay: { kind: 'app', repoId: repo.id, pr: n ?? null }, ...ride(repo.id) };
}

/** An agent by id, else by name (old action cards kept the name the CEO gave). */
export function agentFor(w: RefWorld, idOrName: string): RefWorld['agents'][string] | undefined {
  const name = idOrName.trim().toLowerCase();
  return w.agents[idOrName] ?? Object.values(w.agents).find((a) => a.id !== CEO_ID && a.name.toLowerCase() === name);
}

/** Where a CEO action card goes (#215): its agent's chat at the message or their details, a console section, the decision log, or as its chip would. */
export function actionJump(ref: ActionRef, mode: 'office' | 'pocket', w: RefWorld): Jump | null {
  if (ref.kind === 'decision' || ref.kind === 'approvals') return { kind: 'decisions' };
  if (ref.kind === 'section') return { kind: 'overlay', overlay: { kind: 'manager', tab: ref.section, ...(ref.repoId && { repoId: ref.repoId }) } };
  if (ref.kind !== 'agent') return jumpFor({ ...ref, start: 0, end: 0 }, mode, w);
  const a = agentFor(w, ref.agentId);
  if (!a) return null;
  const floor = mode === 'office' ? w.repos.find((r) => r.id === a.repoId)?.floor : undefined;
  const overlay: Overlay = { kind: 'terminal', agentId: a.id, view: 'chat', ...(ref.messageId !== undefined && { jump: ref.messageId }), ...(ref.details && { details: ref.details }) };
  return { kind: 'overlay', overlay, ...(floor !== undefined && { floor }) };
}

/** A chip's icon, its status words and their tone, or null when what it names is gone (shown as text). */
export function chipInfo(ref: ChatRef, w: RefWorld): { icon: string; status?: string; tone?: 'good' | 'warn' | 'bad' } | null {
  if (ref.kind === 'agent') {
    const a = w.agents[ref.agentId];
    if (!a) return null;
    const on = a.prNumber ?? a.issueNumber;
    const tone = a.status === 'error' ? 'bad' : a.status === 'working' || a.status === 'preparing' ? 'good' : undefined;
    return { icon: ref.terminal ? '🖥️' : '👤', status: `${a.status}${on && a.status !== 'idle' ? ` · #${on}` : ''}`, ...(tone && { tone }) };
  }
  const repo = w.repos.find((r) => r.id === ref.repoId);
  if (!repo) return null;
  if (ref.kind === 'floor') return { icon: '🏢', status: repo.fullName.split('/')[1] };
  if (ref.kind === 'file') return { icon: '📄' };
  const n = ref.number;
  const pull = n === undefined ? undefined : repo.pulls.find((p) => p.number === n);
  const qa = n === undefined ? undefined : w.qa[`${repo.id}#${n}`];
  const qaTone = (s: string) => (s === 'passed' ? 'good' : s === 'failed' || s === 'needs-human' ? 'bad' : 'warn');
  if (ref.kind === 'qa') return { icon: '🔍', status: qa?.status ?? 'not tested', ...(qa && { tone: qaTone(qa.status) }) };
  if (ref.kind === 'preview') {
    const status = n === undefined ? repo.preview.status : pull?.state === 'OPEN' ? 'PR app' : pull?.state.toLowerCase();
    return { icon: '▶️', ...(status && { status }) };
  }
  if (pull) {
    if (pull.state !== 'OPEN') return { icon: '🔀', status: pull.state.toLowerCase(), ...(pull.state === 'MERGED' && { tone: 'good' as const }) };
    const tone = qa ? qaTone(qa.status) : pull.checks === 'failing' ? 'bad' : undefined;
    return { icon: '🔀', status: qa ? `QA ${qa.status}` : `checks ${pull.checks}`, ...(tone && { tone }) };
  }
  return repo.issues.some((i) => i.number === n) ? { icon: '📋', status: 'open' } : { icon: '📋' };
}

// ---------- the message box's "@" and "#" ----------

/** The "@name" or "#123" being typed at the end of the message box, or null. */
export function mentionAt(text: string): { kind: '@' | '#'; query: string; start: number } | null {
  const m = /(^|\s)([@#])([^\s@#]*)$/.exec(text);
  return m ? { kind: m[2] as '@' | '#', query: m[3], start: m.index + m[1].length } : null;
}

export interface MentionPick {
  label: string;
  hint: string;
  insert: string; // what replaces the typed "@…" or "#…"
}

/** What "@" (agents) or "#" (the issues and PRs of the floor you're on, else every floor's) offers, best first. */
export function mentionPicks(at: { kind: '@' | '#'; query: string }, w: RefWorld, floor: number, max = 6): MentionPick[] {
  const q = at.query.toLowerCase();
  if (at.kind === '@') {
    return Object.values(w.agents)
      .filter((a) => a.id !== CEO_ID && a.name.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
      .slice(0, max)
      .map((a) => ({ label: `@${a.name}`, hint: `floor ${w.repos.find((r) => r.id === a.repoId)?.floor ?? '?'} · ${a.status}`, insert: `@${a.name} ` }));
  }
  const here = w.repos.filter((r) => r.floor === floor);
  const out: MentionPick[] = [];
  for (const r of here.length ? here : w.repos) {
    const items = [...r.pulls.filter((p) => p.state === 'OPEN').map((p) => ({ n: p.number, title: p.title, kind: 'PR' })), ...r.issues.map((i) => ({ n: i.number, title: i.title, kind: 'issue' }))];
    for (const x of items) {
      if (!String(x.n).startsWith(q) && !x.title.toLowerCase().includes(q)) continue;
      out.push({ label: `#${x.n} ${x.title}`, hint: `${x.kind} · floor ${r.floor}`, insert: `floor ${r.floor} #${x.n} ` });
    }
  }
  return out.slice(0, max);
}

// ---------- file previews ----------

/** The lines a file's preview shows: `count` of them starting a little above `line`, else the first ones. */
export function fileWindow(text: string, line: number | null, count = 8): { from: number; lines: string[] } {
  const all = text.replace(/\r\n?/g, '\n').split('\n');
  const from = line ? Math.max(1, Math.min(line - 2, all.length - count + 1)) : 1;
  return { from, lines: all.slice(from - 1, from - 1 + count) };
}

export type Token = { text: string; kind?: 'kw' | 'str' | 'num' | 'com' };

const KEYWORDS = new Set(
  'import export from as const let var function return if else for while do switch case break continue new class extends implements interface type enum async await yield try catch finally throw default typeof instanceof in of void delete null undefined true false this super def self None True False elif lambda pass with fn pub use mut struct impl package func go defer'.split(' '),
);
const HASH_COMMENTS = /\.(py|sh|bash|zsh|ya?ml|toml|rb|r|pl|conf|ini|dockerfile)$|(^|\/)(dockerfile|makefile)$/i;

/** One line of code as tokens for the viewer's colours: comments, strings, numbers and keywords. */
export function codeTokens(line: string, path: string): Token[] {
  const hash = HASH_COMMENTS.test(path);
  const re = new RegExp(`(\\/\\/.*$|\\/\\*.*?(?:\\*\\/|$)${hash ? '|#.*$' : ''})|("(?:[^"\\\\]|\\\\.)*"?|'(?:[^'\\\\]|\\\\.)*'?|\`(?:[^\`\\\\]|\\\\.)*\`?)|(\\b\\d[\\d_.]*\\b)|([A-Za-z_$][\\w$]*)`, 'g');
  const out: Token[] = [];
  let last = 0;
  const push = (t: Token) => {
    const prev = out[out.length - 1];
    if (prev && !prev.kind && !t.kind) prev.text += t.text;
    else out.push(t);
  };
  for (const m of line.matchAll(re)) {
    if (m.index > last) push({ text: line.slice(last, m.index) });
    const kind = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'num' : KEYWORDS.has(m[4]) ? 'kw' : undefined;
    push(kind ? { text: m[0], kind } : { text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < line.length) push({ text: line.slice(last) });
  return out;
}
