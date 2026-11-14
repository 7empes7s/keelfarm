import { blockers } from './issues.ts';

// The CEO's follow-ups (#27): office events (a merge, a second QA fail, an agent stuck…) wake the CEO for a short job.
// Events close together are batched into one job, at most `perHour` jobs start in an hour, and none while Claude's
// usage is pacing or paused (they wait and merge). The manager's standing mandates say on which floors a follow-up may
// file issues. Pure: the swarm keeps the state, the client shows the settings.

/** Office events that wake the CEO for a follow-up job */
export type FollowupKind = 'question' | 'merged' | 'qaFailed' | 'agentError' | 'agentBlocked' | 'stalled' | 'unblocked' | 'audit' | 'usage' | 'burst' | 'research';

export interface FollowupSettings {
  kinds: Record<FollowupKind, boolean>;
  windowMin: number; // events this close together go into one job
  perHour: number; // most follow-up jobs started in an hour; 0 = follow-ups off
}

/** "Keep working on X until it's perfected": recorded by the CEO's set_mandate, removable in the CEO tab. */
export interface CeoMandate {
  id: string;
  text: string;
  floors: number[]; // [] = every floor
  expiresAt: number | null;
  at: number;
}

export const FOLLOWUP_KINDS: { id: FollowupKind; label: string }[] = [
  { id: 'question', label: 'An agent asked a question (answered, or brought to me)' },
  { id: 'merged', label: 'A pull request merged (checked against its issue)' },
  { id: 'qaFailed', label: 'QA failed a pull request for the 2nd time or more' },
  { id: 'agentError', label: 'An agent stayed in an error' },
  { id: 'agentBlocked', label: 'An agent got blocked, never started, or finished without the office noticing' },
  { id: 'stalled', label: 'The watchdog put stalled work back in line' },
  { id: 'unblocked', label: 'An issue could start once what it waited for closed' },
  { id: 'audit', label: 'A code-health audit (docs/code-health.md) landed' },
  { id: 'usage', label: "Claude's usage changed state" },
  { id: 'burst', label: 'Hybrid added a cloud agent because this computer was full' },
  { id: 'research', label: 'The Researcher finished research I asked for' },
];

export const DEFAULT_FOLLOWUPS: FollowupSettings = {
  kinds: { question: true, merged: true, qaFailed: true, agentError: true, agentBlocked: true, stalled: true, unblocked: true, audit: true, usage: true, burst: true, research: true },
  windowMin: 10,
  perHour: 4,
};

export const MAX_MANDATES = 10;
export const MANDATE_MAX_CHARS = 600;
/** Events one follow-up job carries at most: older ones are dropped, the newest are what matter. */
export const MAX_FOLLOWUP_EVENTS = 20;

const HOUR_MS = 60 * 60_000;

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/** Settings → The CEO's follow-ups, a patch over `base` with anything malformed left as it was. */
export function followupSettings(base: FollowupSettings | undefined, patch: unknown): FollowupSettings {
  const b = { ...DEFAULT_FOLLOWUPS, ...base, kinds: { ...DEFAULT_FOLLOWUPS.kinds, ...base?.kinds } };
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof FollowupSettings, unknown>>;
  const k = (p.kinds && typeof p.kinds === 'object' ? p.kinds : {}) as Record<string, unknown>;
  return {
    kinds: Object.fromEntries(FOLLOWUP_KINDS.map(({ id }) => [id, typeof k[id] === 'boolean' ? k[id] : b.kinds[id]])) as Record<FollowupKind, boolean>,
    windowMin: p.windowMin === undefined ? b.windowMin : clampInt(p.windowMin, 0, 120, b.windowMin),
    perHour: p.perHour === undefined ? b.perHour : clampInt(p.perHour, 0, 30, b.perHour),
  };
}

/** The mandates as saved: well-formed, trimmed, at most MAX_MANDATES (the newest kept). */
export function mandateList(raw: unknown): CeoMandate[] {
  if (!Array.isArray(raw)) return [];
  const out: CeoMandate[] = [];
  for (const m of raw as Partial<CeoMandate>[]) {
    const text = typeof m?.text === 'string' ? m.text.trim().slice(0, MANDATE_MAX_CHARS) : '';
    if (!text) continue;
    const floors = Array.isArray(m.floors) ? [...new Set(m.floors.map(Number).filter((f) => Number.isInteger(f) && f > 0))].sort((x, y) => x - y) : [];
    const expiresAt = typeof m.expiresAt === 'number' && Number.isFinite(m.expiresAt) ? m.expiresAt : null;
    const at = typeof m.at === 'number' && Number.isFinite(m.at) ? m.at : 0;
    const id = typeof m.id === 'string' && /^[\w-]{1,40}$/.test(m.id) ? m.id : `m-${at.toString(36)}-${out.length}`;
    out.push({ id, text, floors, expiresAt, at });
  }
  return out.slice(-MAX_MANDATES);
}

