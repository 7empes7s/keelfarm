// The problems register (#544): every problem of work, infrastructure and process in one list, recorded in plain code
// from what the office already knows (failed QA rounds by cause, PRs needing a human or failing QA 3+ times, agents
// stuck on errors, issues blocked over a day, sessions without a result) beside IT's tickets (#542, shown here as
// infrastructure), plus what the CEO notes by hand. De-duplicated by a key, worst first by time and dollars lost,
// grouped by cause and floor, recurring ones flagged, and a daily digest. Pure: server/swarm/problems.ts keeps them,
// Settings → Problems and the chat's digest card draw them.
import { wasteReason, type CostSession } from './costs.ts';
import type { ItTicket } from './itTickets.ts';

type ProblemKind = 'infrastructure' | 'work' | 'process';
export const PROBLEM_OWNERS = ['manager', 'ceo', 'agents', 'it'] as const;
export const PROBLEM_STATES = ['open', 'in-progress', 'resolved', 'wont-fix'] as const;
export type ProblemOwner = (typeof PROBLEM_OWNERS)[number];
export type ProblemState = (typeof PROBLEM_STATES)[number];

/** Work causes the office records itself. */
const WORK_CAUSES = ['bug', 'nit', 'spec-missing', 'conflict', 'checks', 'needs-human', 'qa-3x', 'agent-error', 'blocked', 'waste'] as const;
/** What the CEO or IT notes by hand. */
export const PROCESS_CAUSES = ['vague-brief', 'missing-check', 'process'] as const;
/** IT tickets' where (shared/itTickets.ts TICKET_WHERE). */
const INFRA_CAUSES = ['lab', 'preview', 'ports', 'disk', 'sign-in', 'ci', 'network', 'other'] as const;
export type ProblemCause = (typeof WORK_CAUSES)[number] | (typeof PROCESS_CAUSES)[number] | (typeof INFRA_CAUSES)[number];

export const CAUSE_LABELS: Record<ProblemCause, string> = {
  bug: 'Bugs QA found',
  nit: 'Nits',
  'spec-missing': 'Tests missing',
  conflict: 'Merge conflicts',
  checks: 'CI red',
  'needs-human': 'PRs needing a human',
  'qa-3x': 'PRs failing QA 3+ times',
  'agent-error': 'Agents stuck on errors',
  blocked: 'Issues blocked over a day',
  waste: 'Sessions without a result',
  'vague-brief': 'Vague briefs',
  'missing-check': 'Missing QA checks',
  process: 'Process',
  lab: 'Test lab',
  preview: 'Previews',
  ports: 'Ports',
  disk: 'Disk',
  'sign-in': 'Sign-in screens',
  ci: 'CI',
  network: 'Network',
  other: 'Other office trouble',
};

export const OWNER_LABELS: Record<ProblemOwner, string> = { manager: 'You', ceo: 'The CEO', agents: "The floor's agents", it: 'IT' };
export const STATE_LABELS: Record<ProblemState, string> = { open: 'Open', 'in-progress': 'In progress', resolved: 'Resolved', 'wont-fix': "Won't fix" };

export interface Problem {
  id: string; // 'p<n>', or 't<n>' for an IT ticket
  kind: ProblemKind;
  cause: ProblemCause;
  title: string;
  detail?: string;
  floor: number | null;
  repoId: string | null;
  pr: number | null;
  issue: number | null;
  agentId: string | null;
  agentName?: string;
  at: number;
  lastAt: number;
  count: number; // times it happened, joined into this entry
  lostMs: number; // time lost (sessions' run time; an ongoing one also counts while it's open)
  lostUsd: number; // dollars lost (sessions' cost)
  ongoing?: true; // its lost time runs from `at` until it's resolved (a PR waiting, an agent stuck)
  owner: ProblemOwner;
  state: ProblemState;
  resolution?: string;
  resolvedAt?: number;
  needsYou?: true; // a decision only the manager can make
  key?: string; // what makes two reports the same problem (always set in the office; tabs get entries without it)
}

export interface ProblemsState {
  seq: number;
  list: Problem[]; // newest first
  digestDay: string; // the last daily digest's day
}

/** What a source gives: the rest is filled in by recordProblem. */
export type ProblemInput = Pick<Problem, 'kind' | 'cause' | 'title' | 'floor' | 'repoId' | 'pr' | 'issue' | 'agentId' | 'owner'> & { key: string } & Partial<Pick<Problem, 'detail' | 'agentName' | 'lostMs' | 'lostUsd' | 'ongoing' | 'needsYou'>>;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Work problems with no repeat for this long resolve by themselves. */
const PROBLEM_IDLE_MS = 3 * DAY;
/** An issue blocked by its dependencies longer than this is a problem. */
export const BLOCKED_MS = DAY;
/** How the ranking weighs a dollar against minutes lost. */
const USD_MINUTES = 30;
const KEPT = 80;
const TITLE_MAX = 200;
const DETAIL_MAX = 600;

