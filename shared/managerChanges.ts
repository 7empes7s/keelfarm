// The manager acts, the CEO decides (#207). A board action (close, merge, re-QA, send back) happens at once, but never
// stops or redirects a running agent itself: it is recorded as a ManagerChange. One that touched running work wakes the
// CEO (debounced, so a burst of edits is one job); the rest go into the CEO's next job as one short block. The CEO
// stops, redirects or lets the agents finish with its own tools. Pure, shared by the server and Mission control.
import type { CeoVerdict, ManagerChange } from './types.ts';

/** A change that touched running work wakes the CEO this long after the last one. */
export const CHANGES_DEBOUNCE_MS = 60_000;
const KEEP = 100;
const KEEP_MS = 2 * 24 * 60 * 60_000;

/** What the office keeps: recent changes, and when the CEO is woken for the ones that touched running work. */
export interface ChangesState {
  list: ManagerChange[];
  wakeAt: number | null;
}

export const emptyChanges = (): ChangesState => ({ list: [], wakeAt: null });

/** Record a change; one that touched running work (re)starts the debounce. Old, told ones are dropped. */
export function recordChange(s: ChangesState, c: ManagerChange, now: number): void {
  s.list = [...s.list.filter((x) => !x.told || now - x.at < KEEP_MS), c].slice(-KEEP);
  if (c.affects.length) s.wakeAt = now + CHANGES_DEBOUNCE_MS;
}

/** Is a CEO job due for changes that touched running work? */
export const changesDue = (s: ChangesState, now: number) => s.wakeAt != null && now >= s.wakeAt;

/**
 * The changes the CEO hasn't heard about, marked told: they go into the job starting now. Only its changes job (all)
 * takes those that touched running work; any other job takes the rest.
 */
export function takeUntold(s: ChangesState, all: boolean): ManagerChange[] {
  const out = s.list.filter((c) => !c.told && (all || !c.affects.length));
  for (const c of out) c.told = true;
  if (all) s.wakeAt = null;
  return out;
}

/** The block for the CEO's prompt, one line per change. work: an affected agent's name and where their work stands. */
export function changesBlock(changes: readonly ManagerChange[], work: (c: ManagerChange, agentId: string) => string): string {
  if (!changes.length) return '';
  const line = (c: ManagerChange) => `- floor ${c.floor}: ${c.detail}${c.affects.length ? ` · touched: ${c.affects.map((id) => work(c, id)).join(', ')}` : ''}`;
  return `\n\nYour changes since last time (the manager's own actions; agents keep running until you decide):\n${changes.map(line).join('\n')}`;
}

/** The CEO acted on an agent: the undecided changes that touched them get its verdict. */
export function markVerdict(s: ChangesState, agentId: string, verdict: CeoVerdict): boolean {
  const hit = s.list.filter((c) => c.verdict == null && c.affects.includes(agentId));
  for (const c of hit) c.verdict = verdict;
  return hit.length > 0;
}

/** The CEO's job ended: changes in it that touched running work and got no verdict were let finish. */
export function settle(s: ChangesState, ids: readonly string[]): boolean {
  const hit = s.list.filter((c) => ids.includes(c.id) && c.affects.length > 0 && c.verdict == null);
  for (const c of hit) c.verdict = 'let-finish';
  return hit.length > 0;
}

/** The parts of an agent a change is matched against. */
export interface ChangedAgent {
  id: string;
  repoId: string;
  task: 'issue' | 'qa' | 'fix' | null;
  issueNumber: number | null;
  prNumber: number | null;
}

/** Is the agent still on the work the change touched? Once they moved on to another task, it no longer concerns them. */
export const stillOn = (c: ManagerChange, a: ChangedAgent) =>
  c.affects.includes(a.id) && a.repoId === c.repoId && ((c.pr != null && a.prNumber === c.pr) || (c.issue != null && a.task === 'issue' && a.issueNumber === c.issue));

/** Is the CEO still deciding about this agent's current work? */
export const reviewing = (s: ChangesState, a: ChangedAgent) => s.list.some((c) => c.verdict == null && stillOn(c, a));

/**
 * Agents a closure must not stop: the manager's own close or merge of that issue or PR touched them, and the CEO
 * decides (a CEO stop has already ended their session).
 */
export function spared(list: readonly ManagerChange[], repoId: string, closure: { kind: 'issue' | 'pr'; number: number }): string[] {
  const hit = list.filter((c) => c.repoId === repoId && c.kind !== 're-qa' && c.kind !== 'send-back' && (closure.kind === 'issue' ? c.issue : c.pr) === closure.number);
  return [...new Set(hit.flatMap((c) => c.affects))];
}

export interface ChangeStats {
  today: number;
  touched: number; // of today's, how many touched running work
  stopped: number;
  redirected: number;
  letFinish: number;
}

/** Mission control's bar: today's changes, how many touched running work, and what the CEO did. */
export function changeStats(list: readonly ManagerChange[], now: number): ChangeStats {
  const day = new Date(now).toDateString();
  const today = list.filter((c) => new Date(c.at).toDateString() === day);
  const count = (v: CeoVerdict) => today.filter((c) => c.verdict === v).length;
  return { today: today.length, touched: today.filter((c) => c.affects.length > 0).length, stopped: count('stopped'), redirected: count('redirected'), letFinish: count('let-finish') };
}
