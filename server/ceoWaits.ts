// The CEO's waits (#28), pure: what wait_for waits on and when it holds, ask_manager's questions and which of them a
// manager's message answers, and whether the CEO's next job carries on in its kept session.
import type { QaStatus } from '../shared/types.ts';
import type { CeoAwakeSettings } from '../shared/ceoAwake.ts';

const WAIT_DEFAULT_MIN = 10;
export const ASK_MAX_MIN = 120;
export const ASK_DEFAULT_MIN = 30;

export type WaitKind = 'pr_qa' | 'pr_merged' | 'issue_closed' | 'agent_idle' | 'preview_running' | 'usage';
export const WAIT_KINDS: WaitKind[] = ['pr_qa', 'pr_merged', 'issue_closed', 'agent_idle', 'preview_running', 'usage'];

export interface WaitCondition {
  kind: WaitKind;
  floor?: number;
  pr?: number;
  issue?: number;
  agent_id?: string;
  usage?: 'normal' | 'pacing' | 'paused';
}

/** The office as a wait sees it; null: there is no such floor, PR, issue or agent. */
export interface WaitWorld {
  floors: number[];
  qa(floor: number, pr: number): { status: QaStatus; summary: string | null } | null;
  pr(floor: number, pr: number): 'OPEN' | 'CLOSED' | 'MERGED' | null;
  issue(floor: number, n: number): 'OPEN' | 'CLOSED' | null;
  agent(id: string): { name: string; status: string } | null;
  preview(floor: number): string | null;
  usage(): 'normal' | 'pacing' | 'paused';
}

/** wait_for's timeout in ms: `min` minutes (default WAIT_DEFAULT_MIN), at most `max`. */
export const waitMs = (min: number | undefined, max: number) => Math.max(1, Math.min(max, min ?? Math.min(WAIT_DEFAULT_MIN, max))) * 60_000;

/** What one condition waits on, for the CEO tab ("PR #12 on floor 1 to merge"). */
export function waitLabel(c: WaitCondition): string {
  switch (c.kind) {
    case 'pr_qa':
      return `QA's verdict on PR #${c.pr} on floor ${c.floor}`;
    case 'pr_merged':
      return `PR #${c.pr} on floor ${c.floor} to merge`;
    case 'issue_closed':
      return `#${c.issue} on floor ${c.floor} to close`;
    case 'agent_idle':
      return `${c.agent_id} to be free`;
    case 'preview_running':
      return `floor ${c.floor}'s preview`;
    case 'usage':
      return `Claude's usage to be ${c.usage ?? 'normal'}`;
  }
}

/** Why a condition can't be waited on (a missing field, an unknown floor, PR, issue or agent), or null. */
export function waitProblem(c: WaitCondition, w: WaitWorld): string | null {
  const needs = (k: keyof WaitCondition) => (c[k] === undefined ? `${c.kind} needs ${k}.` : null);
  const floor = () => needs('floor') ?? (w.floors.includes(c.floor!) ? null : `There is no floor ${c.floor}.`);
  switch (c.kind) {
    case 'pr_qa':
    case 'pr_merged':
      return floor() ?? needs('pr') ?? (w.pr(c.floor!, c.pr!) ? null : `There is no PR #${c.pr} on floor ${c.floor}.`);
    case 'issue_closed':
      return floor() ?? needs('issue') ?? (w.issue(c.floor!, c.issue!) ? null : `There is no issue #${c.issue} on floor ${c.floor}.`);
    case 'agent_idle':
      return needs('agent_id') ?? (w.agent(c.agent_id!) ? null : `There is no agent ${c.agent_id}.`);
    case 'preview_running':
      return floor();
    case 'usage':
      return null;
  }
}

