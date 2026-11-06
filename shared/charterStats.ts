// The charter's numbers (#105): per objective, what merged under it and its share of all merges, its open issues,
// QA's first-round pass rate and rounds per merge, what it cost, its median lead time and a 4-week sparkline; per
// floor, how much of the work served the current focus, what named no objective, which standards QA saw broken and
// which non-goals it saw touched. Pure: the objective log (shared/charter.ts) joined with the cost ledger's lines
// (shared/costs.ts) and the floor's open issues. Every number carries the PRs or issues it counts, for tap-through.

import { objectiveTag, type CharterParts, type ObjectiveLog } from './charter.ts';
import type { CostRecord } from './costs.ts';
import { blockers } from './issues.ts';

/** What the manager says of an objective: on track, at risk, or met. */
export type ObjectiveStatus = 'on-track' | 'at-risk' | 'met';

export const STATUS_LABELS: Record<ObjectiveStatus, string> = { 'on-track': 'On track', 'at-risk': 'At risk', met: 'Met' };

/** QA's charter check on a PR (qaReport.ts charterCheck): ok, or the standard broken or non-goal touched it cited. rule '': a violation naming none of them. */
export interface CheckNote { at: number; pr: number; kind: 'ok' | 'standard' | 'nonGoal'; rule: string }

/** The windows the numbers come in, in days. */
export type StatsWindow = 7 | 30;
export const STATS_WINDOWS: StatsWindow[] = [7, 30];

const DAY_MS = 24 * 3600_000;
/** An objective with no merge for this long (and not met) is stalled. */
export const STALLED_MS = 14 * DAY_MS;
const WEEKS = 4;

/** One objective's numbers over a window. */
interface ObjectiveNumbers {
  prs: number[]; // merged PRs that named it, newest first
  share: number | null; // of all merges in the window (0..1); null when nothing merged
  qaPrs: number[]; // its merged PRs QA tested
  firstPass: number | null; // the share of them that passed QA's first round
  rounds: number | null; // QA rounds per merge
  usd: number; // sessions on its issues and PRs
  perMerge: number | null;
  leadMs: number | null; // median, first session on the issue → merge
  leadPrs: number[]; // the PRs it's measured on
}

export interface ObjectiveInsight {
  id: string;
  status: ObjectiveStatus | null;
  open: { ready: number[]; progress: number[]; waiting: number[] }; // open issues naming it
  weeks: number[]; // merges per week, the last 4 weeks, oldest first
  stalled: boolean;
  lastMerge: number | null;
  byWindow: Record<StatsWindow, ObjectiveNumbers>;
}

/** The floor's numbers over a window. */
interface FloorNumbers {
  merged: number[];
  inFocus: { share: number | null; prs: number[] }; // null: no focus objectives, or nothing merged
  untagged: number[]; // merged PRs that named no objective
  offCharter: { rule: string; prs: number[] }[]; // non-goals QA saw touched
  standards: { rule: string; prs: number[] }[] | null; // QA failures per standard, the most broken first; null: no charter checks in the window yet
}

export interface CharterInsights {
  focus: string[]; // the objectives the current focus names
  objectives: ObjectiveInsight[];
  untaggedIssues: number[]; // open issues naming no objective
  byWindow: Record<StatsWindow, FloorNumbers>;
}

/** The objective ids a focus line names ("O1, O3: …"), those the charter has, in its order. */
export function focusIds(c: Pick<CharterParts, 'objectives' | 'focus'>): string[] {
  const named = new Set([...c.focus.matchAll(/\bO(\d{1,2})\b/gi)].map((m) => `O${Number(m[1])}`));
  return c.objectives.map((o) => o.id).filter((id) => named.has(id));
}

// ---------- QA's charter checks ----------

const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)));
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'every', 'never', 'from', 'its', 'not', 'into', 'all', 'any']);