export const emptyProblems = (): ProblemsState => ({ seq: 0, list: [], digestDay: '' });
export const isOpen = (p: Pick<Problem, 'state'>) => p.state === 'open' || p.state === 'in-progress';

// ---------- the sources ----------

type Where = { floor: number | null };
const ROUND_CAUSES = new Set<string>(['bug', 'nit', 'spec-missing', 'conflict', 'checks']);
const ROUND_TITLES: Record<string, string> = { bug: 'QA found bugs', nit: 'QA sent it back for nits', 'spec-missing': 'QA found a test missing', conflict: 'Merge conflict', checks: 'CI red' };

/** A finished session: a failed QA round or a fix by its cause, else a session that ended without a result. Lab errors and CI outages are IT's tickets. */
export function sessionProblem(s: CostSession, w: Where): ProblemInput | null {
  const base = { floor: s.repoId ? w.floor : null, repoId: s.repoId || null, pr: s.pr, issue: s.issue, agentId: s.agentId, agentName: s.agent, lostMs: s.ms, lostUsd: s.usd };
  const round = (s.kind === 'qa' && s.outcome === 'qa-fail') || s.kind.startsWith('fix-');
  if (round && s.cause && ROUND_CAUSES.has(s.cause) && s.pr !== null) {
    return { ...base, kind: 'work', cause: s.cause as ProblemCause, owner: 'agents', title: `${ROUND_TITLES[s.cause]} on PR #${s.pr}`, key: `round:${s.cause}:${s.repoId}#${s.pr}` };
  }
  const why = wasteReason(s);
  if (!why || s.outcome === 'qa-fail') return null; // a failed round past the 2nd without a cause: its round is the problem
  const work = s.issue !== null ? `issue #${s.issue}` : s.pr !== null ? `PR #${s.pr}` : s.kind;
  return { ...base, kind: 'work', cause: 'waste', owner: s.kind.startsWith('ceo-') ? 'ceo' : 'agents', title: `${work}: ${why}`, key: `waste:${s.repoId}:${work}` };
}

interface QaFacts {
  repoId: string;
  prNumber: number;
  issueNumber: number | null;
  stuckWhy: string | null;
  escalated: boolean;
}

/** A PR the office can't move: the CEO's while it triages, the manager's once escalated. */
export const needsHumanProblem = (q: QaFacts, w: Where): ProblemInput => ({
  kind: 'work', cause: 'needs-human', floor: w.floor, repoId: q.repoId, pr: q.prNumber, issue: q.issueNumber, agentId: null, ongoing: true,
  owner: q.escalated ? 'manager' : 'ceo', ...(q.escalated && { needsYou: true as const }),
  title: `PR #${q.prNumber} needs a human`, ...(q.stuckWhy && { detail: q.stuckWhy }), key: `needs-human:${q.repoId}#${q.prNumber}`,
});

/** A PR failing QA 3 times or more. */
export const qaRepeatProblem = (q: QaFacts, rounds: number, w: Where): ProblemInput => ({
  kind: 'work', cause: 'qa-3x', floor: w.floor, repoId: q.repoId, pr: q.prNumber, issue: q.issueNumber, agentId: null, owner: 'ceo',
  title: `PR #${q.prNumber} failed QA ${rounds} times`, key: `qa-3x:${q.repoId}#${q.prNumber}`,
});

/** An agent stuck on an error (Mission control's alarm). */
export const agentErrorProblem = (a: { id: string; name: string; error: string | null; repoId: string; issue: number | null }, w: Where): ProblemInput => ({
  kind: 'work', cause: 'agent-error', floor: w.floor, repoId: a.repoId, pr: null, issue: a.issue, agentId: a.id, agentName: a.name, ongoing: true, owner: 'ceo',
  title: `${a.name} is stuck on an error`, ...(a.error && { detail: a.error.slice(0, DETAIL_MAX) }), key: `agent-error:${a.id}`,
});

