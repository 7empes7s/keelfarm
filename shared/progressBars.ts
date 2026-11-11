// Progress bars (#140): what every bar and ring in the office shows, as pure functions of state the tab already has
// (the snapshot and the cost view). A task's stage (build → PR → QA → fix → merge) and its time against the floor's
// median, a floor's backlog split, an objective's and the focus's progress, the batches of issues the CEO filed
// together, the limits (memory, today's spend) and the steps of things that start (a preview, the office's update).
// client/src/ui/ProgressBar.tsx draws them.

import type { ObjectiveInsight } from './charterStats.ts';
import type { MemoryReading } from './health.ts';
import { blockers } from './issues.ts';
import type { AgentStatus, AgentTask, OfficeUpdateState, PreviewStatus, QaStatus } from './types.ts';

/** A bar's colour: good, warn and bad from the state tokens; neutral is the accent. */
export type BarTone = 'good' | 'warn' | 'bad' | 'neutral';

/** One part of a stacked bar. */
export interface BarPart { key: string; label: string; value: number }

const DAY_MS = 24 * 3600_000;

// ---------- a task ----------

export const TASK_STAGES = ['build', 'pr', 'qa', 'fix', 'merge'] as const;
export type TaskStage = (typeof TASK_STAGES)[number];
export const STAGE_LABELS: Record<TaskStage, string> = { build: 'Build', pr: 'PR', qa: 'QA', fix: 'Fix', merge: 'Merge' };

export interface TaskInput {
  task: AgentTask | null;
  status?: AgentStatus;
  prNumber: number | null;
  qa?: { status: QaStatus; round: number } | null;
  merged?: boolean;
}

export interface TaskProgress {
  /** The stage it's in (an index into TASK_STAGES); TASK_STAGES.length once merged. */
  at: number;
  tone: BarTone;
  /** What the stage says, e.g. "QA round 2". */
  label: string;
}

/** Where a task stands on build → PR → QA → fix → merge; null for no task. */
export function taskStage(t: TaskInput): TaskProgress | null {
  const stuck: BarTone | null = t.status === 'error' ? 'bad' : t.status === 'stopped' ? 'warn' : null;
  if (t.merged) return { at: TASK_STAGES.length, tone: 'good', label: 'Merged' };
  const qa = t.qa;
  if (qa) {
    if (qa.status === 'passed') return { at: 4, tone: 'good', label: 'Ready to merge' };
    if (qa.status === 'failed' || qa.status === 'fixing') return { at: 3, tone: stuck ?? (qa.status === 'failed' ? 'warn' : 'neutral'), label: `Fix after QA round ${qa.round}` };
    if (qa.status === 'needs-human') return { at: 2, tone: 'bad', label: `Needs you after QA round ${qa.round}` };
    return { at: 2, tone: stuck ?? 'neutral', label: qa.status === 'queued' ? `Waiting for QA round ${qa.round}` : `QA round ${qa.round}` };
  }
  if (t.task === 'fix') return { at: 3, tone: stuck ?? 'neutral', label: 'Fix' };
  if (t.task === 'qa') return { at: 2, tone: stuck ?? 'neutral', label: 'QA' };
  if (t.prNumber != null) return { at: 1, tone: stuck ?? 'neutral', label: 'PR open, waiting for QA' };
  if (t.task === 'issue') return { at: 0, tone: stuck ?? 'neutral', label: stuck === 'bad' ? 'Build stuck' : 'Build' };
  return null;
}

export interface Pace {
  elapsedMs: number;
  medianMs: number;
  /** elapsed / median. */
  ratio: number;
  tone: BarTone;
}

/** A task's time so far against the floor's median (issue → merge): warn past it, bad past twice it; null without a median. */
export function leadPace(sinceMs: number | null, now: number, medianMs: number | null): Pace | null {
  if (sinceMs === null || !medianMs || medianMs <= 0) return null;
  const elapsedMs = Math.max(0, now - sinceMs);
  const ratio = elapsedMs / medianMs;
  return { elapsedMs, medianMs, ratio, tone: ratio > 2 ? 'bad' : ratio > 1 ? 'warn' : 'neutral' };
}

