// The issue card's pure parts (#206): the body split into its "## " sections (folded or open), the Acceptance
// checklist's progress from what QA ticked, the stage a card is at, the history timeline from the issue, its PR and
// the session history, and what the work cost against the floor's median. CardView.tsx draws them.
import { kindLabel, type HistoryEntry } from '../../../shared/history';
import type { Col } from '../world/stickies';

// ---------- the body ----------

export interface BodySection {
  title: string;
  text: string;
  /** Open when the card opens: Why and Acceptance always, Build except on a phone, the rest open. */
  open: boolean;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^##\s+(.+?)\s*#*\s*$/;

/** The body as the text before its first "## " heading and one section per heading (headings in code blocks stay text). */
export function splitSections(body: string, phone: boolean): { intro: string; sections: BodySection[] } {
  const lines = (body ?? '').split(/\r?\n/);
  const intro: string[] = [];
  const sections: { title: string; lines: string[] }[] = [];
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    const h = fenced ? null : line.match(HEADING);
    if (h) sections.push({ title: h[1], lines: [] });
    else (sections.at(-1)?.lines ?? intro).push(line);
  }
  return {
    intro: intro.join('\n').trim(),
    sections: sections.map((s) => ({ title: s.title, text: s.lines.join('\n').trim(), open: !(phone && /^build\b/i.test(s.title)) })),
  };
}

// ---------- acceptance progress ----------

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+)$/;
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A text's list items, with whether each is ticked ("- [x]"). Items in code blocks don't count. */
export function checklist(text: string): { text: string; ticked: boolean }[] {
  const out: { text: string; ticked: boolean }[] = [];
  let fenced = false;
  for (const line of (text ?? '').split(/\r?\n/)) {
    if (FENCE.test(line)) fenced = !fenced;
    const m = fenced ? null : line.match(ITEM);
    if (m) out.push({ text: m[2], ticked: m[1] === 'x' || m[1] === 'X' });
  }
  return out;
}

/**
 * How much of the Acceptance list is done: an item counts when it's ticked there or a report (QA's summary, the PR)
 * ticks a line saying the same. null when the list is empty or nothing is ticked yet: the card shows its stage then.
 */
export function acceptanceProgress(acceptance: string, reports: readonly string[]): { done: number; total: number } | null {
  const items = checklist(acceptance);
  if (!items.length) return null;
  const ticked = reports.flatMap((r) => checklist(r).filter((i) => i.ticked).map((i) => words(i.text)));
  const said = (item: string) => {
    const w = words(item);
    return !!w && ticked.some((t) => t === w || (t.length >= 12 && w.startsWith(t)) || (w.length >= 12 && t.startsWith(w)));
  };
  const done = items.filter((i) => i.ticked || said(i.text)).length;
  return done ? { done, total: items.length } : null;
}

// ---------- the stage ----------

export const STAGES = ['Filed', 'Building', 'PR', 'QA', 'Merged'];

/** Where a card is on filed → building → PR → QA → merged: the stages before it are done (5: all done). */
export function stageAt(col: Col, inQa: boolean): number {
  if (col === 'backlog') return 0;
  if (col === 'progress') return 1;
  if (col === 'qa') return inQa ? 3 : 2;
  if (col === 'ready') return 4;
  return STAGES.length;
}

/** The status pill's word for a column. */
export const STATUS: Record<Col, string> = { backlog: 'Backlog', progress: 'Building', qa: 'In QA', ready: 'Ready to merge', merged: 'Merged' };

// ---------- the history ----------

export interface TimelineEvent {
  at: number;
  icon: string;
  text: string;
  tone?: 'good' | 'bad';
}

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * The card's history, oldest first: filed (and by whom), the first build session's start, the PR opened, each build,
 * QA round and fix from the session history, and the merge. `live`: an agent building it now with no session ended yet.
 */
export function issueTimeline(x: {
  issue?: { createdAt: string; author?: string | null };
  pull?: { number: number; createdAt: string; mergedAt: string | null };
  entries: readonly HistoryEntry[];
  live?: { agent: string; at: number } | null;
}): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const filed = time(x.issue?.createdAt);
  if (filed !== null) out.push({ at: filed, icon: '📝', text: x.issue?.author ? `Filed by @${x.issue.author}` : 'Filed' });
  const sessions = [...x.entries].sort((a, b) => a.at - b.at);
  const first = sessions.find((e) => e.kind === 'issue');
  if (first) out.push({ at: first.startedAt, icon: '🔨', text: `${first.agent} started building` });
  else if (x.live && Number.isFinite(x.live.at)) out.push({ at: x.live.at, icon: '🔨', text: `${x.live.agent} started building` });
  const opened = time(x.pull?.createdAt);
  if (x.pull && opened !== null) out.push({ at: opened, icon: '🔀', text: `PR #${x.pull.number} opened` });
  let round = 0;
  for (const e of sessions) {
    if (e.kind === 'qa') {
      round++;
      const pass = e.outcome === 'qa-pass';
      const fail = e.outcome === 'qa-fail';
      out.push({ at: e.at, icon: '🔍', text: `QA round ${round} ${pass ? 'passed' : fail ? 'failed' : 'ended'} · ${e.agent}`, tone: pass ? 'good' : fail ? 'bad' : undefined });
    } else if (e.kind.startsWith('fix-')) {
      const label = kindLabel(e.kind);
      out.push({ at: e.at, icon: '🔧', text: `${e.agent}: ${label[0].toLowerCase()}${label.slice(1)}${e.outcome === 'commit' ? ', pushed' : ''}` });
    }
    else if (e.kind === 'issue' && e.outcome !== 'pr') out.push({ at: e.at, icon: '⚠️', text: `${e.agent}'s build ended without a PR`, tone: 'bad' });
  }
  const merged = time(x.pull?.mergedAt);
  if (merged !== null) out.push({ at: merged, icon: '🎉', text: 'Merged', tone: 'good' });
  return out.sort((a, b) => a.at - b.at);
}

// ---------- the cost ----------

export interface IssueCost {
  sessions: number;
  ms: number;
  usd: number;
  /** The floor's median spend per piece of work (null: too few to say). */
  median: number | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * What this work's sessions cost, against the median of the floor's other work. `work` names the piece of work an
 * entry belongs to (an issue, through its PR), or null for what isn't one (the CEO, merges).
 */
export function issueCost(mine: readonly HistoryEntry[], floor: readonly HistoryEntry[], work: (e: HistoryEntry) => string | null, self: string): IssueCost {
  const sessions = mine.filter((e) => e.kind !== 'merge');
  const totals = new Map<string, number>();
  for (const e of floor) {
    const w = e.kind === 'merge' ? null : work(e);
    if (w && w !== self) totals.set(w, (totals.get(w) ?? 0) + e.usd);
  }
  return {
    sessions: sessions.length,
    ms: sessions.reduce((n, e) => n + Math.max(0, e.at - e.startedAt), 0),
    usd: sessions.reduce((n, e) => n + e.usd, 0),
    median: totals.size >= 3 ? median([...totals.values()]) : null,
  };
}
