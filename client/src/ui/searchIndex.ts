// Search everything (#109): one index over floors, agents, issues, PRs, QA reports, settings (the console's own
// index, consoleNavRules.ts), charter objectives, CEO messages and artifacts, plus actions ("Ask the CEO to plan…"). Fuzzy
// matching, results grouped, recent picks first. Pure; SearchPalette.tsx draws it and goTo.ts runs a pick.
import { CEO_ID, type AgentView, type PhoneMessage, type QaView, type RepoView } from '../../../shared/types';
import { SECTIONS, type Where } from './consoleNavRules';
import type { Target } from './goTo';
import type { IconName } from './icons';
import { HUD_OPTIONS } from './hudOptions';

export type Kind = 'action' | 'floor' | 'agent' | 'issue' | 'pr' | 'qa' | 'setting' | 'objective' | 'message' | 'artifact';

const KIND_LABEL: Record<Kind, string> = {
  action: 'Actions',
  floor: 'Floors',
  agent: 'Agents',
  issue: 'Issues',
  pr: 'Pull requests',
  qa: 'QA reports',
  setting: 'Settings',
  objective: 'Objectives',
  message: 'CEO messages',
  artifact: 'Artifacts',
};

const ORDER: Kind[] = ['action', 'floor', 'agent', 'issue', 'pr', 'qa', 'objective', 'setting', 'message', 'artifact'];

export interface Item {
  id: string;
  kind: Kind;
  icon: IconName;
  label: string;
  sub?: string;
  target: Target;
}

export interface IndexInput {
  repos: Pick<RepoView, 'id' | 'fullName' | 'floor' | 'summary' | 'issues' | 'pulls' | 'charter'>[];
  agents: Record<string, Pick<AgentView, 'id' | 'name' | 'repoId' | 'role'>>;
  qa: Record<string, Pick<QaView, 'repoId' | 'prNumber' | 'status' | 'summary' | 'round'>>;
  messages: Pick<PhoneMessage, 'id' | 'from' | 'text' | 'artifacts'>[];
  where: Where;
}

const short = (fullName: string) => fullName.split('/')[1] ?? fullName;
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const QA_WORD: Record<string, string> = { queued: 'waiting for QA', testing: 'testing', passed: 'passed', failed: 'failed', fixing: 'being fixed', 'needs-human': 'needs you' };

