// Careers (#226): an agent's record as the ledger (server/ledger.ts) keeps it, and what the office reads from it: pass
// rates, a rank, a "known for" line, the MVP of the week and the things that pile up on their desk. Pure.

/** One agent's career, kept compactly on their record. */
export interface CareerView {
  /** When they joined the team (ms). */
  since: number;
  /** PRs opened. */
  opened: number;
  /** PRs merged. */
  merged: number;
  /** PRs that passed QA on their first round. */
  firstPass: number;
  /** PRs whose first QA round they saw (passed or failed): firstPass's denominator. */
  firstQa: number;
  /** QA rounds on their PRs that passed, and that failed. */
  qaPass: number;
  qaFail: number;
  /** Fix rounds their merged PRs needed, all told. */
  fixRounds: number;
  /** PRs in a row that passed QA first time: now, and the longest run. */
  run: number;
  best: number;
  /** QA reviews done (pull requests they tested). */
  reviews: number;
  /** The coding agents' own estimate, over every session. */
  costUsd: number;
  turns: number;
  /** The last few merged PRs, newest first; rows, to keep the snapshot small (#205). */
  recent: [n: number, title: string, at: number][];
  /** When their merges of the last 7 days landed (the MVP of the week and the week's count). */
  week: number[];
  /** How long their last few builds took from the session's start to the PR (ms), newest first. */
  toPr: number[];
  /** Times hired: 1 in their first stint, more after rehires (#205). */
  hires: number;
  /** When they were rehired (ms), newest first. */
  rehired: number[];
  /** Time on the team in earlier stints (ms): tenure is this plus the time since `since`. */
  served: number;
  /** Sessions run, those that came to nothing (shared/costs.ts wasteReason), and what those cost. */
  sessions: number;
  wasted: number;
  wasteUsd: number;
  /** Time in sessions (ms), all told. */
  workMs: number;
  /** Tokens, when the CLI reports them (0: it never did; turns stand in). */
  tokens: number;
  /** How long their last few merged PRs took from the build's start to the merge (ms), newest first. */
  toMerge: number[];
  /** The last WEEKS weeks with any work, oldest first, as rows (weekRow): the sparklines and this week's cost. */
  weeks: WeekRow[];
  /** The coding agent, model and effort they run now, and since when (#198 lets them change); a row, to keep the snapshot small. */
  rig: [cli: string, model: string, effort: string, since: number] | null;
}

/** One week of an agent's work (#205). */
export interface CareerWeek {
  /** The week: weekOf(at). */
  w: number;
  merged: number;
  usd: number;
  /** Spent on sessions that came to nothing. */
  waste: number;
  sessions: number;
  firstQa: number;
  firstPass: number;
  /** Minutes in sessions. */
  min: number;
}

const WEEK_FIELDS = ['w', 'merged', 'usd', 'waste', 'sessions', 'firstQa', 'firstPass', 'min'] as const;

/** A week as a career keeps it: its numbers in WEEK_FIELDS' order, so a big company's snapshot stays small. */
export type WeekRow = number[];

export const weekRow = (k: CareerWeek): WeekRow => WEEK_FIELDS.map((f) => k[f]);
export const weekOfRow = (r: WeekRow): CareerWeek => Object.fromEntries(WEEK_FIELDS.map((f, i) => [f, r[i] ?? 0])) as unknown as CareerWeek;
const emptyWeek = (w: number): CareerWeek => ({ w, merged: 0, usd: 0, waste: 0, sessions: 0, firstQa: 0, firstPass: 0, min: 0 });

/** A career kept after a let-go (#205), for their rehire and the Team tab's "Past agents". */
export interface PastCareer {
  name: string;
  /** Their last id. */
  id: string;
  /** When they were let go (ms). */
  left: number;
  career: CareerView;
}