/** Which standard broken (or non-goal touched) a charter check cites: the one sharing the most of its words, at least half of them. */
export function citedRule(check: string, c: Pick<CharterParts, 'standards' | 'nonGoals'>): Pick<CheckNote, 'kind' | 'rule'> {
  const v = check.match(/^\W*violat\w*\W*(.*)$/is);
  if (!v) return { kind: 'ok', rule: '' };
  const text = v[1].toLowerCase();
  const said = words(text);
  let best: Pick<CheckNote, 'kind' | 'rule'> = { kind: 'standard', rule: '' };
  let bestScore = 0.5 - 1e-9;
  const candidates = [...c.standards.map((rule) => ({ kind: 'standard' as const, rule })), ...c.nonGoals.map((rule) => ({ kind: 'nonGoal' as const, rule }))];
  for (const cand of candidates) {
    const own = words(cand.rule);
    const score = text.includes(cand.rule.toLowerCase()) ? 1 : own.size ? [...own].filter((w) => said.has(w)).length / own.size : 0;
    if (score > bestScore) [best, bestScore] = [cand, score];
  }
  return best;
}

// ---------- the numbers ----------

export interface InsightInput {
  log: ObjectiveLog;
  charter: Pick<CharterParts, 'objectives' | 'standards' | 'nonGoals' | 'focus'>;
  status: Record<string, ObjectiveStatus>;
  ledger: CostRecord[]; // this floor's lines
  issues: { number: number; body: string; labels: string[] }[]; // its open issues
  busy: Set<number>; // issues someone is building, or with an open PR
  held: Set<number>; // issues waiting to be assigned by hand
  now: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const cents = (n: number) => Math.round(n * 100) / 100;
const SKIP = /^(swarm:skip|wontfix|question)$/i;

/** Every number of the Charter tab for one floor. */
export function charterInsights(o: InsightInput): CharterInsights {
  const { log, charter, now } = o;
  const sessions = o.ledger.filter((r) => r.type === 'session');
  const mergeIssues = new Map(o.ledger.flatMap((r) => (r.type === 'merge' ? [[r.pr, r.issues] as const] : [])));
  const prObjective = new Map(log.merged.map((m) => [m.pr, m.objective]));
  const objectiveOf = (s: { issue: number | null; pr: number | null }) => (s.issue !== null ? log.tags[String(s.issue)] : undefined) ?? (s.pr !== null ? prObjective.get(s.pr) : undefined) ?? null;

  // QA per PR: its rounds and whether the first passed
  const qa = new Map<number, { rounds: number; first: { round: number; pass: boolean } }>();
  for (const s of sessions) {
    if (s.kind !== 'qa' || s.pr === null || (s.outcome !== 'qa-pass' && s.outcome !== 'qa-fail')) continue;
    const round = s.round ?? Infinity;
    const q = qa.get(s.pr);
    const pass = s.outcome === 'qa-pass';
    if (!q) qa.set(s.pr, { rounds: 1, first: { round, pass } });
    else {
      q.rounds++;
      if (round < q.first.round) q.first = { round, pass };
    }
  }
  // when work on a PR started: the first session on its issues, or on it
  const firstOn = new Map<string, number>();
  const first = (key: string, at: number) => firstOn.set(key, Math.min(at, firstOn.get(key) ?? Infinity));
  for (const s of sessions) {
    if (s.issue !== null) first(`#${s.issue}`, s.at - s.ms);
    if (s.pr !== null) first(`!${s.pr}`, s.at - s.ms);
  }
  const started = (pr: number) => {
    const at = Math.min(firstOn.get(`!${pr}`) ?? Infinity, ...(mergeIssues.get(pr) ?? []).map((i) => firstOn.get(`#${i}`) ?? Infinity));
    return Number.isFinite(at) ? at : null;
  };

  const windowed = (days: StatsWindow) => {
    const since = now - days * DAY_MS;
    const merged = log.merged.filter((m) => m.at > since && m.at <= now);
    const spent = sessions.filter((s) => s.at > since && s.at <= now);
    const checks = log.checks.filter((c) => c.at > since && c.at <= now);
    const perObjective = (id: string): ObjectiveNumbers => {
      const mine = merged.filter((m) => m.objective === id);
      const prs = mine.map((m) => m.pr);
      const qaPrs = prs.filter((p) => qa.has(p));
      const usd = cents(spent.filter((s) => objectiveOf(s) === id).reduce((n, s) => n + s.usd, 0));
      const leads = mine.flatMap((m) => {
        const from = started(m.pr);
        return from !== null && m.at > from ? [{ pr: m.pr, ms: m.at - from }] : [];
      });
      return {
        prs,
        share: merged.length ? prs.length / merged.length : null,
        qaPrs,
        firstPass: qaPrs.length ? qaPrs.filter((p) => qa.get(p)!.first.pass).length / qaPrs.length : null,
        rounds: qaPrs.length ? qaPrs.reduce((n, p) => n + qa.get(p)!.rounds, 0) / qaPrs.length : null,
        usd,
        perMerge: prs.length ? cents(usd / prs.length) : null,
        leadMs: median(leads.map((l) => l.ms)),
        leadPrs: leads.map((l) => l.pr),
      };
    };
    const focus = new Set(focusIds(charter));
    const focusPrs = merged.filter((m) => m.objective !== null && focus.has(m.objective)).map((m) => m.pr);
    const grouped = (kind: CheckNote['kind'], rules: string[]) => {
      const out = rules.map((rule) => ({ rule, prs: [] as number[] }));
      for (const c of checks) {
        if (c.kind !== kind) continue;
        let g = out.find((x) => x.rule === c.rule);
        if (!g) out.push((g = { rule: c.rule, prs: [] }));
        if (!g.prs.includes(c.pr)) g.prs.push(c.pr);
      }
      return out;
    };
    const floor: FloorNumbers = {
      merged: merged.map((m) => m.pr),
      inFocus: { share: focus.size && merged.length ? focusPrs.length / merged.length : null, prs: focusPrs },
      untagged: merged.filter((m) => !m.objective).map((m) => m.pr),
      offCharter: grouped('nonGoal', []),
      standards: checks.length ? grouped('standard', charter.standards).sort((a, b) => b.prs.length - a.prs.length) : null,
    };
    return { floor, perObjective };
  };
  const windows = { 7: windowed(7), 30: windowed(30) };

  const open = new Set(o.issues.map((i) => i.number));
  const tagged = o.issues.map((i) => ({ ...i, tag: objectiveTag(i.body) }));
  const objectives = charter.objectives.map((obj): ObjectiveInsight => {
    const status = o.status[obj.id] ?? null;
    const mine = tagged.filter((i) => i.tag === obj.id);
    const waits = (i: (typeof mine)[number]) => o.held.has(i.number) || i.labels.some((l) => SKIP.test(l)) || blockers(i.body, open).length > 0;
    const lastMerge = log.merged.filter((m) => m.objective === obj.id && m.at <= now).reduce<number | null>((n, m) => Math.max(n ?? 0, m.at), null);
    return {
      id: obj.id,
      status,
      open: {
        progress: mine.filter((i) => o.busy.has(i.number)).map((i) => i.number),
        waiting: mine.filter((i) => !o.busy.has(i.number) && waits(i)).map((i) => i.number),
        ready: mine.filter((i) => !o.busy.has(i.number) && !waits(i)).map((i) => i.number),
      },
      weeks: Array.from({ length: WEEKS }, (_, k) => {
        const to = now - (WEEKS - 1 - k) * 7 * DAY_MS;
        return log.merged.filter((m) => m.objective === obj.id && m.at > to - 7 * DAY_MS && m.at <= to).length;
      }),
      stalled: status !== 'met' && (lastMerge === null || now - lastMerge > STALLED_MS),
      lastMerge,
      byWindow: { 7: windows[7].perObjective(obj.id), 30: windows[30].perObjective(obj.id) },
    };
  });
  return {
    focus: focusIds(charter),
    objectives,
    untaggedIssues: tagged.filter((i) => !i.tag).map((i) => i.number),
    byWindow: { 7: windows[7].floor, 30: windows[30].floor },
  };
}
