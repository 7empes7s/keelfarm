// One plain-language phrase per agent and card status, plus what happens next (#109): "In QA with Margaret · merges
// by itself when green". Every place that shows a status (pills, the Team tab, Kanban cards) words it from here, so
// the office says the same thing everywhere. Pure.
import type { AgentStatus, PullInfo, QaView } from '../../../shared/types';

/** The pill's short word for each status (StatusPill.tsx, pocket's Team tab). */
export const STATUS_WORD: Record<string, string> = {
  idle: 'free',
  preparing: 'setting up',
  working: 'working',
  done: 'done',
  error: 'needs help',
  stopped: 'stopped',
  'waiting-ceo': 'waiting for CEO',
  'waiting-you': 'waiting for you',
};

export interface AgentLike {
  status: AgentStatus;
  task: 'issue' | 'qa' | 'fix' | null;
  issueNumber: number | null;
  prNumber: number | null;
  blocked?: string | null;
  waiting?: 'ceo' | 'manager' | null;
  reviewedBy?: string | null;
  needsSignIn?: boolean;
}

/** What an agent is doing, and what happens next. `autoAssign`: their floor hands out work by itself. */
export function agentPhrase(a: AgentLike, o: { autoAssign?: boolean } = {}): string {
  const working = a.status === 'working' || a.status === 'preparing';
  if (a.needsSignIn) return 'Waiting for you to sign their coding agent in · open their terminal';
  if (a.blocked && working) return 'Stuck on a prompt · the office tells you if it lasts 5 minutes';
  if (a.reviewedBy && working) return `${a.reviewedBy} is reviewing your change · they decide if this work goes on`;
  if (a.waiting && !working) return a.waiting === 'ceo' ? 'Asked a question · the CEO answers, then they carry on' : 'Asked you a question · answer in the chat and they carry on';
  const pr = a.prNumber != null ? `PR #${a.prNumber}` : 'a PR';
  switch (a.status) {
    case 'idle':
      return o.autoAssign ? 'Free · gets the next ready issue by itself' : 'Free · waiting for you to hand them work';
    case 'preparing':
      return 'Setting up their desk · starts working in a moment';
    case 'working':
      if (a.task === 'qa') return `Testing ${pr} · the verdict goes on the PR`;
      if (a.task === 'fix') return `Fixing ${pr} · goes back to QA after`;
      return `Building${a.issueNumber != null ? ` #${a.issueNumber}` : ''} · opens a PR, then QA tests it`;
    case 'done':
      if (a.task === 'issue' && a.prNumber != null) return `Opened ${pr} · QA tests it next`;
      return 'Done · free for the next task';
    case 'error':
      return 'Needs help · open their terminal to see why';
    case 'stopped':
      return 'Stopped · hand them work to start again';
  }
}

/** An open PR's card: where it stands and what happens next. `who`: an agent's name by id. */
export function cardPhrase(
  rec: Pick<QaView, 'status' | 'qaAgentId' | 'devAgentId' | 'ceoLooking'> | null | undefined,
  pr: Pick<PullInfo, 'isDraft' | 'mergeable' | 'checks'> | null | undefined,
  autoMerge: boolean,
  who: (id: string | null) => string | undefined = () => undefined,
): string {
  const after = autoMerge ? 'merges by itself when green' : 'then it waits for your merge';
  switch (rec?.status) {
    case 'queued':
      return `Waiting for QA · a free agent tests it next, ${after}`;
    case 'testing': {
      const qa = who(rec.qaAgentId);
      return `In QA${qa ? ` with ${qa}` : ''} · ${after}`;
    }
    case 'failed': {
      const dev = who(rec.devAgentId);
      return `QA found problems · back to ${dev ?? 'the developer'} for a fix`;
    }
    case 'fixing': {
      const dev = who(rec.devAgentId);
      return `Being fixed${dev ? ` by ${dev}` : ''} · QA tests it again after`;
    }
    case 'passed':
      if (pr?.mergeable === 'CONFLICTING') return 'Passed QA · has conflicts, so it goes back for a fix';
      if (pr?.checks === 'failing') return "Passed QA · GitHub's checks fail, so it goes back for a fix";
      return autoMerge ? 'Passed QA · merges by itself when checks are green' : 'Passed QA · waiting for you to merge';
    case 'needs-human':
      return rec.ceoLooking ? 'Stuck · the CEO looks first, then asks you' : 'Needs you · retry QA, send it back or merge anyway';
    default:
      return pr?.isDraft ? 'Draft · QA tests it once it is ready' : `Not tested yet · goes to QA next, ${after}`;
  }
}
