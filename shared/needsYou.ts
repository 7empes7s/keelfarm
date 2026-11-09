// "Needs you" and "Free" (#307): an agent waiting on the manager (their question escalated to the manager, a prompt
// the watchdog couldn't answer, a cloud agent's sign-in) stands out, and one that finished with nothing to do reads
// as free, not "done". Derived, never persisted: the scheduler's statuses keep their meaning. Pure, for the server's
// company_status and every place the client shows an agent's status.
import type { AgentStatus } from './types.ts';

/** What the manager has to do for them. */
export type NeedsWhy = 'question' | 'prompt' | 'sign-in';

/** The fields the rule reads (AgentView has them all). */
export interface NeedsYouInput {
  status: AgentStatus;
  blocked?: string | null; // the watchdog's 'blocked' step (server/unblock.ts)
  waiting?: 'ceo' | 'manager' | null; // who their open question waits on (shared/questions.ts)
  needsSignIn?: boolean;
}

/** Why the manager is needed, or null when they aren't. */
export function needsYou(a: NeedsYouInput): NeedsWhy | null {
  if (a.needsSignIn) return 'sign-in';
  if (a.blocked && a.status === 'working') return 'prompt';
  if (a.waiting === 'manager' && a.status !== 'working') return 'question';
  return null;
}

/** What an agent is, as the manager and the CEO see it: 'done' and 'idle' are both free. */
export type ShownState = 'needs-you' | 'waiting-ceo' | 'free' | 'preparing' | 'working' | 'error' | 'stopped';

export function shownState(a: NeedsYouInput): ShownState {
  if (needsYou(a)) return 'needs-you';
  if (a.waiting === 'ceo' && a.status !== 'working') return 'waiting-ceo';
  return a.status === 'idle' || a.status === 'done' ? 'free' : a.status;
}

const TODO: Record<NeedsWhy, (name: string) => string> = {
  question: (n) => `answer ${n}'s question`,
  prompt: (n) => `answer the prompt in ${n}'s terminal`,
  'sign-in': (n) => `sign ${n}'s coding agent in`,
};

/** What the manager has to do: "answer Ada's question". */
export const needsYouTodo = (name: string, why: NeedsWhy) => TODO[why](name);

/** "Needs you: answer Ada's question". */
export const needsYouLine = (name: string, why: NeedsWhy) => `Needs you: ${needsYouTodo(name, why)}`;
