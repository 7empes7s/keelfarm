// Who is on an account and who spent it (#409), in its usage sheet (UsageSources.tsx): "On it now" from the sessions
// really running there (not the pin), "Pinned" agents with nothing running there, and "This window" from the cost
// ledger by floor, agent and kind of task, with the most expensive issues and PRs. Every row taps through.
import { fmtUsd } from '../ops';
import { useStore, type Overlay } from '../store';
import { ago } from '../../../shared/usage';
import { KIND_GROUP_LABELS, type KindGroup } from '../../../shared/costs';
import type { UsageSplit, UsageTaskCost } from '../../../shared/types';
import { Avatar } from './phoneParts';
import { ProgressBar } from './ProgressBar';
import { floorName, onIt, runWords, taskOf } from './usageWhoRules';

const sessions = (n: number) => `${n} session${n === 1 ? '' : 's'}`;

/** "On it now" and "Pinned" for an account. `close`: the sheet goes as a row opens its page. */
export function OnItNow({ accountId, pinned, now, close }: { accountId: string; pinned: string[]; now: number; close: () => void }) {
  const account = useStore((s) => s.accounts.accounts.find((a) => a.id === accountId));
  const cli = account?.cli ?? 'claude';
  const agents = useStore((s) => s.agents);
  const repos = useStore((s) => s.repos);
  const who = onIt(accountId, pinned, agents);
  const open = (o: Overlay) => {
    close();
    useStore.getState().openOverlay(o);
  };
  return (
    <>
      <section className="us-section" aria-label="On it now">
        <b className="small">On it now</b>
        {who.now.length === 0 && <p className="muted small">Nothing runs on it right now. Sessions show here the moment one starts on it, whatever the agent is pinned to.</p>}
        {who.now.map(({ agent, run }) => {
          const task = taskOf(agent);
          return (
            <div key={agent.id} className="us-who">
              <button type="button" className="us-who-main" onClick={() => open({ kind: 'terminal', agentId: agent.id })} title={`Open ${agent.name}'s window`}>
                <Avatar name={agent.name} color={agent.color} size={32} />
                <span className="us-who-text">
                  <b>{agent.name}</b>
                  <span className="muted small">{runWords(cli, run)}</span>
                </span>
                <span className="muted small us-who-since">{ago(run.since, now)}</span>
              </button>
              <span className="us-who-chips">
                <button type="button" className="ds-btn us-chip" onClick={() => open({ kind: 'kanban', repoId: agent.repoId })} disabled={!agent.repoId || agent.role === 'ceo'}>
                  {agent.role === 'ceo' ? 'CEO' : floorName(agent.repoId, repos)}
                </button>
                {task.open ? (
                  <button type="button" className="ds-btn us-chip" onClick={() => open(task.open!)}>
                    {task.words}
                  </button>
                ) : (
                  <span className="muted small us-who-task">{task.words}</span>
                )}
              </span>
            </div>
          );
        })}
      </section>
      {who.pinned.length > 0 && (
        <section className="us-section" aria-label="Pinned">
          <b className="small">Pinned</b> <span className="muted small">their next session starts here while it has room</span>
          <span className="us-who-chips">
            {who.pinned.map((a) => (
              <button key={a.id} type="button" className="ds-btn us-chip" onClick={() => open({ kind: 'terminal', agentId: a.id })} title={`Open ${a.name}'s window`}>
                <span className="dot" style={{ background: a.color }} aria-hidden /> {a.name}
                {a.role === 'ceo' ? ' (CEO)' : ''}
              </button>
            ))}
          </span>
        </section>
      )}
    </>
  );
}

/** "This window": who spent the account's window, from the cost ledger. */
export function WindowSplit({ split, close }: { split: UsageSplit | undefined; close: () => void }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const open = (o: Overlay) => {
    close();
    useStore.getState().openOverlay(o);
  };
  if (!split) {
    return (
      <section className="us-section" aria-label="This window">
        <b className="small">This window</b>
        <p className="muted small">The office hasn't run a session on it lately. Spend by floor, agent and task shows once one finishes.</p>
      </section>
    );
  }
  const bar = (key: string, label: string, s: { usd: number; sessions: number; pct: number }, onClick?: () => void) => (
    <ProgressBar key={key} compact label={label} value={`${fmtUsd(s.usd)} · ${s.pct}%`} note={sessions(s.sessions)} pct={s.pct / 100} aria={`${label}: ${fmtUsd(s.usd)}, ${s.pct}% of the window, ${sessions(s.sessions)}`} onClick={onClick} tap={onClick ? `Open ${label}` : undefined} />
  );
  return (
    <section className="us-section" aria-label="This window">
      <span>
        <b className="small">{split.label}</b>{' '}
        <span className="muted small">
          {fmtUsd(split.usd)} · {sessions(split.sessions)} by the office
        </span>
      </span>
      <ProgressBar label="By kind" parts={split.kinds.map((k) => ({ key: k.key, label: `${KIND_GROUP_LABELS[k.key as KindGroup] ?? k.key} ${k.pct}%`, value: k.usd }))} aria={`By kind: ${split.kinds.map((k) => `${KIND_GROUP_LABELS[k.key as KindGroup] ?? k.key} ${fmtUsd(k.usd)}`).join(', ')}`} />
      {split.tasks.length > 0 && (
        <div className="us-tasks">
          {split.tasks.map((t) => (
            <TaskCard key={`${t.repoId}#${t.issue ?? t.pr}`} t={t} open={open} />
          ))}
        </div>
      )}
      <div className="us-slices">
        <span className="muted small">By floor</span>
        {split.floors.map((f) => bar(`f${f.key}`, floorName(f.key, repos), f, f.key ? () => open({ kind: 'kanban', repoId: f.key }) : undefined))}
      </div>
      <div className="us-slices">
        <span className="muted small">By agent</span>
        {split.agents.map((a) => bar(`a${a.key}`, agents[a.key]?.name ?? a.label ?? a.key, a, agents[a.key] ? () => open({ kind: 'terminal', agentId: a.key }) : undefined))}
      </div>
    </section>
  );
}

/** One of the window's most expensive tasks: its PR (else issue), floor, title and cost. */
function TaskCard({ t, open }: { t: UsageTaskCost; open: (o: Overlay) => void }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === t.repoId));
  const n = t.pr ?? t.issue!;
  const pull = t.pr !== null ? repo?.pulls.find((p) => p.number === t.pr) : undefined;
  const title = pull?.title ?? repo?.issues.find((i) => i.number === t.issue)?.title ?? '';
  const key = t.pr === null ? `i-${n}` : pull?.state === 'MERGED' ? `m-${n}` : `pr-${n}`;
  return (
    <button type="button" className="us-task" disabled={!repo} onClick={() => repo && open({ kind: 'card', repoId: repo.id, key, number: n, pr: t.pr !== null })}>
      <b>
        {t.pr === null ? '' : 'PR '}#{n} · {fmtUsd(t.usd)}
      </b>
      {title && <span className="small us-task-title">{title}</span>}
      <span className="muted small">
        {repo ? `Floor ${repo.floor}` : t.repoId} · {sessions(t.sessions)}
      </span>
    </button>
  );
}