export const RECENT_KEEP = 8;
export const WEEK_MS = 7 * 24 * 3_600_000;
export const DAY_MS = 24 * 3_600_000;
/** The weeks of totals a career keeps (#205): the 8-week sparklines. */
const WEEKS = 8;

export function newCareer(since: number): CareerView {
  return { since, opened: 0, merged: 0, firstPass: 0, firstQa: 0, qaPass: 0, qaFail: 0, fixRounds: 0, run: 0, best: 0, reviews: 0, costUsd: 0, turns: 0, recent: [], week: [], toPr: [], hires: 1, rehired: [], served: 0, sessions: 0, wasted: 0, wasteUsd: 0, workMs: 0, tokens: 0, toMerge: [], weeks: [], rig: null };
}

/** A career as an older state file or journal holds it (#205): today's fields it lacks start empty, its numbers stay. */
export function legacyCareer(raw: Record<string, unknown>): CareerView {
  const out = newCareer(typeof raw.since === 'number' ? raw.since : Date.now());
  const into = out as unknown as Record<string, unknown>;
  for (const [k, d] of Object.entries(into)) {
    const v = raw[k];
    if (Array.isArray(d) ? Array.isArray(v) : d === null ? Array.isArray(v) : typeof v === typeof d && v !== null && !Array.isArray(v)) into[k] = v;
  }
  // merged PRs were objects before #205
  const row = (r: { n?: number; title?: string; at?: number } | null) => [r?.n, r?.title, r?.at];
  out.recent = out.recent.map((r) => (Array.isArray(r) ? r : row(r)) as CareerView['recent'][number]);
  return out;
}

/** A career as a snapshot sends it (#291): its values in newCareer's key order, not 27 key names per person. */
export type CareerRow = CareerView[keyof CareerView][];
const CAREER_FIELDS = Object.keys(newCareer(0)) as (keyof CareerView)[];
export const careerRow = (c: CareerView): CareerRow => CAREER_FIELDS.map((f) => c[f]);
export const careerOfRow = (r: CareerRow): CareerView => legacyCareer(Object.fromEntries(CAREER_FIELDS.map((f, i) => [f, r[i]])));

/** A snapshot as a tab gets it (#291): its agents' careers moved into rows by id, each agent's `career` then null. */
export function packCareers<S extends { agents: { id: string; career: CareerView | null }[] }>(s: S): S & { careers: Record<string, CareerRow> } {
  const careers: Record<string, CareerRow> = {};
  const agents = s.agents.map((a) => {
    if (!a.career) return a;
    careers[a.id] = careerRow(a.career);
    return { ...a, career: null };
  });
  return { ...s, agents, careers };
}

/** The week `at` falls in: weeks since the epoch, starting on Mondays (UTC). */
export const weekOf = (at: number) => Math.floor((at - 4 * DAY_MS) / WEEK_MS);

/** Adds to their week's totals (made if needed), keeping the last WEEKS weeks. */
export function addWeek(c: CareerView, at: number, add: Partial<Omit<CareerWeek, 'w'>>) {
  const w = weekOf(at);
  let row = c.weeks.find((r) => r[0] === w);
  if (!row) {
    row = weekRow(emptyWeek(w));
    const top = Math.max(w, ...c.weeks.map((r) => r[0]));
    c.weeks = [...c.weeks, row].filter((r) => r[0] > top - WEEKS).sort((p, q) => p[0] - q[0]);
  }
  for (const [f, n] of Object.entries(add)) {
    const i = WEEK_FIELDS.indexOf(f as keyof CareerWeek);
    row[i] = Math.round(((row[i] ?? 0) + (n ?? 0)) * 100) / 100;
  }
}

/** QA rounds passed as a share of all QA rounds on their PRs (0-1), or null before any. */
export function passRate(c: CareerView): number | null {
  const n = c.qaPass + c.qaFail;
  return n ? c.qaPass / n : null;
}

/** Fix rounds per merged PR, or null before the first merge. */
export const avgFixRounds = (c: CareerView): number | null => (c.merged ? c.fixRounds / c.merged : null);

