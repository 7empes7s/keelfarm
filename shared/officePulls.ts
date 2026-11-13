// Which open PRs the office takes on (#632): every trusted PR from a branch of the repo itself, whatever its name, goes
// through QA, fix rounds on its own branch and auto-merge. The office leaves one alone only for a reason it can say:
// a draft, an outsider's (#185), a `manual` label, or the floor's "Leave my own PRs alone" for branches it didn't make.
// Pure, for the server's sync and merge loop, the CEO's status and the Kanban.

import { OUTSIDE_PR } from './trust.ts';
import type { PullInfo } from './types.ts';

/** A PR with this label is the manager's to merge: the office never queues or merges it. */
export const MANUAL_LABEL = 'manual';

/** Why the office leaves an open PR alone. */
export type PullSkip = 'outside' | 'manual' | 'own' | 'draft';

/** A branch the office's own agents made (`swarm/issue-<n>-<name>` and the like). */
const officeBranch = (headRefName: string) => headRefName.startsWith('swarm/');

/** Why the office leaves this open PR alone, or null when it owns it. `leaveOwn`: the floor's "Leave my own PRs alone". */
export function pullSkip(p: Pick<PullInfo, 'isDraft' | 'untrusted' | 'manual' | 'headRefName'>, leaveOwn: boolean): PullSkip | null {
  if (p.untrusted) return 'outside';
  if (p.manual) return 'manual';
  if (leaveOwn && !officeBranch(p.headRefName)) return 'own';
  return p.isDraft ? 'draft' : null;
}

/** What the CEO's status says about a PR the office leaves alone, never just "not tested". */
export const SKIP_WORDS: Record<PullSkip, string> = {
  outside: 'from outside: the manager reviews it on GitHub',
  manual: `labelled ${MANUAL_LABEL}: the manager merges it`,
  own: "the manager's own PR: this floor leaves those alone",
  draft: 'a draft: tested once it is ready for review',
};

/** The Kanban card's short note for the same. */
export const SKIP_NOTES: Record<PullSkip, string> = { outside: OUTSIDE_PR, manual: 'labelled manual · you merge it', own: 'your own PR · left alone', draft: 'draft' };
