// A floor's progress (#140, shared/progressBars.ts): its backlog as done / in progress / ready / waiting with the
// week's merges a day, its current focus, and the batches of issues the CEO filed together. Mission control shows a
// card per floor; pocket mode's floor cards show the backlog bar. Each bar opens what it counts.
import { useMemo } from 'react';
import { agentsOnRepo, useStore } from '../store';
import { backlogParts, backlogSplit, buildingOf, focusProgress, objectiveParts, planBatches, type BacklogSplit } from '../../../shared/progressBars';
import type { RepoView } from '../../../shared/types';
import { ProgressBar } from './ProgressBar';
import { Icon } from './Icon';

/** Merges per day this week as small bars, oldest first. */
function Trend({ days }: { days: number[] }) {
  const top = Math.max(1, ...days);
  return (
    <svg className="fp-trend" viewBox="0 0 70 14" aria-hidden>
      {days.map((n, i) => {
        const h = Math.max(1, (n / top) * 12);
        return <rect key={i} x={i * 10 + 1} y={14 - h} width={8} height={h} rx={1.5} />;
      })}
    </svg>
  );
}

function useBacklog(repo: RepoView): BacklogSplit {
  const agents = useStore((s) => s.agents);
  return useMemo(() => backlogSplit({ issues: repo.issues, pulls: repo.pulls, held: repo.held ?? [], building: buildingOf(agentsOnRepo(agents, repo.id)), now: Date.now() }), [repo, agents]);
}

const count = (s: BacklogSplit) => `${s.done.length} done · ${s.progress.length} in progress · ${s.ready.length} ready · ${s.waiting.length} waiting`;

/** The floor's backlog as one stacked bar; tapping it opens the floor's board. */
export function BacklogBar({ repo, onOpen, compact }: { repo: RepoView; onOpen: () => void; compact?: boolean }) {
  const s = useBacklog(repo);
  const total = s.done.length + s.progress.length + s.ready.length + s.waiting.length;
  return (
    <ProgressBar
      label="Backlog"
      value={total ? `${s.done.length} of ${total} done` : 'empty'}
      parts={backlogParts(s)}
      compact={compact}
      note={
        <>
          <Trend days={s.trend} /> {s.trend.reduce((a, b) => a + b, 0)} merged in 7 days{compact ? ` · ${s.ready.length} ready · ${s.waiting.length} waiting` : ''}
        </>
      }
      aria={`Floor ${repo.floor} backlog: ${count(s)}; merges a day this week, oldest first: ${s.trend.join(', ')}`}
      onClick={onOpen}
      tap="Open the board"
    />
  );
}

/** Mission control: a card per floor with its backlog, its focus and its plans. */
export function FloorProgress() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const openOverlay = useStore((s) => s.openOverlay);
  if (!repos.length) return null;
  return (
    <>
      <h3 className="section">
        <Icon name="trending-up" /> Progress
      </h3>
      {repos.map((repo) => {
        const insights = repo.charter.insights;
        const focus = insights ? focusProgress(insights.objectives, insights.focus) : null;
        const busy = new Set(buildingOf(agentsOnRepo(agents, repo.id)));
        const plans = planBatches(repo.issues, repo.pulls, busy);
        const board = () => openOverlay({ kind: 'kanban', repoId: repo.id });
        return (
          <div key={repo.id} className="card floor-card fp-card" style={{ ['--accent' as string]: repo.color }}>
            <div className="row">
              <span className="floor-badge">{repo.floor}</span>
              <b className="grow fp-name">{repo.fullName}</b>
            </div>
            <BacklogBar repo={repo} onOpen={board} />
            {focus && (
              <ProgressBar
                label={`Focus: ${insights!.focus.join(', ')}`}
                value={`${focus.merged.length} merged · ${focus.progress.length + focus.ready.length + focus.waiting.length} open`}
                parts={objectiveParts(focus)}
                compact
                aria={`Floor ${repo.floor}'s current focus: ${focus.merged.length} merged in 30 days, ${focus.progress.length} in progress, ${focus.ready.length} ready, ${focus.waiting.length} waiting`}
                onClick={() => openOverlay({ kind: 'manager', tab: 'charter', repoId: repo.id })}
                tap="Open the charter"
              />
            )}
            {plans.slice(0, 3).map((p) => (
              <ProgressBar
                key={p.filedAt}
                label={
                  <>
                    <Icon name="compass" /> {p.name}
                  </>
                }
                value={`${p.merged.length} of ${p.total} merged`}
                parts={[
                  { key: 'merged', label: 'Merged', value: p.merged.length },
                  { key: 'progress', label: 'In progress', value: p.progress.length },
                  { key: 'open', label: 'Not started', value: p.open.length },
                ]}
                compact
                note={`Filed by the CEO ${new Date(p.filedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
                aria={`Plan ${p.name}: ${p.merged.length} of ${p.total} merged, ${p.progress.length} in progress, ${p.open.length} not started`}
                onClick={board}
                tap="Open the board"
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
