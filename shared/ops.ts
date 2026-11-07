import type { QaView } from './types.ts';

// Where an open PR stands in the pipeline, for mission control's numbers (server/metrics.ts) and the Kanban's counts
// and cards (client/src/qaCard.ts), so both say the same thing.

/** A PR the office can't move on its own and the CEO has handed on: the only kind that is red and counted as "needs you". */
export const needsManager = (q: Pick<QaView, 'status' | 'ceoLooking'> | null | undefined) => q?.status === 'needs-human' && !q.ceoLooking;

/** inQa: waiting for QA, being tested or not tested yet · fixing: back with an agent · triage: the CEO is looking first. */
export type PrStage = 'inQa' | 'fixing' | 'toMerge' | 'needsYou' | 'triage';

/** The stage of an open PR, from its QA record (none: not tested yet). */
export function prStage(q: Pick<QaView, 'status' | 'ceoLooking'> | null | undefined): PrStage {
  switch (q?.status) {
    case 'passed':
      return 'toMerge';
    case 'failed':
    case 'fixing':
      return 'fixing';
    case 'needs-human':
      return needsManager(q) ? 'needsYou' : 'triage';
    default:
      return 'inQa';
  }
}

// ---------- mission control's numbers (server/metrics.ts computes them) ----------

/** One floor's numbers on mission control (or the whole office's), computed by the server from its state and history. */
export interface OpsNumbers {
  // the pipeline, right now
  ready: number; // backlog issues that can start
  building: number; // issues a developer is working on
  inQa: number; // open PRs waiting for QA or being tested (or not tested yet)
  fixing: number; // open PRs back with a developer: QA failed, checks or a conflict
  toMerge: number; // open PRs that passed QA
  needsYou: number; // open PRs waiting on the manager (needsManager)
  triage: number; // stuck PRs the CEO is looking at before they reach the manager
  // throughput
  mergedToday: number; // since midnight
  mergedHour: number; // in the last 60 minutes
  spark: number[]; // merges per clock hour over the last 24 hours, oldest first (the current hour last)
  // flow, over the last 24 hours
  leadMs: number | null; // median issue → merge
  qaWaitMs: number | null; // median wait for an agent to start testing a PR
  qaPass: number | null; // share of QA rounds that passed over 7 days, 0-1
  qaFirstPass: number | null; // share of PRs whose first QA round passed over 7 days, 0-1
  qaRoundsPerMerge: number | null; // average QA rounds per PR merged over 7 days
  qaLabErrors: number; // QA rounds the test lab failed over 7 days (#189): in none of the rates above
  // GitHub's checks, over 7 days
  ciPass: number | null; // share of check runs that passed, 0-1
  ciRuns: number;
  ciMs: number | null; // median duration
  // the team, right now
  busy: number;
  idle: number;
  errors: number;
  costToday: number; // dollars since midnight from finished sessions' reported cost: an estimate
}

export interface OpsFloor extends OpsNumbers {
  repoId: string;
  floor: number;
  alarms: number;
}

/** Something that needs the manager: a PR the office can't move (needsManager), or an agent in error for over 10 minutes. */
export interface OpsAlarm {
  id: string; // "pr:<repo>#<n>" or "agent:<id>": the manager's console opens at this card
  kind: 'pr' | 'agent';
  repoId: string;
  floor: number;
  prNumber: number | null;
  agentId: string | null;
  text: string;
  since: number;
}

/** Mission control: every floor's numbers, the office's total, and what needs the manager (oldest first). */
export interface OpsView {
  floors: OpsFloor[];
  total: OpsNumbers;
  ceoCostToday: number;
  alarms: OpsAlarm[];
}