/** An issue waiting on its dependencies longer than BLOCKED_MS. */
export const blockedProblem = (i: { repoId: string; number: number; blockers: number[] }, w: Where): ProblemInput => ({
  kind: 'work', cause: 'blocked', floor: w.floor, repoId: i.repoId, pr: null, issue: i.number, agentId: null, ongoing: true, owner: 'ceo',
  title: `Issue #${i.number} waits on ${i.blockers.map((b) => `#${b}`).join(', ')}`, key: `blocked:${i.repoId}#${i.number}`,
});

/** note_problem's input, checked; errors say what to fix. */
export function noteInput(raw: { cause?: unknown; title?: unknown; detail?: unknown; owner?: unknown }, where: { floor: number | null; repoId: string | null; pr?: number | null; issue?: number | null }): ProblemInput {
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, TITLE_MAX) : '';
  if (!title) throw new Error('Say what the problem is in a line (title).');
  const cause = PROCESS_CAUSES.includes(raw.cause as (typeof PROCESS_CAUSES)[number]) ? (raw.cause as ProblemCause) : 'process';
  const owner = PROBLEM_OWNERS.includes(raw.owner as ProblemOwner) ? (raw.owner as ProblemOwner) : 'ceo';
  const detail = typeof raw.detail === 'string' ? raw.detail.trim().slice(0, DETAIL_MAX) : '';
  const k = title.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  return { kind: 'process', cause, title, floor: where.floor, repoId: where.repoId, pr: where.pr ?? null, issue: where.issue ?? null, agentId: null, owner, ...(owner === 'manager' && { needsYou: true as const }), ...(detail && { detail }), key: `process:${cause}:${where.floor ?? ''}:${k}` };
}

// ---------- the register ----------

/** Records a problem: joins the open one with its key (counting it again and adding what was lost), else a new entry. */
export function recordProblem(s: ProblemsState, input: ProblemInput, now: number): { problem: Problem; joined: boolean } {
  const open = s.list.find((p) => isOpen(p) && p.key === input.key);
  if (open) {
    open.count++;
    open.lastAt = now;
    open.lostMs += input.lostMs ?? 0;
    open.lostUsd += input.lostUsd ?? 0;
    open.owner = input.owner;
    if (input.detail) open.detail = input.detail;
    if (input.needsYou) open.needsYou = true;
    else delete open.needsYou;
    return { problem: open, joined: true };
  }
  const { lostMs = 0, lostUsd = 0, ...rest } = input;
  const problem: Problem = { ...rest, id: `p${++s.seq}`, title: rest.title.slice(0, TITLE_MAX), at: now, lastAt: now, count: 1, lostMs, lostUsd, state: 'open' };
  s.list.unshift(problem);
  return { problem, joined: false };
}

/** Resolves the open problems `match` picks with `resolution`; returns them. An ongoing one's time is booked now. */
export function resolveProblems(s: ProblemsState, match: (p: Problem) => boolean, resolution: string, now: number): Problem[] {
  const done = s.list.filter((p) => isOpen(p) && match(p));
  for (const p of done) {
    if (p.ongoing) p.lostMs += now - p.at;
    delete p.ongoing;
    delete p.needsYou;
    Object.assign(p, { state: 'resolved', resolution: resolution.slice(0, DETAIL_MAX), resolvedAt: now });
  }
  return done;
}

/** The CEO's or IT's change to one entry: its state (with what was done), its owner. */
export function updateProblem(s: ProblemsState, id: string, patch: { state?: unknown; owner?: unknown; resolution?: unknown }, now: number): Problem {
  if (/^t\d+$/.test(id)) throw new Error(`${id} is IT ticket #${id.slice(1)}: IT answers and closes it.`);
  const p = s.list.find((x) => x.id === id);
  if (!p) throw new Error(`No problem ${id}: problems lists them.`);
  const state = patch.state === undefined ? undefined : PROBLEM_STATES.includes(patch.state as ProblemState) ? (patch.state as ProblemState) : null;
  if (state === null) throw new Error(`state is one of ${PROBLEM_STATES.join(', ')}.`);
  const owner = patch.owner === undefined ? undefined : PROBLEM_OWNERS.includes(patch.owner as ProblemOwner) ? (patch.owner as ProblemOwner) : null;
  if (owner === null) throw new Error(`owner is one of ${PROBLEM_OWNERS.join(', ')}.`);
  const resolution = typeof patch.resolution === 'string' ? patch.resolution.trim().slice(0, DETAIL_MAX) : '';
  if ((state === 'resolved' || state === 'wont-fix') && !resolution) throw new Error('Say what was done, or why not (resolution).');
  if (owner) {
    p.owner = owner;
    if (owner === 'manager') p.needsYou = true;
    else delete p.needsYou;
  }
  if (state && isOpen({ state })) {
    p.state = state;
    delete p.resolution;
    delete p.resolvedAt;
  } else if (state) {
    if (!isOpen(p)) throw new Error(`${id} is ${STATE_LABELS[p.state].toLowerCase()} already: ${p.resolution ?? ''}`.trim());
    resolveProblems(s, (x) => x === p, resolution, now);
    p.state = state;
  }
  return p;
}

