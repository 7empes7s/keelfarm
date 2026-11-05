// The CEO is always responsive (#46), pure: the manager's chat starts a CEO turn through an office update's drain,
// full session slots and a background CEO job (which it preempts). Only Claude's usage limit holds it, and then the
// phone says so and when the limit resets.

import type { CeoHeld, CeoJobKind } from '../shared/types.ts';

export interface CeoLaneInput {
  now: number;
  /** Claude's usage limit pauses new sessions until then (0: no pause). */
  pausedUntil: number;
  /** The office drains for its own update: only chat starts, so nothing the CEO files or assigns gets worked on. */
  draining: boolean;
  /** The update went to the launcher: the office is about to restart, nothing starts. */
  handingOver: boolean;
  /** The CEO is in a session, or between taking a job and starting one. */
  busy: boolean;
  /** The CEO's current job, if any. */
  job: CeoJobKind | null;
  /** That job's session is running (so it can be stopped). */
  session: boolean;
  /** A manager's message waits in the CEO's queue. */
  chatQueued: boolean;
}

export type CeoStep =
  | { do: 'start'; only: 'chat' | 'any' } // take the next job: only a chat while draining
  | { do: 'preempt' } // stop the background job (it goes back to the queue) so the chat starts next
  | { do: 'wait' };

/** What the CEO does with its queue now. */
export function ceoStep(s: CeoLaneInput): CeoStep {
  const limited = s.now < s.pausedUntil;
  if (s.busy || s.job) {
    const background = s.job !== null && s.job !== 'chat';
    return s.chatQueued && background && s.session && !limited && !s.handingOver ? { do: 'preempt' } : { do: 'wait' };
  }
  if (limited || s.handingOver) return { do: 'wait' };
  return { do: 'start', only: s.draining ? 'chat' : 'any' };
}

/** Why the manager's queued message can't start a CEO turn, for the banner above the phone's composer. */
export function ceoHeld(s: Pick<CeoLaneInput, 'now' | 'pausedUntil' | 'chatQueued'>): CeoHeld | null {
  return s.chatQueued && s.now < s.pausedUntil ? { reason: 'usage', until: s.pausedUntil } : null;
}

/**
 * Does a manager's message go into the CEO's running session, or queue as a chat job of its own? A chat session takes it
 * at once; a background job is preempted for it, except under the usage limit, when no new turn could start.
 */
export function messageGoesIn(s: Pick<CeoLaneInput, 'now' | 'pausedUntil' | 'job' | 'session'>): boolean {
  return s.session && (s.job === null || s.job === 'chat' || s.now < s.pausedUntil);
}