/** A span on a card: "12m", "9h 31m", "3d". */
function spanText(ms: number): string {
  const m = Math.round(Math.max(0, ms) / 60_000);
  return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.round(m / 1440)}d`;
}

const agoText = (ms: number) => {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};

export interface TimesInput {
  /** When it was asked for: the issue filed (a PR card: the PR opened). */
  askedAt: number | null;
  /** When the current agent started this step (build, QA or fix); null while nobody is on it. */
  workingSince: number | null;
  now: number;
  medianMs: number | null;
  pr?: boolean;
  /** What the working part says: "working", "testing", "fixing". */
  step?: string;
}

export interface TaskTimes {
  /** "Asked 9h ago · working 12m", plus "· 1.4× median 2h 55m" once the working time is past the median; null with neither time. */
  text: string | null;
  aria: string | null;
  /** Only ever from the working time, so time spent waiting never turns a card red. */
  pace: Pace | null;
}

/** A card's two times (#349): when it was asked for, and how long the current agent has been on it, paced against the floor's median. */
export function taskTimes(t: TimesInput): TaskTimes {
  const asked = t.askedAt != null ? `${t.pr ? 'PR opened' : 'Asked'} ${agoText(t.now - t.askedAt)}` : null;
  const step = t.step ?? 'working';
  const working = t.workingSince != null ? spanText(t.now - t.workingSince) : null;
  const pace = leadPace(t.workingSince, t.now, t.medianMs);
  const over = pace && pace.ratio > 1 ? pace : null;
  const parts = [asked, working && `${step} ${working}`, over && `${over.ratio.toFixed(1)}× median ${spanText(over.medianMs)}`].filter(Boolean);
  const words = [asked, working && `${step} for ${working}`, over && `${over.ratio.toFixed(1)} times the floor's median of ${spanText(over.medianMs)}`].filter(Boolean);
  return { text: parts.length ? parts.join(' · ') : null, aria: words.length ? words.join(', ') : null, pace };
}

// ---------- a floor's backlog ----------

export interface BacklogInput {
  issues: { number: number; body: string; labels: string[] }[];
  pulls: { number: number; state: 'OPEN' | 'CLOSED' | 'MERGED'; mergedAt: string | null; closesIssues: number[] }[];
  held: { issue: number }[];
  /** Issues an agent is building that have no PR yet. */
  building: number[];
  now: number;
}

export interface BacklogSplit {
  done: number[]; // PRs merged in the last 7 days
  progress: number[]; // open PRs, and issues being built without one
  ready: number[]; // open issues that can start
  waiting: number[]; // open issues waiting on another, held for the manager, or skipped
  /** Merges per day over the last 7 days, oldest first (today last). */
  trend: number[];
}

const SKIP = /^(swarm:skip|wontfix|question)$/i;

/** The issues a floor's agents are building that have no PR yet (BacklogInput.building). */
export const buildingOf = (agents: { role: string; task: AgentTask | null; status: AgentStatus; issueNumber: number | null; prNumber: number | null }[]) =>
  agents.filter((a) => a.role !== 'ceo' && a.task === 'issue' && a.status !== 'idle' && a.issueNumber != null && a.prNumber == null).map((a) => a.issueNumber!);

/** A floor's work as done / in progress / ready / waiting, with merges per day for the week. */
export function backlogSplit(b: BacklogInput): BacklogSplit {
  const open = new Set(b.issues.map((i) => i.number));
  const openPulls = b.pulls.filter((p) => p.state === 'OPEN');
  const claimed = new Set([...b.building, ...openPulls.flatMap((p) => p.closesIssues)]);
  const held = new Set(b.held.map((h) => h.issue));
  const ready: number[] = [];
  const waiting: number[] = [];
  for (const i of b.issues) {
    if (claimed.has(i.number)) continue;
    if (held.has(i.number) || i.labels.some((l) => SKIP.test(l)) || blockers(i.body, open).length) waiting.push(i.number);
    else ready.push(i.number);
  }
  const trend = Array.from({ length: 7 }, () => 0);
  const done: number[] = [];
  const today = new Date(b.now);
  today.setHours(0, 0, 0, 0);
  for (const p of b.pulls) {
    if (p.state !== 'MERGED' || !p.mergedAt) continue;
    const at = Date.parse(p.mergedAt);
    const day = at >= today.getTime() ? 0 : Math.ceil((today.getTime() - at) / DAY_MS); // days ago, 0: today
    if (day > 6) continue;
    done.push(p.number);
    trend[6 - day]++;
  }
  const building = b.building.filter((n) => !openPulls.some((p) => p.closesIssues.includes(n)));
  return { done, progress: [...openPulls.map((p) => p.number), ...building], ready, waiting, trend };
}