/** The mandates still in force now. */
export const liveMandates = (mandates: CeoMandate[], now: number) => mandates.filter((m) => m.expiresAt === null || m.expiresAt > now);

/** The mandate that covers a floor now (the newest), or null. */
export function mandateFor(mandates: CeoMandate[], floor: number, now: number): CeoMandate | null {
  return [...liveMandates(mandates, now)].reverse().find((m) => m.floors.length === 0 || m.floors.includes(floor)) ?? null;
}

/** Where a mandate applies, in words: "every floor" or "floors 2, 3". */
export const mandateWhere = (m: Pick<CeoMandate, 'floors'>) => (m.floors.length === 0 ? 'every floor' : `floor${m.floors.length === 1 ? '' : 's'} ${m.floors.join(', ')}`);

// ---------- batching ----------

/** Something that happened in the office, for the CEO to follow up on. `key`: the same thing again replaces it. */
export interface FollowupEvent {
  id: string; // shown to the CEO in the job prompt, e.g. "e12"
  kind: FollowupKind;
  key: string;
  label: string; // short, for the CEO's presence line: "#13 merged"
  text: string; // one line for the job prompt
  repoId?: string;
  at: number;
}

export interface FollowupState {
  pending: FollowupEvent[];
  since: number | null; // when the oldest pending event arrived: the batch window runs from here
  started: number[]; // when follow-up jobs started, in the last hour (the hourly cap)
  seq: number; // for event ids
}

export const emptyFollowups = (): FollowupState => ({ pending: [], since: null, started: [], seq: 1 });

/** A saved state, or a fresh one. */
export function loadFollowups(raw: unknown): FollowupState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<FollowupState>;
  const pending = Array.isArray(r.pending) ? r.pending.filter((e) => e && typeof e.key === 'string' && typeof e.kind === 'string') : [];
  return {
    pending,
    since: pending.length ? (typeof r.since === 'number' ? r.since : Math.min(...pending.map((e) => e.at))) : null,
    started: Array.isArray(r.started) ? r.started.filter((t) => typeof t === 'number') : [],
    seq: typeof r.seq === 'number' && r.seq > 0 ? r.seq : 1,
  };
}

/**
 * Queue an event, unless its kind is off in the settings (false). The same thing again (its key) replaces the earlier
 * one and keeps the batch window where it was.
 */
export function addFollowup(s: FollowupState, ev: Omit<FollowupEvent, 'id'>, settings: FollowupSettings): boolean {
  if (!settings.kinds[ev.kind] || settings.perHour <= 0) return false;
  const same = s.pending.findIndex((e) => e.key === ev.key);
  const id = same >= 0 ? s.pending[same].id : `e${s.seq++}`;
  if (same >= 0) s.pending.splice(same, 1);
  s.pending.push({ ...ev, id });
  if (s.pending.length > MAX_FOLLOWUP_EVENTS) s.pending.splice(0, s.pending.length - MAX_FOLLOWUP_EVENTS);
  s.since ??= ev.at;
  return true;
}

export type FollowupStep = { do: 'none' } | { do: 'start' } | { do: 'wait'; until: number | null; why: 'window' | 'cap' | 'usage' };

/**
 * Whether a follow-up job starts now. Pending events of kinds since turned off are dropped first. While usage is
 * pacing or paused nothing starts (the events keep merging); otherwise it starts once the batch window has passed
 * since the first event, unless `perHour` jobs started in the last hour.
 */
export function followupStep(s: FollowupState, o: { now: number; settings: FollowupSettings; usage: 'normal' | 'pacing' | 'paused' }): FollowupStep {
  s.pending = o.settings.perHour > 0 ? s.pending.filter((e) => o.settings.kinds[e.kind]) : [];
  s.started = s.started.filter((t) => o.now - t < HOUR_MS);
  if (!s.pending.length) {
    s.since = null;
    return { do: 'none' };
  }
  if (o.usage !== 'normal') return { do: 'wait', until: null, why: 'usage' };
  const windowEnds = (s.since ?? o.now) + o.settings.windowMin * 60_000;
  if (o.now < windowEnds) return { do: 'wait', until: windowEnds, why: 'window' };
  if (s.started.length >= o.settings.perHour) return { do: 'wait', until: Math.min(...s.started) + HOUR_MS, why: 'cap' };
  return { do: 'start' };
}

/** Take the pending events for a job that starts now. */
export function takeFollowups(s: FollowupState, now: number): FollowupEvent[] {
  const events = s.pending;
  s.pending = [];
  s.since = null;
  s.started.push(now);
  return events;
}

