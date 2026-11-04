// The cost ledger (#18): one line per finished session and per merged PR in <SWARM_HOME>/costs.jsonl (demo-costs.jsonl
// for the demo), append-only, kept 30 days (pruned at startup and on the housekeeping timer by rewriting the file
// through a temp file). Never in state.json or the snapshot: the usage view and the CEO's company_status read it on
// demand. The aggregation below is pure.
import fs from 'node:fs/promises';
import { dayKey } from '../shared/journal.ts';
import {
  isTaskKind,
  wasteReason,
  type CostDayRow,
  type CostFloorRow,
  type CostItem,
  type CostKindRow,
  type CostMerge,
  type CostRecord,
  type CostSession,
  type CostsView,
  type CostSplit,
  type CostWaste,
} from '../shared/costs.ts';
import { DAY_MS, startOfDay } from './metrics.ts';

export const KEEP_DAYS = 30;
const TOP = 10;
const MAX_WASTE = 50;

const cents = (n: number) => Math.round(n * 100) / 100;

/** The ledger's lines, oldest first; lines that don't parse (a torn last write) are skipped. */
export function parseLedger(text: string): CostRecord[] {
  const out: CostRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as CostRecord;
      if (r && typeof r.at === 'number' && typeof r.repoId === 'string' && (r.type === 'merge' ? typeof r.pr === 'number' : r.type === 'session' && isTaskKind(r.kind))) out.push(r);
    } catch {
      // a half-written line
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** What's younger than `keepDays`. */
export const pruneLedger = (records: CostRecord[], now: number, keepDays = KEEP_DAYS) => records.filter((r) => now - r.at <= keepDays * DAY_MS);

const mergeKey = (repoId: string, pr: number) => `${repoId}#${pr}`;

function split(sessions: CostSession[], merges: number): CostSplit {
  const byKind: CostSplit['byKind'] = {};
  let usd = 0;
  let wasteUsd = 0;
  for (const s of sessions) {
    usd += s.usd;
    byKind[s.kind] = (byKind[s.kind] ?? 0) + s.usd;
    if (wasteReason(s)) wasteUsd += s.usd;
  }
  for (const k of Object.keys(byKind) as (keyof typeof byKind)[]) byKind[k] = cents(byKind[k]!);
  return { usd: cents(usd), sessions: sessions.length, merges, perMerge: merges ? cents(usd / merges) : null, wasteUsd: cents(wasteUsd), byKind };
}

/** A session's piece of work: its issue if it has one (QA and fixes carry the issue their PR closes), else its PR. */
const workKey = (s: Pick<CostSession, 'repoId' | 'issue' | 'pr'>) => (s.issue !== null ? `${s.repoId}#${s.issue}` : s.pr !== null ? `${s.repoId}!${s.pr}` : null);

/**
 * The usage view over the last `days` days (today counts as one), for one floor or all of them: cost and cost per merged
 * PR per floor and per day, split by task kind; the most expensive pieces of work; the waste list; and what each kind
 * of task averaged at each effort.
 */
export function costsView(records: CostRecord[], o: { now: number; days: number; repoId?: string }): CostsView {
  const since = startOfDay(o.now) - (o.days - 1) * DAY_MS;
  const inView = records.filter((r) => r.at >= since && r.at <= o.now && (o.repoId === undefined || r.repoId === o.repoId));
  const sessions = inView.filter((r): r is CostSession => r.type === 'session');
  const merges = inView.filter((r): r is CostMerge => r.type === 'merge');

  const repos = [...new Set([...sessions.map((s) => s.repoId), ...merges.map((m) => m.repoId)])].sort();
  const floors: CostFloorRow[] = repos.map((repoId) => ({
    repoId,
    ...split(
      sessions.filter((s) => s.repoId === repoId),
      merges.filter((m) => m.repoId === repoId).length,
    ),
  }));

  const days = [...new Set([...sessions, ...merges].map((r) => dayKey(r.at)))].sort().reverse();
  const byDay: CostDayRow[] = days.map((day) => ({
    day,
    ...split(
      sessions.filter((s) => dayKey(s.at) === day),
      merges.filter((m) => dayKey(m.at) === day).length,
    ),
  }));

  // Merged anywhere in the ledger (an issue's merge may come after the view's window started).
  const mergedPrs = new Set(records.filter((r): r is CostMerge => r.type === 'merge').map((m) => mergeKey(m.repoId, m.pr)));
  const mergedIssues = new Set(records.filter((r): r is CostMerge => r.type === 'merge').flatMap((m) => m.issues.map((i) => `${m.repoId}#${i}`)));
  const items = new Map<string, CostItem>();
  for (const s of sessions) {
    const key = workKey(s);
    if (!key || !s.repoId) continue;
    const it = items.get(key) ?? { repoId: s.repoId, issue: s.issue, pr: null, usd: 0, sessions: 0, merged: false };
    it.usd += s.usd;
    it.sessions++;
    it.pr ??= s.pr;
    it.merged ||= (it.issue !== null && mergedIssues.has(`${s.repoId}#${it.issue}`)) || (s.pr !== null && mergedPrs.has(mergeKey(s.repoId, s.pr)));
    items.set(key, it);
  }
  const top = [...items.values()]
    .sort((a, b) => b.usd - a.usd)
    .slice(0, TOP)
    .map((it) => ({ ...it, usd: cents(it.usd) }));

  const waste: CostWaste[] = [];
  for (const s of [...sessions].reverse()) {
    const why = wasteReason(s);
    if (why && waste.length < MAX_WASTE) waste.push({ at: s.at, repoId: s.repoId, agent: s.agent, kind: s.kind, issue: s.issue, pr: s.pr, usd: cents(s.usd), why });
  }

  const kinds: CostKindRow[] = [];
  for (const kind of [...new Set(sessions.map((s) => s.kind))]) {
    const of = sessions.filter((s) => s.kind === kind);
    const efforts = [...new Set(of.map((s) => s.effort))];
    kinds.push({
      kind,
      sessions: of.length,
      avg: cents(of.reduce((n, s) => n + s.usd, 0) / of.length),
      byEffort: efforts.map((effort) => {
        const e = of.filter((s) => s.effort === effort);
        return { effort, sessions: e.length, avg: cents(e.reduce((n, s) => n + s.usd, 0) / e.length) };
      }),
    });
  }

  return { days: o.days, since, total: split(sessions, merges.length), floors, byDay, top, waste, kinds };
}

/** company_status's spend numbers for one floor: today's cost and waste, and cost per merged PR over 7 days. */
export function floorSpend(records: CostRecord[], repoId: string, now: number) {
  const today = costsView(records, { now, days: 1, repoId }).total;
  const week = costsView(records, { now, days: 7, repoId }).total;
  return { costToday: today.usd, costPerMerge: week.perMerge, wasteToday: today.wasteUsd };
}

/** The ledger file, with its last 30 days in memory (company_status reads it synchronously). Writes go one at a time. */
export class CostLedger {
  private writing: Promise<void> = Promise.resolve();
  private records: CostRecord[] = [];
  private merged = new Set<string>(); // repo#pr of the merges in the ledger

  constructor(
    private file: string,
    private now: () => number = Date.now,
  ) {}

  /** Reads the file and rewrites it without what's older than 30 days (temp file + rename), when there is any. */
  async load() {
    const text = await fs.readFile(this.file, 'utf8').catch(() => null);
    const all = text === null ? [] : parseLedger(text);
    this.set(pruneLedger(all, this.now()));
    if (text !== null && (this.records.length !== all.length || (text && !text.endsWith('\n')))) await this.rewrite();
  }

  /** Drops what's older than 30 days, from memory and the file. */
  async prune() {
    const before = this.records.length;
    this.set(pruneLedger(this.records, this.now()));
    if (this.records.length !== before) await this.rewrite();
  }

  /** The last 30 days, oldest first. */
  all(): CostRecord[] {
    return pruneLedger(this.records, this.now());
  }

  /** A finished session. */
  session(s: Omit<CostSession, 'type'>) {
    return this.append([{ type: 'session', ...s, usd: Math.max(0, Math.round(s.usd * 10_000) / 10_000) }]);
  }

  /** Merged PRs from a sync; the ones the ledger already has, and any older than 30 days, are left out. */
  merges(list: Omit<CostMerge, 'type'>[]) {
    const fresh = list.filter((m) => this.now() - m.at <= KEEP_DAYS * DAY_MS && !this.merged.has(mergeKey(m.repoId, m.pr)));
    return this.append(fresh.map((m) => ({ type: 'merge', ...m })));
  }

  /** Replaces the whole ledger (the demo's made-up week). */
  replace(records: CostRecord[]) {
    this.set(records);
    return this.rewrite();
  }

  private set(records: CostRecord[]) {
    this.records = [...records].sort((a, b) => a.at - b.at);
    this.merged = new Set(this.records.filter((r): r is CostMerge => r.type === 'merge').map((m) => mergeKey(m.repoId, m.pr)));
  }

  private append(records: CostRecord[]) {
    if (!records.length) return this.writing;
    for (const r of records) {
      this.records.push(r);
      if (r.type === 'merge') this.merged.add(mergeKey(r.repoId, r.pr));
    }
    const text = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    return this.queue(() => fs.appendFile(this.file, text));
  }

  private rewrite() {
    const text = this.records.map((r) => JSON.stringify(r) + '\n').join('');
    const tmp = `${this.file}.tmp`;
    return this.queue(async () => {
      await fs.writeFile(tmp, text);
      await fs.rename(tmp, this.file);
    });
  }

  private queue(write: () => Promise<void>) {
    this.writing = this.writing.then(write).catch((err) => console.warn('could not write the cost ledger', err));
    return this.writing;
  }
}