/** The split as a stacked bar's parts, in its order. */
export const backlogParts = (s: BacklogSplit): BarPart[] => [
  { key: 'done', label: 'Done this week', value: s.done.length },
  { key: 'progress', label: 'In progress', value: s.progress.length },
  { key: 'ready', label: 'Ready', value: s.ready.length },
  { key: 'waiting', label: 'Waiting', value: s.waiting.length },
];

// ---------- objectives ----------

export interface ObjectiveProgress {
  merged: number[]; // PRs naming it, merged in the last 30 days
  progress: number[];
  ready: number[];
  waiting: number[];
  /** merged / (merged + open issues); null with nothing either way. */
  share: number | null;
}

const sumUp = (merged: number[], open: ObjectiveInsight['open']): ObjectiveProgress => {
  const total = merged.length + open.progress.length + open.ready.length + open.waiting.length;
  return { merged, progress: open.progress, ready: open.ready, waiting: open.waiting, share: total ? merged.length / total : null };
};

/** An objective's progress: what merged under it in 30 days against its open issues. */
export const objectiveProgress = (o: ObjectiveInsight): ObjectiveProgress => sumUp(o.byWindow[30].prs, o.open);

/** The current focus's progress: its objectives' together (each PR or issue once); null when it names none. */
export function focusProgress(objectives: ObjectiveInsight[], focus: string[]): ObjectiveProgress | null {
  const named = objectives.filter((o) => focus.includes(o.id));
  if (!named.length) return null;
  const uniq = (pick: (o: ObjectiveInsight) => number[]) => [...new Set(named.flatMap(pick))];
  return sumUp(uniq((o) => o.byWindow[30].prs), { progress: uniq((o) => o.open.progress), ready: uniq((o) => o.open.ready), waiting: uniq((o) => o.open.waiting) });
}

export const objectiveParts = (p: ObjectiveProgress): BarPart[] => [
  { key: 'merged', label: 'Merged', value: p.merged.length },
  { key: 'progress', label: 'In progress', value: p.progress.length },
  { key: 'ready', label: 'Ready', value: p.ready.length },
  { key: 'waiting', label: 'Waiting', value: p.waiting.length },
];

// ---------- plans: issues the CEO filed together ----------

/** The footer the CEO's create_issue adds (server/swarm/ceoTools.ts). */
const CEO_FILED = /_Filed by .+, the cubefarm CEO\._\s*$/;
/** Issues filed less than this apart belong to one batch. */
const BATCH_GAP_MS = 20 * 60_000;
/** A batch is a plan from this many issues. */
const BATCH_MIN = 3;

export interface PlanBatch {
  /** Their shared title prefix ("UX round 7"), else when they were filed. */
  name: string;
  filedAt: number;
  merged: number[]; // PRs merged for issues filed in the batch's window
  progress: number[]; // the batch's open issues with an open PR or someone building them
  open: number[]; // the rest of its open issues
  total: number;
}

const prefixOf = (titles: string[]) => {
  const heads = titles.map((t) => t.match(/^([^:]{2,60}):/)?.[1].trim() ?? null);
  return heads[0] && heads.every((h) => h === heads[0]) ? heads[0] : null;
};

/**
 * The batches of issues the CEO filed together on a floor (each within BATCH_GAP_MS of the next) that still have open
 * issues, newest first. A merged PR counts towards the batch whose window holds the time its issue was filed.
 */