/** Time on the team over every stint (ms). */
const tenureMs = (c: CareerView, now: number) => c.served + Math.max(0, now - c.since);

export const tenureDays = (c: CareerView, now: number) => tenureMs(c, now) / DAY_MS;

/** Merges in the 7 days before `now`. */
export const mergesThisWeek = (c: CareerView, now: number) => c.week.filter((t) => t > now - WEEK_MS && t <= now).length;

/** A fun rank from their work: merges and QA reviews together. */
export function rank(c: CareerView): string {
  const n = c.merged + c.reviews;
  return n >= 40 ? 'Legend' : n >= 15 ? 'Veteran' : n >= 5 ? 'Regular' : 'Rookie';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Mostly reviews other people's work: more QA reviews than merges, and a few of them. */
const mostlyReviews = (c: CareerView) => c.reviews > c.merged && c.reviews >= 3;

/** The career card's one-liner: what they're best known for, picked from the stats. */
export function knownFor(c: CareerView): string {
  if (mostlyReviews(c)) return `QA reviews: ${c.reviews} and counting`;
  if (c.best >= 3) return `First-time QA passes: ${c.best} in a row`;
  const rate = passRate(c);
  if (rate === 1 && c.qaPass >= 3) return `Never failed QA: ${plural(c.qaPass, 'round')} passed`;
  if (c.merged >= 1 && avgFixRounds(c) === 0) return `Clean shipper: ${plural(c.merged, 'PR')} merged without a fix round`;
  if (c.merged >= 1) return `Shipped ${plural(c.merged, 'PR')} so far`;
  if (c.opened >= 1) return 'First PR in review, fingers crossed';
  return 'Fresh on the team: first task coming up';
}

/** The MVP of the week among `people`: most merges in the last 7 days (ties: most merged overall). Null without any. */
export function mvpOfWeek<T extends { career: CareerView | null }>(people: T[], now: number): { who: T; merges: number } | null {
  let best: { who: T; merges: number } | null = null;
  for (const p of people) {
    if (!p.career) continue;
    const merges = mergesThisWeek(p.career, now);
    if (merges === 0) continue;
    if (!best || merges > best.merges || (merges === best.merges && p.career.merged > (best.who.career?.merged ?? 0))) best = { who: p, merges };
  }
  return best;
}

// ---------- the profile (#117) ----------

/** PRs that passed QA on their first round, as a share of those whose first round they saw (0-1), or null before any. */
export function firstRoundRate(c: CareerView): number | null {
  const n = Math.max(c.firstQa, c.firstPass); // records from before firstQa counted only the passes
  return n ? c.firstPass / n : null;
}

/** QA rounds per merged PR, or null before the first merge. */
export const roundsPerMerge = (c: CareerView): number | null => (c.merged ? (c.qaPass + c.qaFail) / c.merged : null);

/** The coding agents' estimated cost per merged PR, or null before the first merge. */
export const costPerMerge = (c: CareerView): number | null => (c.merged ? c.costUsd / c.merged : null);

function median(values: number[]): number | null {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b);
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** The median time from a build's start to its PR (ms), or null before any. */
export const medianToPr = (c: CareerView): number | null => median(c.toPr);

/** The median time from a build's start to its merge (ms), or null before any. */
export const medianToMerge = (c: CareerView): number | null => median(c.toMerge);

/** The profile's badges, earned from the record. */
export function badges(c: CareerView): string[] {
  const out: string[] = [];
  if (c.firstPass >= STAR_PASSES) out.push(`⭐ ${STAR_PASSES} first-time passes`);
  if (c.best >= 3) out.push(`🔥 ${c.best} in a row`);
  if (c.merged >= 1 && c.fixRounds === 0) out.push('✨ Never needed a fix');
  if (mostlyReviews(c)) out.push(`🔍 ${c.reviews} QA reviews`);
  if (c.merged >= 25) out.push('🏆 25 merges');
  return out;
}

/** A profile stat: its value (null before there's any) and whether a higher one is better. */
interface StatDef {
  key: string;
  label: string;
  value: (c: CareerView, now: number) => number | null;
  show: (x: number) => string;
  higher: boolean;
  title: string;
}

const pctText = (x: number) => `${Math.round(x * 100)}%`;

/** "42m", "3.5h", "2d". */
export function durationText(ms: number): string {
  const m = ms / 60_000;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  const h = m / 60;
  return h < 24 ? `${Math.round(h * 10) / 10}h` : `${Math.round((h / 24) * 10) / 10}d`;
}

const PROFILE_STATS: StatDef[] = [
  { key: 'merged', label: 'PRs merged', value: (c) => c.merged, show: String, higher: true, title: 'Pull requests of theirs that merged' },
  { key: 'firstRound', label: 'First-round QA', value: (c) => firstRoundRate(c), show: pctText, higher: true, title: 'PRs that passed QA on their first round' },
  { key: 'rounds', label: 'QA rounds / merge', value: (c) => roundsPerMerge(c), show: (x) => x.toFixed(1), higher: false, title: 'QA rounds their merged PRs took, on average' },
  { key: 'toPr', label: 'Time to PR', value: (c) => medianToPr(c), show: durationText, higher: false, title: 'Median time from starting an issue to its pull request' },
  { key: 'toMerge', label: 'Time to merge', value: (c) => medianToMerge(c), show: durationText, higher: false, title: 'Median time from starting an issue to its merge' },
  { key: 'cost', label: 'Cost / merge', value: (c) => costPerMerge(c), show: (x) => `$${x.toFixed(2)}`, higher: false, title: 'Estimated, as the coding agents report it; subscription usage is billed by plan' },
  { key: 'waste', label: 'Waste', value: (c) => wasteShare(c), show: pctText, higher: false, title: 'Share of their spend on sessions that came to nothing (no PR, no commit, stopped by the watchdog or the usage limit)' },
  { key: 'week', label: 'Merged this week', value: (c, now) => mergesThisWeek(c, now), show: String, higher: true, title: 'Merges in the last 7 days' },
  { key: 'streak', label: 'Best streak', value: (c) => c.best, show: String, higher: true, title: 'PRs in a row that passed QA first time' },
  { key: 'reviews', label: 'QA reviews', value: (c) => c.reviews, show: String, higher: true, title: "Other people's pull requests they tested" },
];

/** The mean of a stat over a floor's careers, skipping those without it yet; null when none has it. */
function floorAverage(careers: CareerView[], stat: Pick<StatDef, 'value'>, now: number): number | null {
  const xs = careers.map((c) => stat.value(c, now)).filter((x): x is number => x !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export type Verdict = 'better' | 'worse' | 'even';

/** How a value compares with the floor's average: within 5% (or both 0) is even. Null without both. */
export function compareToFloor(value: number | null, avg: number | null, higherIsBetter: boolean): Verdict | null {
  if (value === null || avg === null) return null;
  const gap = value - avg;
  if (Math.abs(gap) <= Math.abs(avg) * 0.05 || gap === 0) return 'even';
  return gap > 0 === higherIsBetter ? 'better' : 'worse';
}

export interface ProfileStat {
  key: string;
  label: string;
  title: string;
  /** The value as shown, '—' before there's any. */
  text: string;
  verdict: Verdict | null;
  /** "↑ better than floor 1's 0.8", or '' with nothing to compare. */
  vsFloor: string;
}

/** The profile's stat grid: each stat of `c`, compared with the average over `floor` (everyone on their floor, them included). */
export function profileStats(c: CareerView, floor: CareerView[], floorNumber: number, now: number): ProfileStat[] {
  return PROFILE_STATS.map((d) => {
    const v = d.value(c, now);
    const avg = floor.length > 1 ? floorAverage(floor, d, now) : null;
    const verdict = compareToFloor(v, avg, d.higher);
    const vsFloor = verdict === null ? '' : `${verdict === 'better' ? '↑ better than' : verdict === 'worse' ? '↓ under' : '= same as'} floor ${floorNumber}'s ${d.show(Math.round(avg! * 100) / 100)}`;
    return { key: d.key, label: d.label, title: d.title, text: v === null ? '—' : d.show(v), verdict, vsFloor };
  });
}

/** The team list's two or three key stats, as one short line ("3 merged this week · 80% first-round QA · $1.20 / merge"). */
export function keyStats(c: CareerView, now: number): string {
  const rate = firstRoundRate(c);
  const cost = costPerMerge(c);
  return [`${mergesThisWeek(c, now)} merged this week`, rate !== null && `${pctText(rate)} first-round QA`, cost !== null && `$${cost.toFixed(2)} / merge`].filter(Boolean).join(' · ');
}

// ---------- usage and cost (#205) ----------

/** This week's totals (from Monday, UTC). */
export const thisWeek = (c: CareerView, now: number): CareerWeek => weekIn(c, weekOf(now));

const weekIn = (c: CareerView, w: number): CareerWeek => {
  const row = c.weeks.find((r) => r[0] === w);
  return row ? weekOfRow(row) : emptyWeek(w);
};

/** One value per week over the last `weeks` weeks before `now`, oldest first. */
function series<T>(c: CareerView, now: number, pick: (k: CareerWeek) => T, weeks = WEEKS): T[] {
  const top = weekOf(now);
  return Array.from({ length: weeks }, (_, i) => {
    return pick(weekIn(c, top - weeks + 1 + i));
  });
}

/** The profile's 8-week sparklines: merges, cost per merge and first-round QA, oldest first (null: no data that week). */
export const weeklySeries = (c: CareerView, now: number) => ({
  merges: series(c, now, (k) => k.merged),
  costPerMerge: series(c, now, (k) => (k.merged ? k.usd / k.merged : null)),
  firstPass: series(c, now, (k) => (k.firstQa ? k.firstPass / k.firstQa : null)),
});

/** What sessions that came to nothing cost, as a share of everything they spent (0-1), or null before any spend. */
export const wasteShare = (c: CareerView): number | null => (c.costUsd > 0 ? Math.min(1, c.wasteUsd / c.costUsd) : null);

/** Time in sessions and time on the team outside them (ms), over every stint. */
export function workIdle(c: CareerView, now: number): { work: number; idle: number } {
  const tenure = tenureMs(c, now);
  const work = Math.min(c.workMs, tenure);
  return { work, idle: tenure - work };
}

/** Their share of everyone's spend this week (0-1), or null when nobody has spent anything yet. */
export function spendShare(c: CareerView, everyone: CareerView[], now: number): number | null {
  const total = everyone.reduce((n, x) => n + thisWeek(x, now).usd, 0);
  return total > 0 ? thisWeek(c, now).usd / total : null;
}

type HighlightKey = 'mvp' | 'cheapest' | 'firstPass' | 'reviews' | 'waste' | 'idle';

/** A card in the Team tab's highlights row: who and why. */
export interface Highlight {
  key: HighlightKey;
  label: string;
  agentId: string;
  name: string;
  text: string;
}

/** First-round QA counts for the highlight from this many PRs on. */
const FIRST_PASS_MIN = 3;

/**
 * The Team tab's highlights (#205): MVP of the week, cheapest per merge, best first-round QA, most reviews, biggest
 * waste, and who has been idle the longest (`idleSince`: when their last task ended, null while working). Cards
 * without a candidate are left out.
 */
export function highlights<T extends { id: string; name: string; career: CareerView | null; idleSince: number | null }>(people: T[], now: number): Highlight[] {
  const out: Highlight[] = [];
  const withCareer = people.filter((p): p is T & { career: CareerView } => !!p.career);
  const top = (label: string, key: HighlightKey, score: (p: T & { career: CareerView }) => number | null, text: (p: T & { career: CareerView }, x: number) => string, lowest = false) => {
    let best: { p: T & { career: CareerView }; x: number } | null = null;
    for (const p of withCareer) {
      const x = score(p);
      if (x === null || !Number.isFinite(x)) continue;
      if (!best || (lowest ? x < best.x : x > best.x)) best = { p, x };
    }
    if (best) out.push({ key, label, agentId: best.p.id, name: best.p.name, text: text(best.p, best.x) });
  };
  const mvp = mvpOfWeek(withCareer, now);
  if (mvp) out.push({ key: 'mvp', label: 'MVP of the week', agentId: mvp.who.id, name: mvp.who.name, text: plural(mvp.merges, 'merge') + ' this week' });
  top('Cheapest per merge', 'cheapest', (p) => costPerMerge(p.career), (_p, x) => `$${x.toFixed(2)} / merge`, true);
  top('Best first-round QA', 'firstPass', (p) => (Math.max(p.career.firstQa, p.career.firstPass) >= FIRST_PASS_MIN ? firstRoundRate(p.career) : null), (p, x) => `${pctText(x)} of ${Math.max(p.career.firstQa, p.career.firstPass)} PRs`);
  top('Most reviews', 'reviews', (p) => p.career.reviews || null, (_p, x) => plural(x, 'QA review'));
  top('Biggest waste', 'waste', (p) => p.career.wasteUsd || null, (p, x) => `$${x.toFixed(2)} on ${plural(p.career.wasted, 'session')} that came to nothing`);
  top('Idle the longest', 'idle', (p) => (p.idleSince === null ? null : now - p.idleSince), (_p, x) => `idle for ${durationText(x)}`);
  return out;
}

// ---------- the desk ----------

export type DeskToy = 'duck' | 'speaker' | 'cradle' | 'magnifier';

/** What their desk shows: plaques for merged PRs, the gold star and the personal items tenure brings. */
export interface DeskItems {
  /** PR numbers on the plaques, newest first (up to PLAQUES). */
  plaques: number[];
  /** Merged PRs beyond the plaques shown, for the "+N" plaque. */
  more: number;
  /** Ten first-time QA passes. */
  star: boolean;
  /** How tall the desk plant has grown (1: as it arrived). */
  plant: number;
  /** A framed photo, after a day on the team. */
  photo: boolean;
  /** A desk toy of their own, after three days. */
  toy: DeskToy | null;
}

export const PLAQUES = 8;
export const STAR_PASSES = 10;
export const PHOTO_DAYS = 1;
export const TOY_DAYS = 3;

const TOYS: DeskToy[] = ['duck', 'speaker', 'cradle'];

/** Their desk toy: the magnifying glass for someone who mostly reviews, else one picked from their id (the same every time). */
export function deskToy(agentId: string, c: CareerView | null = null): DeskToy {
  if (c && mostlyReviews(c)) return 'magnifier';
  let h = 0;
  for (const ch of agentId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TOYS[h % TOYS.length];
}

/** The plant grows from 0.7 to 1.6 times its size over its owner's first week. */
export const plantGrowth = (days: number) => Math.min(1.6, 0.7 + 0.13 * Math.max(0, days));

export function deskItems(c: CareerView, agentId: string, now: number): DeskItems {
  const days = tenureDays(c, now);
  const plaques = c.recent.slice(0, PLAQUES).map(([n]) => n);
  return {
    plaques,
    more: Math.max(0, c.merged - plaques.length),
    star: c.firstPass >= STAR_PASSES,
    plant: plantGrowth(days),
    photo: days >= PHOTO_DAYS,
    toy: days >= TOY_DAYS ? deskToy(agentId, c) : null,
  };
}
