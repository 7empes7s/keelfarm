// Never resume a session that isn't there (#401): a saved session is resumed only by the CLI that made it, on the
// account whose folder holds it, and a CLI that says it can't find it starts a fresh session on the same task once.
import type { AgentCli, AgentTask } from '../shared/types.ts';

/** A saved session's owner. `account` undefined: not known (saved before #401, a cloud agent's, OpenCode's). */
export interface SessionOwner {
  cli: AgentCli | null;
  account?: string;
}

/**
 * Whether `next` may resume a session `saved` made. Another CLI never can. Another account can only for Claude Code,
 * when both logins share their conversations (#377): `shares` is that single check.
 */
export function canResume(saved: SessionOwner, next: SessionOwner, shares: (account: string) => boolean): boolean {
  if (saved.cli !== next.cli) return false;
  if (saved.account === undefined || next.account === undefined || saved.account === next.account) return true;
  return next.cli === 'claude' && shares(saved.account) && shares(next.account);
}

const NOT_FOUND: Partial<Record<AgentCli, RegExp>> = {
  claude: /No conversation found with session ID/i,
  codex: /No saved session found/i,
};

/** The CLI was told to resume a session it doesn't have (it says so and exits 1). */
export const lostSession = (cli: AgentCli, screen: string) => NOT_FOUND[cli]?.test(screen) ?? false;

interface Holder {
  id: string;
  name: string;
  repoId: string | null;
  task: AgentTask | null;
  issueNumber: number | null;
  prNumber: number | null;
  busy: boolean;
}

/** Another busy agent on the same PR (fixing or testing it) or issue: a fresh restart would only race them. */
export function heldElsewhere(a: Omit<Holder, 'name' | 'busy'>, agents: readonly Holder[]): Holder | null {
  if (!a.repoId || !a.task) return null;
  const same = (x: Holder) =>
    a.task === 'issue' ? x.task === 'issue' && x.issueNumber !== null && x.issueNumber === a.issueNumber : x.task === a.task && x.prNumber !== null && x.prNumber === a.prNumber;
  return agents.find((x) => x.id !== a.id && x.busy && x.repoId === a.repoId && same(x)) ?? null;
}