/** Work problems with no repeat in PROBLEM_IDLE_MS resolve (ongoing ones stay while their cause lasts); keeps the newest KEPT, the open ones first. */
export function pruneProblems(s: ProblemsState, now: number) {
  resolveProblems(s, (p) => p.kind === 'work' && !p.ongoing && now - p.lastAt >= PROBLEM_IDLE_MS, 'No repeat in 3 days.', now);
  const open = s.list.filter(isOpen);
  const done = s.list.filter((p) => !isOpen(p)).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
  s.list = [...open, ...done.slice(0, Math.max(0, KEPT - open.length))].sort((a, b) => b.at - a.at);
}

/** What tabs get: the entries without their keys (server/scale.test.ts' snapshot budget). */
export const problemsView = (list: readonly Problem[]): Problem[] => list.map(({ key: _key, ...p }) => p);

/** An IT ticket as a register entry: infrastructure, IT's; a blocking one loses time until it's closed. */
function ticketProblem(t: ItTicket): Problem {
  const agent = t.by.find((b) => b.id !== 'office' && b.id !== 'ceo');
  return {
    id: `t${t.id}`, kind: 'infrastructure', cause: t.where, title: t.what, detail: t.evidence.at(-1), floor: null, repoId: null, pr: null, issue: null,
    agentId: agent?.id ?? null, ...(agent && { agentName: agent.name }), at: t.at, lastAt: t.lastAt, count: t.count,
    lostMs: t.blocking && t.status === 'closed' ? (t.closedAt ?? t.lastAt) - t.at : 0, lostUsd: 0, ...(t.blocking && t.status === 'open' && { ongoing: true as const }),
    owner: 'it', state: t.status === 'closed' ? 'resolved' : t.wokeAt ? 'in-progress' : 'open', ...(t.resolution && { resolution: t.resolution }), ...(t.closedAt && { resolvedAt: t.closedAt }), key: `ticket:${t.id}`,
  };
}

/** The whole register: the office's entries and IT's tickets. */
export const register = (list: readonly Problem[], tickets: readonly ItTicket[]): Problem[] => [...list, ...tickets.map(ticketProblem)];

/** Time lost by now. */
export const lostNow = (p: Problem, now: number) => p.lostMs + (p.ongoing && isOpen(p) ? Math.max(0, now - p.at) : 0);
/** How bad it is: minutes lost plus dollars lost (a dollar weighs USD_MINUTES minutes). */
const worth = (p: Problem, now: number) => lostNow(p, now) / MIN + p.lostUsd * USD_MINUTES;

/** Worst first; ties newest first. */
export const worstFirst = (list: readonly Problem[], now: number): Problem[] => [...list].sort((a, b) => worth(b, now) - worth(a, now) || b.lastAt - a.lastAt);

/** Recurring: it happened 3 times or more, or its cause hit its floor 3 times or more in a week. */
export function recurring(p: Problem, all: readonly Problem[], now: number): boolean {
  if (p.count >= 3) return true;
  const week = all.filter((x) => x.cause === p.cause && x.floor === p.floor && now - x.lastAt < 7 * DAY);
  return week.reduce((n, x) => n + x.count, 0) >= 3;
}

export interface ProblemGroup {
  key: string; // `${cause}:${floor}`
  cause: ProblemCause;
  floor: number | null;
  items: Problem[]; // worst first
  lostMs: number;
  lostUsd: number;
  count: number;
}

/** By cause and floor, the worst group first. */
export function groupProblems(list: readonly Problem[], now: number): ProblemGroup[] {
  const groups = new Map<string, ProblemGroup>();
  for (const p of worstFirst(list, now)) {
    const key = `${p.cause}:${p.floor ?? ''}`;
    const g = groups.get(key) ?? { key, cause: p.cause, floor: p.floor, items: [], lostMs: 0, lostUsd: 0, count: 0 };
    g.items.push(p);
    g.lostMs += lostNow(p, now);
    g.lostUsd += p.lostUsd;
    g.count += p.count;
    groups.set(key, g);
  }
  const score = (g: ProblemGroup) => g.lostMs / MIN + g.lostUsd * USD_MINUTES;
  return [...groups.values()].sort((a, b) => score(b) - score(a) || b.count - a.count);
}