/** Everything the search can find right now. The last 40 CEO messages, so the index stays small. */
export function buildIndex(s: IndexInput): Item[] {
  const items: Item[] = [];
  const floors = [...s.repos].sort((a, b) => a.floor - b.floor);
  // ---------- actions ----------
  items.push(
    { id: 'act:plan', kind: 'action', icon: 'brain', label: 'Ask the CEO to plan…', sub: 'A message ready to finish and send', target: { kind: 'ceo', text: 'Plan the next milestone for ' } },
    { id: 'act:research', kind: 'action', icon: 'search', label: 'Ask the CEO to research…', sub: 'Sources first, then options', target: { kind: 'ceo', text: 'Research ' } },
    { id: 'act:telegram', kind: 'action', icon: 'plane', label: 'Turn on Telegram', sub: 'Settings · Notifications', target: { kind: 'section', section: 'notifications' } },
    { id: 'act:notify', kind: 'action', icon: 'bell', label: 'Turn on notifications', sub: 'Settings · Notifications', target: { kind: 'section', section: 'notifications' } },
    { id: 'act:mandate', kind: 'action', icon: 'scroll-text', label: 'Add a standing mandate', sub: 'CEO · The CEO', target: { kind: 'section', section: 'ceo' } },
    { id: 'act:guide', kind: 'action', icon: 'circle-check', label: 'Get the most out of the office', sub: 'The setup checklist', target: { kind: 'guide' } },
    { id: 'act:previews', kind: 'action', icon: 'monitor', label: 'Previews', sub: 'Every live app and PR preview', target: { kind: 'overlay', overlay: { kind: 'previews' } } },
  );
  // the 3D office's Options: what a phone's top bar leaves out (#406)
  if (s.where === 'office') for (const o of HUD_OPTIONS) items.push({ id: `opt:${o.id}`, kind: 'action', icon: o.icon, label: o.label, sub: 'Options', target: { kind: 'option', id: o.id } });
  for (const r of floors) {
    const n = `floor ${r.floor}`;
    items.push(
      { id: `act:objective:${r.id}`, kind: 'action', icon: 'target', label: `Add an objective to ${n}`, sub: short(r.fullName), target: { kind: 'section', section: 'charter', repoId: r.id } },
      { id: `act:preview:${r.id}`, kind: 'action', icon: 'monitor', label: `Open ${n}'s preview`, sub: short(r.fullName), target: { kind: 'overlay', overlay: { kind: 'app', repoId: r.id } } },
    );
  }
  // ---------- the office's things ----------
  for (const r of floors) {
    items.push({ id: `floor:${r.id}`, kind: 'floor', icon: 'building-2', label: `Floor ${r.floor} · ${short(r.fullName)}`, sub: r.summary || r.fullName, target: { kind: 'overlay', overlay: { kind: 'kanban', repoId: r.id } } });
    for (const i of r.issues)
      items.push({ id: `issue:${r.id}#${i.number}`, kind: 'issue', icon: 'notebook-pen', label: `#${i.number} ${i.title}`, sub: `Floor ${r.floor}`, target: { kind: 'overlay', overlay: { kind: 'card', repoId: r.id, key: `i-${i.number}`, number: i.number, pr: false } } });
    for (const p of r.pulls)
      items.push({
        id: `pr:${r.id}#${p.number}`,
        kind: 'pr',
        icon: p.state === 'MERGED' ? 'party-popper' : 'git-merge',
        label: `PR #${p.number} ${p.title}`,
        sub: `Floor ${r.floor}${p.state === 'MERGED' ? ' · merged' : ''}`,
        target: { kind: 'overlay', overlay: { kind: 'card', repoId: r.id, key: p.state === 'MERGED' ? `m-${p.number}` : `pr-${p.number}`, number: p.number, pr: true } },
      });
    for (const o of r.charter.objectives)
      items.push({ id: `obj:${r.id}:${o.id}`, kind: 'objective', icon: 'target', label: `${o.id}: ${clip(o.outcome)}`, sub: `Floor ${r.floor}${o.measure ? ` · ${clip(o.measure, 50)}` : ''}`, target: { kind: 'section', section: 'charter', repoId: r.id } });
  }
  for (const q of Object.values(s.qa)) {
    const r = s.repos.find((x) => x.id === q.repoId);
    if (!r) continue;
    items.push({ id: `qa:${q.repoId}#${q.prNumber}`, kind: 'qa', icon: 'search', label: `QA on PR #${q.prNumber} · ${QA_WORD[q.status] ?? q.status}`, sub: clip(q.summary ?? `Floor ${r.floor} · round ${q.round}`), target: { kind: 'overlay', overlay: { kind: 'app', repoId: q.repoId, pr: q.prNumber, qa: true } } });
  }
  for (const a of Object.values(s.agents)) {
    const r = s.repos.find((x) => x.id === a.repoId);
    const ceo = a.id === CEO_ID || a.role === 'ceo';
    items.push({
      id: `agent:${a.id}`,
      kind: 'agent',
      icon: ceo ? 'brain' : 'laptop',
      label: a.name,
      sub: ceo ? 'CEO' : r ? `Floor ${r.floor} · ${short(r.fullName)}` : undefined,
      target: ceo ? { kind: 'ceo' } : { kind: 'overlay', overlay: { kind: 'terminal', agentId: a.id } },
    });
  }
  for (const sec of SECTIONS) {
    if (sec.only && sec.only !== s.where) continue;
    items.push({ id: `set:${sec.id}`, kind: 'setting', icon: sec.icon, label: sec.label, target: { kind: 'section', section: sec.id } });
    for (const f of sec.find) if (f !== sec.label) items.push({ id: `set:${sec.id}:${f}`, kind: 'setting', icon: sec.icon, label: f, sub: sec.label, target: { kind: 'section', section: sec.id } });
  }
  for (const m of s.messages.filter((x) => x.from === 'ceo').slice(-40)) {
    items.push({ id: `msg:${m.id}`, kind: 'message', icon: 'message-circle', label: clip(m.text.replace(/\s+/g, ' ')), target: { kind: 'ceo' } });
    for (const a of m.artifacts ?? []) items.push({ id: `art:${a.id}`, kind: 'artifact', icon: 'file-text', label: a.title, sub: clip(a.lead, 60), target: { kind: 'ceo' } });
  }
  return items;
}