/** The presence line's "#13 merged", or "#13 merged and 2 more". */
export function followupLabel(events: Pick<FollowupEvent, 'label'>[]): string {
  if (!events.length) return 'office events';
  return `${events[events.length - 1].label}${events.length > 1 ? ` and ${events.length - 1} more` : ''}`;
}

/** A follow-up's final message that says nothing needs doing: kept off the manager's phone. */
export const quietReply = (text: string) => /^\s*\**\s*nothing (?:to do|needs doing|needed)\b[^\n]{0,80}$/i.test(text.trim());

/** Open issues that waited for another open issue at the last sync and wait for none now: they can start. */
export function unblockedIssues<T extends { number: number; body: string }>(before: T[], after: T[]): T[] {
  const openBefore = new Set(before.map((i) => i.number));
  const openAfter = new Set(after.map((i) => i.number));
  const waited = new Set(before.filter((i) => blockers(i.body, openBefore).length > 0).map((i) => i.number));
  return after.filter((i) => waited.has(i.number) && blockers(i.body, openAfter).length === 0);
}

type NewEvent = Omit<FollowupEvent, 'id' | 'at'>;
type Who = { id: string; name: string };

/** The office events' wording, for the job prompt. `where` is "floor N (owner/repo)"; texts come already clipped. */
export const followupEvents = {
  merged: (repoId: string, where: string, n: number, title: string, closes: number[]): NewEvent => ({
    kind: 'merged', key: `merged:${repoId}#${n}`, label: `#${n} merged`, repoId,
    text: `PR #${n} "${title}" merged on ${where}${closes.length ? `, closing ${closes.map((i) => `#${i}`).join(', ')}` : ''}. Check it against its issue's acceptance criteria.`,
  }),
  qaFailed: (repoId: string, where: string, pr: number, rounds: number, round: number, summary: string): NewEvent => ({
    kind: 'qaFailed', key: `qa:${repoId}#${pr}`, label: `#${pr} failed QA ${rounds}×`, repoId,
    text: `PR #${pr} on ${where} failed QA ${rounds} times (round ${round}): ${summary} qa_report has the report and screenshots.`,
  }),
  stalled: (a: Who, what: string, mins: number, repoId?: string, where?: string): NewEvent => ({
    kind: 'stalled', key: `stalled:${a.id}:${what}`, label: `${a.name} stalled`, repoId,
    text: `${a.name} (${a.id}) stalled on ${what}${where ? ` on ${where}` : ''}: the watchdog put it back in line after ${mins} minutes. agent_log and worktree_file show how far they got.`,
  }),
  burst: (a: Who, repoId: string, where: string, waiting: number): NewEvent => ({
    kind: 'burst', key: `burst:${a.id}`, label: `${a.name} added in the cloud`, repoId,
    text: `Hybrid added ${a.name} (${a.id}) in the cloud on ${where}: this computer was full and ${waiting} task${waiting === 1 ? '' : 's'} waited for memory. They leave by themselves once idle.`,
  }),
  agentBlocked: (a: Who, state: string, reason: string, screen: string, repoId?: string, where?: string): NewEvent => ({
    kind: 'agentBlocked', key: `blocked:${a.id}:${state}`, label: `${a.name} ${state === 'not-started' ? "hasn't started" : state === 'unregistered' ? 'finished unnoticed' : 'is blocked'}`, repoId,
    text: `${a.name} (${a.id})${where ? ` on ${where}` : ''} is ${state}: ${reason}. Their screen ends: "${screen}". Restart, message or redirect them; agent_log has more.`,
  }),
  agentError: (a: Who, key: string, mins: number, error: string, repoId?: string, where?: string): NewEvent => ({
    kind: 'agentError', key: `error:${key}`, label: `${a.name}'s error`, repoId,
    text: `${a.name} (${a.id})${where ? ` on ${where}` : ''} has been in an error for ${mins} minutes: ${error}. agent_log shows what happened.`,
  }),
};

/** What the CEO tab shows of the waiting events: when the job starts, and what holds it. Doesn't change `s`. */
export function followupWaiting(s: FollowupState, o: Parameters<typeof followupStep>[1]): { pending: string[]; startsAt: number | null; held: 'usage' | 'cap' | null } {
  if (!s.pending.length) return { pending: [], startsAt: null, held: null };
  const step = followupStep({ ...s, pending: [...s.pending], started: [...s.started] }, o);
  return { pending: s.pending.map((e) => e.label), startsAt: step.do === 'wait' ? step.until : o.now, held: step.do === 'wait' && step.why !== 'window' ? step.why : null };
}
