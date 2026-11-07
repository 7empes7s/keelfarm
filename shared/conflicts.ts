// Fewer merge conflicts (#256): conflict-aware scheduling around busy files (the practices' `busyFiles` switch), the
// merge order, the cheaper model for conflict-only fix rounds, and Mission control's Conflicts card. Pure, shared by
// the server (scheduler, merge gate, ledger) and the client (the card, Settings).
import type { CostMerge, CostRecord, CostSession } from './costs.ts';
import { leaseOverlap, normPath, type Lease, type LeaseHold } from './practices.ts';
import type { EffortLevel } from './types.ts';

// ---------- predicting an issue's files ----------

/** A floor's keyword → area table, from its playbook: lines like "area chat: client/src/ui/Chat*, client/src/chat.css". */
export function playbookAreas(playbook: string | null | undefined): { word: string; paths: string[] }[] {
  const out: { word: string; paths: string[] }[] = [];
  for (const m of (playbook ?? '').matchAll(/^[\s*-]*area\s+([\w -]{1,40}?)\s*:\s*(.+)$/gim)) {
    const paths = m[2].split(/[,\s]+/).map((p) => normPath(p.replace(/`/g, ''))).filter((p) => p && !p.split('/').includes('..'));
    if (paths.length) out.push({ word: m[1].trim().toLowerCase(), paths: paths.slice(0, 10) });
  }
  return out.slice(0, 40);
}

/**
 * The files an issue's text points at through the floor's areas: a keyword's paths, a trailing * standing for every
 * known path that starts with it (none known: the prefix's folder).
 */
export function areaFiles(text: string, areas: { word: string; paths: string[] }[], known: string[]): string[] {
  const out = new Set<string>();
  for (const a of areas) {
    if (!new RegExp(`\\b${a.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) continue;
    for (const p of a.paths) {
      if (!p.endsWith('*')) {
        out.add(p);
        continue;
      }
      const prefix = p.slice(0, -1);
      const hits = known.filter((k) => k.startsWith(prefix));
      if (hits.length) for (const h of hits) out.add(h);
      else if (prefix.includes('/')) out.add(prefix.slice(0, prefix.lastIndexOf('/') + 1));
    }
  }
  return [...out];
}

// ---------- conflict-aware scheduling ----------

/** Overlap at or over this is heavy: two shared files with one piece of work in flight, or one file two of them touch. */
const HEAVY_OVERLAP = 2;

/** An issue's overlap with the floor's work in flight: a point per file per PR or build touching it, and the most-shared lease. */
export function overlapScore(files: string[], leases: Lease[], self: number): { score: number; by: Lease | null; files: string[] } {
  let score = 0;
  let by: Lease | null = null;
  let shared: string[] = [];
  for (const l of leases) {
    if (l.issue === self) continue;
    const hit = leaseOverlap(files, l.files);
    score += hit.length;
    if (hit.length > shared.length) [by, shared] = [l, hit];
  }
  return { score, by, files: shared };
}

/** A ready issue as pickNext sees it: its predicted files, the practice's switch for it, and a priority pick. */
export interface ReadyItem {
  number: number;
  files: string[];
  on: boolean; // conflict-aware scheduling is on for it (its floor's or its variant's switch)
  priority: boolean; // the manager or the CEO put it first (a priority label): never held back
}

/** Labels that make an issue a priority pick. */
export const isPriorityLabel = (l: string) => /^(priority|swarm:first|swarm:priority)$/i.test(l);

/**
 * The next issue to start, in readyIssues' order: the first that is a priority pick, has the practice off, or overlaps
 * work in flight less than HEAVY_OVERLAP. When every one overlaps heavily, the least-overlapping one (an agent never
 * idles over this). `held`: every ready issue that waits for now, with why (the board shows them all); `avoided`: an
 * overlapping issue ahead of the pick was skipped for it.
 */
export function pickNext(ready: ReadyItem[], leases: Lease[], o: { now: number; heldSince: ReadonlyMap<number, number> }): { pick: number | null; held: LeaseHold[]; avoided: boolean } {
  const held: (LeaseHold & { score: number; at: number })[] = [];
  let pick: number | null = null;
  let at = -1;
  ready.forEach((r, i) => {
    const s = r.on && !r.priority ? overlapScore(r.files, leases, r.number) : null;
    if (s && s.score >= HEAVY_OVERLAP && s.by) held.push({ issue: r.number, by: { issue: s.by.issue, pr: s.by.pr }, files: s.files, since: o.heldSince.get(r.number) ?? o.now, score: s.score, at: i });
    else if (pick === null) [pick, at] = [r.number, i];
  });
  const avoided = pick !== null && held.some((h) => h.at < at);
  if (pick === null && held.length) pick = held.reduce((best, h) => (h.score < best.score ? h : best)).issue;
  return { pick, held: held.filter((h) => h.issue !== pick).map(({ score: _s, at: _a, ...h }) => h), avoided };
}

/** The board's words for a held issue: "waits for PR #251: same files: Chat.tsx, pocket.css". */
export function holdReason(h: LeaseHold): string {
  const by = h.by.pr ? `PR #${h.by.pr}` : `#${h.by.issue}`;
  const names = h.files.map((f) => f.replace(/\/$/, '').split('/').pop() || f);
  return `waits for ${by}: same files: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`;
}

// ---------- merge order ----------

/**
 * Which of several QA-passed PRs merges first: the one touching the most hot files (the floor's most conflicted ones,
 * and files other open PRs change too), so the PRs it would conflict with are refreshed before their QA. Ties keep
 * the given order.
 */
export function mergeOrder(prs: { number: number; files: string[] }[], hot: string[], open: { number: number; files: string[] }[]): number[] {
  const score = (p: { number: number; files: string[] }) =>
    p.files.filter((f) => hot.includes(f)).length + open.filter((o) => o.number !== p.number).reduce((n, o) => n + leaseOverlap(p.files, o.files).length, 0);
  return prs
    .map((p, i) => ({ n: p.number, s: score(p), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.n);
}

// ---------- cheap conflict rounds ----------

/** Settings → Agents → Conflict-only fixes (settings.everyProject.conflictFix): the model and effort for a fix round whose only cause is a conflict. */
export interface ConflictFixSettings {
  model: string; // '' runs them like any other fix, on the agent's own model
  effort: EffortLevel | '';
  strongFiles: string[]; // a PR touching these (office logic) keeps the agent's own model
}

const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const DEFAULT_CONFLICT_FIX: ConflictFixSettings = {
  model: 'claude-sonnet-5',
  effort: 'low',
  strongFiles: ['server/swarm/', 'server/swarm.ts', 'scripts/office.mjs', 'scripts/officeSteps.mjs'],
};

/** The settings after a patch from Settings; wrong values are refused with what to fix. */
export function conflictFixSettings(prev: ConflictFixSettings | undefined, patch: unknown): ConflictFixSettings {
  const base = { ...DEFAULT_CONFLICT_FIX, ...prev, strongFiles: [...(prev?.strongFiles ?? DEFAULT_CONFLICT_FIX.strongFiles)] };
  if (!patch || typeof patch !== 'object') throw new Error('conflictFix must be an object');
  const p = patch as Record<string, unknown>;
  if (p.model !== undefined) base.model = String(p.model).trim().slice(0, 100);
  if (p.effort !== undefined) {
    if (p.effort !== '' && !EFFORTS.includes(p.effort as EffortLevel)) throw new Error(`effort must be one of ${EFFORTS.join(', ')}`);
    base.effort = p.effort as ConflictFixSettings['effort'];
  }
  if (p.strongFiles !== undefined) {
    if (!Array.isArray(p.strongFiles)) throw new Error('strongFiles must be a list of paths');
    base.strongFiles = [...new Set(p.strongFiles.filter((f): f is string => typeof f === 'string').map(normPath).filter(Boolean))].slice(0, 30);
  }
  return base;
}

/**
 * The model and effort a fix round runs on when it is conflict-only (no QA findings to fix, no failing checks):
 * the cheap ones from the settings, unless the PR touches office logic (`strongFiles`), its files are unknown, the
 * agent isn't on Claude Code, or the last fix round of this PR already ran cheap (it escalates). Null: the agent's own.
 */
export function conflictFixRun(
  rec: { fixReason: 'qa' | 'checks' | 'conflict' | null; preQa: unknown; passedSha: string | null; cheapFix?: unknown },
  o: { files: string[] | null; checks: string | undefined; claude: boolean },
  s: ConflictFixSettings,
): { model: string; effort: EffortLevel | '' } | null {
  if (!s.model || !o.claude || rec.cheapFix) return null;
  if (rec.fixReason !== 'conflict' || (!rec.preQa && !rec.passedSha)) return null; // a conflict QA never passed carries QA's findings
  if (o.checks === 'failing' || !o.files) return null;
  if (leaseOverlap(o.files, s.strongFiles).length) return null;
  return { model: s.model, effort: s.effort };
}

// ---------- Mission control's Conflicts card ----------

const DAY = 24 * 60 * 60_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A failed round caused by a conflict: QA failing on it, or a conflict fix. */
const conflictRound = (s: CostSession) => s.cause === 'conflict' && ((s.kind === 'qa' && s.outcome === 'qa-fail') || s.kind === 'fix-conflict');

export interface ConflictStats {
  perMerge: number | null; // conflict rounds per merged PR, the last 7 days
  trend: (number | null)[]; // the trailing week's, a point a day over 30 days, oldest first
  cheapRounds: number; // conflict fixes on the cheap model, the last 7 days
  savedUsd: number | null; // what they saved against the normal model's conflict fixes (30 days' average); null: nothing to compare yet
}

/** Conflict rounds per merge over [since, until]: rounds of the PRs that merged in it. */
function perMerge(records: CostRecord[], since: number, until: number): number | null {
  const merged = records.filter((r): r is CostMerge => r.type === 'merge' && r.at >= since && r.at <= until);
  if (!merged.length) return null;
  const prs = new Set(merged.map((m) => `${m.repoId}#${m.pr}`));
  const rounds = records.filter((r): r is CostSession => r.type === 'session' && r.pr !== null && conflictRound(r) && prs.has(`${r.repoId}#${r.pr}`)).length;
  return round2(rounds / merged.length);
}

/** The card's numbers from the ledger (today counts as one of the 7 days). */
export function conflictStats(records: CostRecord[], today: number, now: number): ConflictStats {
  const week = today - 6 * DAY;
  const fixes = records.filter((r): r is CostSession => r.type === 'session' && r.kind === 'fix-conflict' && r.at >= today - 29 * DAY && r.at <= now);
  const normal = fixes.filter((s) => !s.cheap && s.usd > 0);
  const cheap = fixes.filter((s) => s.cheap && s.at >= week);
  const avg = normal.length ? normal.reduce((n, s) => n + s.usd, 0) / normal.length : null;
  const trend = Array.from({ length: 30 }, (_, i) => {
    const end = today - (29 - i) * DAY;
    return perMerge(records, end - 6 * DAY, Math.min(now, end + DAY - 1));
  });
  return {
    perMerge: perMerge(records, week, now),
    trend,
    cheapRounds: cheap.length,
    savedUsd: avg === null ? null : round2(cheap.reduce((n, s) => n + Math.max(0, avg - s.usd), 0)),
  };
}
