// A task's progress (#140): build → PR → QA → fix → merge as steps, the one it's in pulsing, when it was asked for and
// how long its agent has worked on it against the floor's median issue → merge (Mission control's lead time; #349).
// Kanban cards and the agent card show the bar; the agent window and pocket's team cards show the ring.
import { STAGE_LABELS, TASK_STAGES, taskStage, taskTimes, type TaskInput } from '../../../shared/progressBars';
import type { QaView, RepoView } from '../../../shared/types';
import { qaKey, useStore, type Agent } from '../store';
import { ProgressBar, ProgressRing } from './ProgressBar';

const LABELS = TASK_STAGES.map((s) => STAGE_LABELS[s]);

/** When a task was asked for, as the floor's lead time counts it: the issue filed, else the PR opened. */
export function taskSince(repo: RepoView | undefined, issue: number | null, pr: number | null): number | null {
  const p = pr != null ? repo?.pulls.find((x) => x.number === pr) : undefined;
  const at = p ? (p.issueCreatedAt ?? p.createdAt) : repo?.issues.find((i) => i.number === issue)?.createdAt;
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Since when an agent has been on their current step, and what the card calls it (none while they're not working). */
export function agentWorking(a: Agent | undefined): { workingSince: number | null; step: string } {
  const busy = a && (a.status === 'working' || a.status === 'preparing') && a.startedAt != null;
  return { workingSince: busy ? a.startedAt : null, step: a?.task === 'qa' ? 'testing' : a?.task === 'fix' ? 'fixing' : 'working' };
}

/** An agent's task as the stage bar's input (none while they're free, and none for the CEO). */
export function agentTask(a: Agent, qa: Pick<QaView, 'status' | 'round'> | undefined): TaskInput {
  if (a.status === 'idle' || a.role === 'ceo') return { task: null, prNumber: null };
  return { task: a.task, status: a.status, prNumber: a.prNumber, qa: qa ?? null };
}

export function TaskBar({ input, repoId, since, working, name, compact, onClick, href, tap }: { input: TaskInput; repoId: string; since: number | null; working: { workingSince: number | null; step: string }; name: string; compact?: boolean; onClick?: () => void; href?: string; tap?: string }) {
  const median = useStore((s) => s.ops.floors.find((f) => f.repoId === repoId)?.leadMs ?? null);
  const st = taskStage(input);
  if (!st) return null;
  const times = taskTimes({ askedAt: since, ...working, now: Date.now(), medianMs: median, pr: input.task === null && input.prNumber != null });
  const pace = times.pace;
  return (
    <ProgressBar
      label={st.label}
      value={st.at < LABELS.length ? `${st.at + 1} of ${LABELS.length}` : 'done'}
      steps={{ labels: LABELS, at: st.at }}
      tone={pace && pace.tone !== 'neutral' && st.tone === 'neutral' ? pace.tone : st.tone}
      compact={compact}
      note={times.text}
      aria={`${name}: ${st.label}, stage ${Math.min(st.at + 1, LABELS.length)} of ${LABELS.length} (build, PR, QA, fix, merge)${times.aria ? `; ${times.aria}` : ''}`}
      onClick={onClick}
      href={href}
      tap={tap}
    />
  );
}

/** The ring form, for an avatar or a tight card: the agent's task stage; with `link`, a 44 px link to their PR. */
export function TaskRing({ agent, link }: { agent: Agent; link?: boolean }) {
  const qa = useStore((s) => (agent.prNumber ? s.qa[qaKey(agent.repoId, agent.prNumber)] : undefined));
  const st = taskStage(agentTask(agent, qa));
  if (!st) return null;
  const aria = `${agent.name}'s task: ${st.label}, stage ${Math.min(st.at + 1, LABELS.length)} of ${LABELS.length}`;
  const ring = <ProgressRing steps={{ labels: LABELS, at: st.at }} tone={st.tone} aria={aria} />;
  if (!link || !agent.prUrl) return ring;
  return (
    <a className="pr-link" href={agent.prUrl} target="_blank" rel="noreferrer" aria-label={`${aria}. Open PR #${agent.prNumber} on GitHub`} title={`${st.label}: open PR #${agent.prNumber}`}>
      {ring}
    </a>
  );
}