/** Per cause: entries seen this week and the week before, most this week first. */
export function causeTrends(list: readonly Problem[], now: number): { cause: ProblemCause; week: number; before: number }[] {
  const rows = new Map<ProblemCause, { cause: ProblemCause; week: number; before: number }>();
  for (const p of list) {
    const age = now - p.lastAt;
    if (age >= 14 * DAY) continue;
    const r = rows.get(p.cause) ?? { cause: p.cause, week: 0, before: 0 };
    if (age < 7 * DAY) r.week += p.count;
    else r.before += p.count;
    rows.set(p.cause, r);
  }
  return [...rows.values()].sort((a, b) => b.week - a.week || b.before - a.before);
}

// ---------- the daily digest ----------

/** "2 h", "35 min", "<1 min". */
export function fmtLost(ms: number): string {
  const m = Math.round(ms / MIN);
  if (m < 1) return '<1 min';
  if (m < 90) return `${m} min`;
  const h = ms / HOUR;
  return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`;
}

const where = (floor: number | null) => (floor === null ? '' : ` on floor ${floor}`);

/** One tappable line of the digest card. */
type DigestItem = Pick<Problem, 'id' | 'title' | 'repoId' | 'pr' | 'issue' | 'agentId'> & { needsYou?: true };

export interface ProblemsDigest {
  text: string;
  items: DigestItem[];
}

const DIGEST_ITEMS = 5;

/** The day's digest: the last 24 hours' new and resolved problems, the worst cause and floor, what needs the manager, then the items, theirs first. */
export function digest(list: readonly Problem[], now: number): ProblemsDigest {
  const since = now - DAY;
  const fresh = list.filter((p) => p.at >= since);
  const resolved = list.filter((p) => !isOpen(p) && (p.resolvedAt ?? 0) >= since);
  const open = list.filter(isOpen);
  const yours = worstFirst(open.filter((p) => p.needsYou), now);
  const top = groupProblems(list.filter((p) => isOpen(p) || p.lastAt >= since), now)[0];
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
  const cost = top && [top.lostMs >= MIN ? fmtLost(top.lostMs) : '', top.lostUsd >= 0.01 ? `$${top.lostUsd.toFixed(2)}` : ''].filter(Boolean).join(' and ');
  const head = `Yesterday: ${n(fresh.length, 'new problem')}, ${resolved.length} resolved`;
  const topLine = top ? `; top: ${CAUSE_LABELS[top.cause].toLowerCase()}${where(top.floor)}${cost ? ` cost ${cost}` : ` (${top.count}×)`}` : '';
  const text = `📋 ${head}${topLine}; needs you: ${yours.length}.`;
  const rest = worstFirst(open.filter((p) => !p.needsYou), now);
  const items = [...yours, ...rest].slice(0, DIGEST_ITEMS).map((p): DigestItem => ({ id: p.id, title: `${p.title}${where(p.floor)}`, repoId: p.repoId, pr: p.pr, issue: p.issue, agentId: p.agentId, ...(p.needsYou && { needsYou: true as const }) }));
  return { text, items };
}

/** The digest's hour when Settings has none. */
const DIGEST_HOUR = 9;

/** The day key when the digest is due (from `hour` o'clock, once a day), else null. `hour` -1: off. */
export function digestDue(now: number, hour: number, lastDay: string): string | null {
  if (hour < 0) return null;
  const d = new Date(now);
  const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  return d.getHours() >= hour && day !== lastDay ? day : null;
}

/** Settings' digest hour: 0-23, or -1 for off. */
export const digestHour = (x: unknown): number => {
  const n = Math.round(Number(x));
  return Number.isFinite(n) && n >= -1 && n <= 23 ? n : DIGEST_HOUR;
};

const isProblem = (p: unknown): p is Problem => {
  const x = p as Problem | null;
  return !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.key === 'string' && x.cause in CAUSE_LABELS && PROBLEM_STATES.includes(x.state) && PROBLEM_OWNERS.includes(x.owner) && Number.isFinite(x.at);
};

/** The state file's register, keeping only well-formed entries. */
export function loadProblems(raw: unknown): ProblemsState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProblemsState>;
  const list = (Array.isArray(r.list) ? r.list : []).filter(isProblem).slice(0, KEPT);
  return { seq: Math.max(Number.isInteger(r.seq) ? r.seq! : 0, ...list.map((p) => Number(p.id.slice(1)) || 0)), list, digestDay: typeof r.digestDay === 'string' ? r.digestDay : '' };
}