/**
 * How well `query` matches `text`: higher is better, null for no match. Every word must be found, as a substring
 * (best at the start of a word) or, failing that, as letters in order ("prv" finds "preview").
 */
export function fuzzy(query: string, text: string): number | null {
  const t = text.toLowerCase();
  let score = 0;
  for (const w of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = t.indexOf(w);
    if (at >= 0) {
      score += at === 0 ? 30 : /\W/.test(t[at - 1]) ? 20 : 10;
      continue;
    }
    let i = 0;
    for (const ch of t) if (ch === w[i]) i++;
    if (i < w.length) return null;
    score += 1;
  }
  return score;
}

/** An item's score: fuzzy on its label, else every word somewhere in its label and sub line (no letters-in-order there). */
function matchItem(q: string, i: Item): number | null {
  const label = fuzzy(q, i.label);
  if (label !== null) return label + 5;
  const all = `${i.label} ${i.sub ?? ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => all.includes(w)) ? 1 : null;
}

export interface Group {
  kind: Kind | 'recent';
  label: string;
  items: Item[];
}

/** The results: recent picks first (all of them when nothing is typed, with the actions), then by kind, the best matching kind first. */
export function searchAll(query: string, items: Item[], recent: string[], max = 8): Group[] {
  const q = query.trim();
  const byId = new Map(items.map((i) => [i.id, i]));
  if (!q) {
    const rec = recent.map((id) => byId.get(id)).filter((i): i is Item => !!i);
    const acts = items.filter((i) => i.kind === 'action' && !recent.includes(i.id)).slice(0, max);
    return [...(rec.length ? [{ kind: 'recent' as const, label: 'Recent', items: rec }] : []), { kind: 'action' as const, label: KIND_LABEL.action, items: acts }];
  }
  const scored = items.map((i) => ({ i, s: matchItem(q, i) })).filter((x): x is { i: Item; s: number } => x.s !== null);
  const rec = new Set(recent);
  const recentHits = scored.filter((x) => rec.has(x.i.id)).sort((a, b) => recent.indexOf(a.i.id) - recent.indexOf(b.i.id));
  const groups: Group[] = recentHits.length ? [{ kind: 'recent', label: 'Recent', items: recentHits.map((x) => x.i) }] : [];
  // kinds in ORDER, except that a kind with a better best match goes first (typing a name finds the agent before "Add a…")
  const byKind = ORDER.map((kind) => scored.filter((x) => x.i.kind === kind && !rec.has(x.i.id)).sort((a, b) => b.s - a.s)).filter((l) => l.length);
  byKind.sort((a, b) => b[0].s - a[0].s);
  for (const list of byKind) groups.push({ kind: list[0].i.kind, label: KIND_LABEL[list[0].i.kind], items: list.slice(0, max).map((x) => x.i) });
  return groups;
}

// ---------- recent picks (per browser) ----------

const KEY = 'cubefarm.search.recent';

export function loadRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

/** The new recent list with `id` first (pure), kept to 6. */
export const withRecent = (list: string[], id: string) => [id, ...list.filter((x) => x !== id)].slice(0, 6);

export function saveRecent(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // private windows and blocked storage: no recent items, the search still works
  }
}