/** What happened, once a condition holds (or never can: a PR closed without merging), else null. */
export function waitMet(c: WaitCondition, w: WaitWorld): string | null {
  switch (c.kind) {
    case 'pr_qa': {
      const q = w.qa(c.floor!, c.pr!);
      const state = w.pr(c.floor!, c.pr!);
      // A failed round goes straight on to its fix, so fixing is a failed verdict too.
      const verdict = q && { passed: 'passed', failed: 'failed', fixing: 'failed (being fixed)', 'needs-human': 'got stuck (needs-human)' }[q.status as string];
      if (verdict) return `PR #${c.pr} on floor ${c.floor}: QA ${verdict}${q.summary ? `: ${q.summary.slice(0, 300)}` : ''}`;
      return state === 'MERGED' || state === 'CLOSED' ? `PR #${c.pr} on floor ${c.floor} was ${state.toLowerCase()}.` : null;
    }
    case 'pr_merged': {
      const state = w.pr(c.floor!, c.pr!);
      return state === 'MERGED' ? `PR #${c.pr} on floor ${c.floor} merged.` : state === 'CLOSED' ? `PR #${c.pr} on floor ${c.floor} was closed without merging.` : null;
    }
    case 'issue_closed':
      return w.issue(c.floor!, c.issue!) === 'CLOSED' ? `#${c.issue} on floor ${c.floor} is closed.` : null;
    case 'agent_idle': {
      const a = w.agent(c.agent_id!);
      if (!a) return `${c.agent_id} left the company.`;
      return ['idle', 'done', 'error', 'stopped'].includes(a.status) ? `${a.name} is ${a.status === 'done' ? 'free' : a.status}.` : null;
    }
    case 'preview_running': {
      const s = w.preview(c.floor!);
      return s === 'running' ? `Floor ${c.floor}'s preview is running.` : s === 'error' ? `Floor ${c.floor}'s preview failed to start.` : null;
    }
    case 'usage':
      return w.usage() === (c.usage ?? 'normal') ? `Claude's usage is ${w.usage()}.` : null;
  }
}

/** The first of several conditions that holds, or null: wait_for returns as soon as any does. */
export const anyMet = (cs: WaitCondition[], w: WaitWorld): string | null => cs.map((c) => waitMet(c, w)).find((m) => m !== null) ?? null;

// ---------- ask_manager ----------

export interface CeoQuestion {
  id: string;
  messageId: number; // the CEO's message on the phone that asks it
  text: string;
  at: number;
  waiting: boolean; // a session is blocked on it; false: it timed out, and an answer starts a new job
}

/**
 * Which question a manager's message answers: the one it replies to (#7's replyTo), else, with no reply quote, the
 * oldest one a session waits on. A reply to a question nobody waits on any more resumes it as a new job.
 */
export function routeReply(qs: readonly CeoQuestion[], replyTo: number | undefined): { to: CeoQuestion; resume: boolean } | null {
  const quoted = replyTo === undefined ? undefined : qs.find((q) => q.messageId === replyTo);
  if (quoted) return { to: quoted, resume: !quoted.waiting };
  if (replyTo !== undefined) return null; // a reply to some other message is ordinary chat
  const open = qs.filter((q) => q.waiting).sort((x, y) => x.at - y.at)[0];
  return open ? { to: open, resume: false } : null;
}

/** What ask_manager returns when nobody answered in time: the job ends, and their reply comes back as a new one. */
export const NO_ANSWER = "No answer yet. End this job now: say you're waiting for their answer to that question. When they reply, it comes back to you as a new job.";

// ---------- the kept session ----------

/** Whether the CEO's next job carries on in its kept session, or starts a fresh one (and why). */
export function ceoSessionStep(s: CeoAwakeSettings, k: { sessionId: string | null; turns: number; lastEndedAt: number | null }, now: number): { resume: boolean; why: string | null } {
  if (!s.keepAlive || !k.sessionId) return { resume: false, why: null };
  if (k.turns >= s.restartTurns) return { resume: false, why: `its session took ${k.turns} turns, so its context is full` };
  if (k.lastEndedAt && now - k.lastEndedAt >= s.idleHours * 3_600_000) return { resume: false, why: `it was idle for ${s.idleHours}h` };
  return { resume: true, why: null };
}
