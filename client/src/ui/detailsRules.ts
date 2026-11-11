// The details pages' rules (#155, DetailsPage.tsx), pure: a QA report's checks as cards grouped Failed → Skipped →
// Passed with the failed ones open, charter violations pulled out with the standard they name, the PR's state chip,
// and CI and merge blockers as status rows.
import type { PullInfo, QaCheck, QaView } from '../../../shared/types';
import type { IconName } from './icons';

type CheckGroupId = 'fail' | 'skip' | 'pass';

interface CheckRow extends QaCheck {
  /** Starts expanded: failed checks do, skipped and passed ones don't. */
  open: boolean;
}

export interface CheckGroup {
  id: CheckGroupId;
  label: string;
  rows: CheckRow[];
}

/** A charter violation QA reported (server/qaReport.ts's "Charter check": "violation: <standard>: why"). */
export interface CharterViolation {
  standard: string;
  why: string;
}

const GROUPS: { id: CheckGroupId; label: string }[] = [
  { id: 'fail', label: 'Failed' },
  { id: 'skip', label: 'Skipped' },
  { id: 'pass', label: 'Passed' },
];

const isCharter = (c: QaCheck) => /^\W*charter check\b/i.test(c.name) && c.result === 'fail';

/** The standard a failed charter check names, and why, from its details. */
export function charterViolation(details: string): CharterViolation {
  const text = details.trim().replace(/^\W*violat\w*\s*:?\s*/i, '');
  const at = text.search(/:\s/);
  return at > 0 ? { standard: text.slice(0, at).trim(), why: text.slice(at + 1).trim() } : { standard: text, why: '' };
}

/** A report's checks: charter violations on their own, the rest grouped Failed → Skipped → Passed (empty groups left out), in QA's order. */
export function groupChecks(checks: readonly QaCheck[]): { charter: CharterViolation[]; groups: CheckGroup[] } {
  const charter = checks.filter(isCharter).map((c) => charterViolation(c.details));
  const rest = checks.filter((c) => !isCharter(c));
  const groups = GROUPS.map((g) => ({ ...g, rows: rest.filter((c) => c.result === g.id).map((c) => ({ ...c, open: c.result === 'fail' })) })).filter((g) => g.rows.length > 0);
  return { charter, groups };
}

/** Checks passed out of all of them (a charter violation counts as a failed check). */
export function checkTally(checks: readonly QaCheck[]): { passed: number; failed: number; skipped: number; total: number } {
  const n = (r: QaCheck['result']) => checks.filter((c) => c.result === r).length;
  return { passed: n('pass'), failed: n('fail'), skipped: n('skip'), total: checks.length };
}

export type ChipTone = 'good' | 'bad' | 'warn' | 'plain';

/** What a card says about QA when the office holds no QA record for its PR: an open PR's was never sent, a merged or
 *  closed one's goes with it (its rounds stay in the card's History). */
export function noQaWords(pull: Pick<PullInfo, 'state'> | undefined): { stat: string; tile: string; checks: string; section: string } {
  if (pull?.state === 'MERGED') return { stat: 'merged', tile: 'see History', checks: 'see History', section: "QA's report isn't kept after the merge: its rounds are in History." };
  if (pull?.state === 'CLOSED') return { stat: 'closed', tile: 'see History', checks: 'see History', section: "QA's report isn't kept for a closed PR: its rounds are in History." };
  return { stat: 'not in QA yet', tile: 'not sent yet', checks: 'no report yet', section: 'Not sent to QA yet.' };
}

/** The state chip on a card's header: where it is in the build → QA → fix → merge loop. */
export function stateChip(qa: Pick<QaView, 'status'> | undefined, pull: Pick<PullInfo, 'state' | 'isDraft'> | undefined, issueOnly: boolean): { label: string; tone: ChipTone } {
  if (pull?.state === 'MERGED') return { label: 'Merged', tone: 'good' };
  if (pull?.state === 'CLOSED') return { label: 'Closed', tone: 'plain' };
  if (issueOnly) return { label: 'Issue', tone: 'plain' };
  switch (qa?.status) {
    case 'testing':
      return { label: 'Testing', tone: 'warn' };
    case 'queued':
      return { label: 'Waiting for QA', tone: 'plain' };
    case 'fixing':
      return { label: 'Fixing', tone: 'warn' };
    case 'failed':
      return { label: 'Failed QA', tone: 'bad' };
    case 'needs-human':
      return { label: 'Needs you', tone: 'bad' };
    case 'passed':
      return { label: 'Passed', tone: 'good' };
  }
  return { label: pull?.isDraft ? 'Draft' : 'Open', tone: 'plain' };
}

export interface StatusRow {
  key: string;
  tone: ChipTone;
  /** Lucide icon, or null for a plain dash (no checks). */
  icon: IconName | null;
  label: string;
  detail?: string;
  url?: string | null;
}

/** GitHub's checks and what stands between the PR and a merge, one row each. */
export function mergeRows(pull: Pick<PullInfo, 'state' | 'checks' | 'failedChecks' | 'pendingChecks' | 'mergeable' | 'mergeState' | 'isDraft'>, base: string): StatusRow[] {
  const rows: StatusRow[] = [];
  if (pull.checks === 'passing') rows.push({ key: 'checks', tone: 'good', icon: 'check', label: 'All checks pass' });
  else if (pull.checks === 'failing') rows.push({ key: 'checks', tone: 'bad', icon: 'x', label: 'Checks failing' });
  else if (pull.checks === 'pending') rows.push({ key: 'checks', tone: 'warn', icon: 'hourglass', label: 'Checks running', detail: pull.pendingChecks.join(', ') || undefined });
  else rows.push({ key: 'checks', tone: 'plain', icon: null, label: 'No checks' });
  for (const c of pull.failedChecks) rows.push({ key: `fail:${c.name}`, tone: 'bad', icon: 'x', label: c.name, detail: 'failed', url: c.url });
  if (pull.state !== 'OPEN') return rows;
  if (pull.mergeable === 'CONFLICTING' || pull.mergeState === 'DIRTY') rows.push({ key: 'conflict', tone: 'bad', icon: 'triangle-alert', label: `Conflicts with ${base}`, detail: 'It has to merge the base branch before it can land' });
  else if (pull.mergeState === 'BEHIND') rows.push({ key: 'behind', tone: 'warn', icon: 'arrow-down', label: `Behind ${base}`, detail: 'The office brings it up to date before merging' });
  else if (pull.mergeState === 'BLOCKED') rows.push({ key: 'blocked', tone: 'warn', icon: 'ban', label: 'Blocked by branch rules', detail: 'A required review or check is missing' });
  if (pull.isDraft) rows.push({ key: 'draft', tone: 'plain', icon: 'pencil', label: 'Draft', detail: 'GitHub will not merge a draft' });
  return rows;
}
