// The Researcher (#664): a desk of its own in the lobby, next to the CEO and IT, that runs every research job (the
// manager's "Research: <topic>", Plan → Research first, the CEO's request_research) in its own session, one at a
// time, so the CEO's chat stays free. Its queue, the view the desk and the chat show, and loading what was saved. Pure.

export const RESEARCHER_ID = 'researcher';
export const RESEARCHER_NAME = 'Sage';
/** Requests waiting at most: past it, the oldest the CEO asked for goes (the manager's never do). */
export const RESEARCH_QUEUE_MAX = 10;

/** One research job, as asked. `by`: the manager (their chat or the Plan dialog) or the CEO (request_research). */
export interface ResearchRequest {
  id: number;
  topic: string;
  repoId?: string;
  questions?: string[];
  minutes: number; // its time budget
  by: 'manager' | 'ceo';
  messageIds?: number[]; // the manager's messages that asked for it
  at: number;
}

/** A finished job's brief: where it was saved and what it took. */
export interface ResearchBrief {
  id: number;
  topic: string;
  by: 'manager' | 'ceo';
  repoId?: string;
  file: string | null;
  summary: string;
  minutes: number;
  costUsd: number;
  partial: boolean; // stopped (past its budget, or the manager's Stop) before it wrapped up
  at: number;
}

export interface ResearchState {
  seq: number;
  queue: ResearchRequest[];
  job: (ResearchRequest & { startedAt: number }) | null;
  costUsd: number; // every research job's cost so far
  done: ResearchBrief[]; // the latest briefs, newest last (wait_for research_done reads them)
}

const BRIEFS_KEPT = 20;

/** What the Researcher desk and the chat's strip show. */
export interface ResearcherView {
  name: string;
  job: { id: number; topic: string; by: 'manager' | 'ceo'; startedAt: number; minutes: number } | null;
  queue: { id: number; topic: string; by: 'manager' | 'ceo' }[];
  costUsd: number;
  last: Pick<ResearchBrief, 'id' | 'topic' | 'minutes' | 'costUsd' | 'partial' | 'at'> | null;
}

export const emptyResearch = (): ResearchState => ({ seq: 1, queue: [], job: null, costUsd: 0, done: [] });

const sameTopic = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Queue a request, unless the same topic is already running or waiting: then its messages join that one. Returns the
 * request that will answer it and how many jobs go before it (0: next, or running now).
 */
export function queueResearch(s: ResearchState, req: Omit<ResearchRequest, 'id'>): { request: ResearchRequest; ahead: number; joined: boolean } {
  const running = s.job && sameTopic(s.job.topic, req.topic) ? s.job : null;
  const waiting = s.queue.findIndex((r) => sameTopic(r.topic, req.topic));
  const same = running ?? (waiting >= 0 ? s.queue[waiting] : null);
  if (same) {
    if (req.messageIds?.length) same.messageIds = [...(same.messageIds ?? []), ...req.messageIds];
    if (req.by === 'manager') same.by = 'manager';
    return { request: same, ahead: running ? 0 : waiting + (s.job ? 1 : 0), joined: true };
  }
  const request: ResearchRequest = { ...req, id: s.seq++ };
  s.queue.push(request);
  while (s.queue.length > RESEARCH_QUEUE_MAX) {
    const i = s.queue.findIndex((r) => r.by === 'ceo' && r !== request);
    if (i < 0) break;
    s.queue.splice(i, 1);
  }
  return { request, ahead: s.queue.indexOf(request) + (s.job ? 1 : 0), joined: false };
}

/** The next job, or null when one runs or none waits (one at a time: the server's memory is shared). */
export function nextResearch(s: ResearchState, now: number): ResearchState['job'] {
  if (s.job || !s.queue.length) return null;
  s.job = { ...s.queue.shift()!, startedAt: now };
  return s.job;
}

/** Records a finished job's brief and frees the desk. */
export function finishResearch(s: ResearchState, brief: ResearchBrief) {
  s.job = null;
  s.costUsd += brief.costUsd;
  s.done.push(brief);
  if (s.done.length > BRIEFS_KEPT) s.done.splice(0, s.done.length - BRIEFS_KEPT);
}

export function researcherView(s: ResearchState): ResearcherView {
  const last = s.done.at(-1);
  return {
    name: RESEARCHER_NAME,
    job: s.job && { id: s.job.id, topic: s.job.topic, by: s.job.by, startedAt: s.job.startedAt, minutes: s.job.minutes },
    queue: s.queue.map((r) => ({ id: r.id, topic: r.topic, by: r.by })),
    costUsd: Math.round(s.costUsd * 100) / 100,
    last: last ? { id: last.id, topic: last.topic, minutes: last.minutes, costUsd: last.costUsd, partial: last.partial, at: last.at } : null,
  };
}

/** The desk's state line: "free", or the running topic with its minutes against the budget. */
export function researchLine(v: ResearcherView | null, now: number): string {
  if (!v?.job) return 'free';
  const min = Math.max(0, Math.floor((now - v.job.startedAt) / 60_000));
  const more = v.queue.length ? ` · ${v.queue.length} waiting` : '';
  return `${min} of ${v.job.minutes} min${more}`;
}

/** The saved state, checked; a job a restart cut off goes back to the front of the queue. */
export function loadResearch(raw: unknown): ResearchState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ResearchState>;
  const ok = (x: unknown): x is ResearchRequest => !!x && typeof (x as ResearchRequest).topic === 'string' && typeof (x as ResearchRequest).id === 'number';
  const queue = Array.isArray(r.queue) ? r.queue.filter(ok) : [];
  if (ok(r.job)) {
    const { startedAt: _, ...job } = r.job;
    queue.unshift(job);
  }
  return {
    seq: typeof r.seq === 'number' && r.seq > 0 ? r.seq : 1,
    queue,
    job: null,
    costUsd: Number.isFinite(r.costUsd) ? Number(r.costUsd) : 0,
    done: Array.isArray(r.done) ? r.done.filter((b) => b && typeof b.topic === 'string' && typeof b.id === 'number').slice(-BRIEFS_KEPT) : [],
  };
}

/** wait_for research_done's view of one request: its topic, and its brief once done; null when it isn't kept. */
export function researchStatus(s: ResearchState, id: number): { topic: string; done: Pick<ResearchBrief, 'file' | 'summary' | 'partial'> | null } | null {
  const done = s.done.find((b) => b.id === id);
  if (done) return { topic: done.topic, done: { file: done.file, summary: done.summary, partial: done.partial } };
  const open = s.job?.id === id ? s.job : s.queue.find((q) => q.id === id);
  return open ? { topic: open.topic, done: null } : null;
}
