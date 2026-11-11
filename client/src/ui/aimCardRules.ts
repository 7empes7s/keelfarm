// What the compact aim card (AgentCard.tsx) and the floating name tag (world/draw.ts) say about an agent (#406): one
// status line, the task's share done for the thin bar, and their PR with QA's mark. Pure.
import { TASK_STAGES, type TaskProgress } from '../../../shared/progressBars';
import type { AgentView, QaStatus } from '../../../shared/types';

type Who = Pick<AgentView, 'name' | 'role' | 'status' | 'task' | 'issueNumber' | 'issueTitle' | 'prNumber' | 'waiting'>;

const FREE: Record<AgentView['status'], string> = { idle: 'Free', preparing: 'Setting up', working: 'Working', done: 'Done', error: 'Stuck', stopped: 'Stopped' };

/** One line: "Building #299 · step 1 of 5", "Testing PR #405 · round 2", "Waiting for you"… */
export function aimStatus(a: Who, stage: TaskProgress | null, round: number | null): string {
  if (a.waiting) return `Waiting for ${a.waiting === 'ceo' ? 'the CEO' : 'you'}`;
  if (a.role === 'ceo') return a.issueTitle ?? FREE[a.status];
  const busy = a.status === 'working' || a.status === 'preparing';
  if (!busy) return FREE[a.status];
  const r = round ? ` · round ${round}` : '';
  if (a.task === 'qa' && a.prNumber) return `Testing PR #${a.prNumber}${r}`;
  if (a.task === 'fix' && a.prNumber) return `Fixing PR #${a.prNumber}${r}`;
  if (a.issueNumber) return `Building #${a.issueNumber}${stage ? ` · step ${Math.min(stage.at + 1, TASK_STAGES.length)} of ${TASK_STAGES.length}` : ''}`;
  return FREE[a.status];
}

/** The thin bar's fill, 0 to 1: the task's stage out of build → PR → QA → fix → merge. */
export const aimProgress = (stage: TaskProgress | null) => (stage ? Math.min(1, (stage.at + 1) / TASK_STAGES.length) : 0);

/** QA's word on their PR, as a mark: passed, failed (or being fixed), waiting or testing, or needs you. */
export type PrMark = 'passed' | 'failed' | 'waiting' | 'you';

const MARK: Record<QaStatus, PrMark> = { queued: 'waiting', testing: 'waiting', passed: 'passed', failed: 'failed', fixing: 'failed', 'needs-human': 'you' };

/** Their PR as the chip and the name tag show it ("PR #405", with QA's mark); null without one (and for the CEO). */
export function prLabel(a: Pick<AgentView, 'role' | 'prNumber'>, qa: QaStatus | null | undefined): { text: string; mark: PrMark | null } | null {
  if (a.role === 'ceo' || a.prNumber == null) return null;
  return { text: `PR #${a.prNumber}`, mark: qa ? MARK[qa] : null };
}

/** Where the name tag's PR chip starts, as a share of the tag's width: a tap right of it opens the PR. */
export const TAG_PR_SPLIT = 0.6;