export function planBatches(
  issues: { number: number; title: string; body: string; createdAt: string }[],
  pulls: { number: number; state: string; closesIssues: number[]; issueCreatedAt?: string | null }[],
  busy: Set<number>,
): PlanBatch[] {
  const filed = issues
    .filter((i) => CEO_FILED.test(i.body ?? ''))
    .map((i) => ({ ...i, at: Date.parse(i.createdAt) }))
    .filter((i) => Number.isFinite(i.at))
    .sort((a, b) => a.at - b.at);
  const groups: (typeof filed)[] = [];
  for (const i of filed) {
    const last = groups[groups.length - 1];
    if (last && i.at - last[last.length - 1].at < BATCH_GAP_MS) last.push(i);
    else groups.push([i]);
  }
  const claimed = new Set([...busy, ...pulls.filter((p) => p.state === 'OPEN').flatMap((p) => p.closesIssues)]);
  const out: PlanBatch[] = [];
  for (const g of groups) {
    const from = g[0].at - BATCH_GAP_MS;
    const to = g[g.length - 1].at + BATCH_GAP_MS;
    const merged = pulls
      .filter((p) => p.state === 'MERGED' && p.issueCreatedAt)
      .filter((p) => {
        const at = Date.parse(p.issueCreatedAt!);
        return at >= from && at <= to;
      })
      .map((p) => p.number);
    const progress = g.filter((i) => claimed.has(i.number)).map((i) => i.number);
    const open = g.filter((i) => !claimed.has(i.number)).map((i) => i.number);
    const total = merged.length + g.length;
    if (total < BATCH_MIN) continue;
    const prefix = prefixOf(g.map((i) => i.title));
    out.push({ name: prefix ?? `${total} issues filed together`, filedAt: g[0].at, merged, progress, open, total });
  }
  return out.reverse();
}

// ---------- limits ----------

export interface Limit {
  /** 0..1 of the bar filled. */
  pct: number;
  tone: BarTone;
}

/** Memory in use on this computer, toned like the health strip: bad under the headroom kept free, warn under twice it. */
export function memoryLimit(m: Pick<MemoryReading, 'totalMb' | 'availableMb' | 'swapFreeMb'>, headroomMb: number): Limit {
  const free = m.availableMb + m.swapFreeMb;
  const pct = m.totalMb > 0 ? Math.min(1, Math.max(0, (m.totalMb - m.availableMb) / m.totalMb)) : 0;
  return { pct, tone: free < headroomMb ? 'bad' : free < headroomMb * 2 ? 'warn' : 'good' };
}

/** Today's spend against the daily average (shared/costs.ts spendVsAverage): full at the average, warn past it, bad past 1.5×. */
export function spendLimit(s: { usd: number; avg: number }): Limit | null {
  if (s.avg <= 0) return null;
  const ratio = s.usd / s.avg;
  return { pct: Math.min(1, ratio), tone: ratio > 1.5 ? 'bad' : ratio > 1 ? 'warn' : 'good' };
}

// ---------- things starting ----------

export interface Steps {
  labels: string[];
  /** The step running now (labels.length when all are done). */
  at: number;
  tone: BarTone;
}

const PREVIEW_STEPS: [PreviewStatus, string][] = [
  ['preparing', 'Check out'],
  ['installing', 'Install'],
  ['starting', 'Start'],
];

/** A preview's start as three steps; null when it isn't starting. */
export function previewSteps(status: PreviewStatus): Steps | null {
  const at = status === 'running' ? PREVIEW_STEPS.length : PREVIEW_STEPS.findIndex(([s]) => s === status);
  return at < 0 ? null : { labels: PREVIEW_STEPS.map(([, l]) => l), at, tone: at === PREVIEW_STEPS.length ? 'good' : 'neutral' };
}

const UPDATE_STEPS = ['Found', 'Settling', 'Draining', 'Check & restart'];
const UPDATE_AT: Partial<Record<OfficeUpdateState, number>> = { available: 0, waiting: 1, settling: 1, draining: 2, updating: 3 };

/** The office's own update as steps (the launcher's preflight and probation are the last); null when there is none. */
export function updateSteps(state: OfficeUpdateState): Steps | null {
  if (state === 'failed') return { labels: UPDATE_STEPS, at: UPDATE_STEPS.length - 1, tone: 'bad' };
  const at = UPDATE_AT[state];
  return at === undefined ? null : { labels: UPDATE_STEPS, at, tone: 'neutral' };
}
