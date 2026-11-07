// A task's progress (#140): build → PR → QA → fix → merge as steps, the one it's in pulsing, and its time since the
// issue was filed against the floor's median issue → merge (Mission control's lead time). Kanban cards and the agent
// card show the bar; the agent window and pocket's team cards show the ring.
import { leadPace, STAGE_LABELS, TASK_STAGES, taskStage, type TaskInput } from '../../../shared/progressBars';
import type { QaView, RepoView } from '../../../shared/types';
import { qaKey, useStore, type Agent } from '../store';
import { ProgressBar, ProgressRing } from './ProgressBar';

const LABELS = TASK_STAGES.map((s) => STAGE_LABELS[s]);

const span = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.round(m / 1440)}d`;
};

/** When the work on a task began, as the floor's lead time counts it: the issue filed, else the PR opened. */
export function taskSince(repo: RepoView | undefined, issue: number | null, pr: number | null): number | null {
  const p = pr != null ? repo?.pulls.find((x) => x.number === pr) : undefined;
  const at = p ? (p.issueCreatedAt ?? p.createdAt) : repo?.issues.find((i) => i.number === issue)?.createdAt;
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** An agent's task as the stage bar's input (none while they're free, and none for the CEO). */
export function agentTask(a: Agent, qa: Pick<QaView, 'status' | 'round'> | undefined): TaskInput {
  if (a.status === 'idle' || a.role === 'ceo') return { task: null, prNumber: null };
  return { task: a.task, status: a.status, prNumber: a.prNumber, qa: qa ?? null };
}

export function TaskBar({ input, repoId, since, name, compact, onClick, href, tap }: { input: TaskInput; repoId: string; since: number | null; name: string; compact?: boolean; onClick?: () => void; href?: string; tap?: string }) {
  const median = useStore((s) => s.ops.floors.find((f) => f.repoId === repoId)?.leadMs ?? null);
  const st = taskStage(input);
  if (!st) return null;
  const pace = leadPace(since, Date.now(), median);
  const note = pace && (pace.ratio > 1 ? `${span(pace.elapsedMs)} so far, ${pace.ratio.toFixed(1)}× the floor's median ${span(pace.medianMs)}` : `${span(pace.elapsedMs)} so far · median ${span(pace.medianMs)}`);
  return (
    <ProgressBar
      label={st.label}
      value={st.at < LABELS.length ? `${st.at + 1} of ${LABELS.length}` : 'done'}
      steps={{ labels: LABELS, at: st.at }}
      tone={pace && pace.tone !== 'neutral' && st.tone === 'neutral' ? pace.tone : st.tone}
      compact={compact}
      note={note}
      aria={`${name}: ${st.label}, stage ${Math.min(st.at + 1, LABELS.length)} of ${LABELS.length} (build, PR, QA, fix, merge)${note ? `; ${note}` : ''}`}
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
