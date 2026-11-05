import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtUsd } from '../ops';
import { useStore } from '../store';
import { effortHint, isCeoKind, TASK_KIND_LABELS, TASK_KINDS, type CostsView, type CostSplit, type TaskKind } from '../../../shared/costs';
import type { EffortLevel, RepoView } from '../../../shared/types';
import { EFFORTS } from './AgentSettings';
import './costs.css';

// Mission control → Where the plan goes (#18): the cost ledger, loaded on demand (it's never in the snapshot). Cost per
// merged PR per floor and per day, split by task kind; the most expensive issues; and the waste list, each row linking
// to its issue or PR.

const DAYS = [1, 7, 30];

const perMerge = (s: CostSplit) => (s.perMerge === null ? '—' : fmtUsd(s.perMerge));

/** "#12" linking to the issue (or "PR #40" to the PR) on GitHub, plus the floor's Kanban. */
function WorkLink({ repo, issue, pr }: { repo: RepoView | undefined; issue: number | null; pr: number | null }) {
  const openOverlay = useStore((s) => s.openOverlay);
  if (!repo) return <span className="muted">{issue !== null ? `#${issue}` : pr !== null ? `PR #${pr}` : 'the company'}</span>;
  const href = issue !== null ? `https://github.com/${repo.fullName}/issues/${issue}` : pr !== null ? `https://github.com/${repo.fullName}/pull/${pr}` : null;
  const title = issue !== null ? repo.issues.find((i) => i.number === issue)?.title : repo.pulls.find((p) => p.number === pr)?.title;
  return (
    <>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={title ?? 'Open on GitHub'}>
          {issue !== null ? `#${issue}` : `PR #${pr}`}
          {issue !== null && pr !== null ? ` · PR #${pr}` : ''} ↗
        </a>
      ) : (
        <span className="muted">floor {repo.floor}</span>
      )}{' '}
      <button className="btn btn-small btn-ghost" title={`Floor ${repo.floor}'s Kanban`} onClick={() => openOverlay({ kind: 'kanban', repoId: repo.id })}>
        📋
      </button>
    </>
  );
}

function KindSplit({ split }: { split: CostSplit }) {
  const kinds = (Object.entries(split.byKind) as [TaskKind, number][]).sort((a, b) => b[1] - a[1]);
  if (!kinds.length) return null;
  return (
    <ul className="costs-kinds small">
      {kinds.map(([k, usd]) => (
        <li key={k}>
          <span>{TASK_KIND_LABELS[k]}</span>
          <b>{fmtUsd(usd)}</b>
          <span className="muted">{split.merges ? `${fmtUsd(usd / split.merges)} / merge` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

export function CostsSection() {
  const repos = useStore((s) => s.repos);
  const [days, setDays] = useState(7);
  const [repoId, setRepoId] = useState('');
  const [view, setView] = useState<CostsView | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    api
      .costs(days, repoId || undefined)
      .then(setView, () => undefined) // api() already toasted the error
      .finally(() => setLoading(false));
  }, [days, repoId]);
  useEffect(load, [load]);
  const repo = (id: string) => repos.find((r) => r.id === id);
  const floorName = (id: string) => {
    const r = repo(id);
    return id === '' ? 'The CEO' : r ? `${r.floor} · ${r.fullName.split('/')[1]}` : id;
  };
  return (
    <div id="ops-card-costs" className="costs">
      <h3 className="section">💸 Where the plan goes</h3>
      <div className="row wrap">
        <select aria-label="Days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {d === 1 ? 'Today' : `Last ${d} days`}
            </option>
          ))}
        </select>
        <select aria-label="Floor" value={repoId} onChange={(e) => setRepoId(e.target.value)}>
          <option value="">All floors</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              Floor {floorName(r.id)}
            </option>
          ))}
        </select>
        <button className="btn btn-small btn-ghost" disabled={loading} onClick={load}>
          ↻ Refresh
        </button>
      </div>
      {!view ? (
        <p className="muted small">{loading ? 'Reading the ledger…' : 'No ledger to show.'}</p>
      ) : view.total.sessions === 0 ? (
        <p className="muted small">No finished sessions in this time yet. Every session that ends is written down here, with what it cost and what came of it.</p>
      ) : (
        <>
          <div className="card costs-total">
            <div className="row wrap">
              <b>~{fmtUsd(view.total.usd)}</b>
              <span className="muted small">
                {view.total.sessions} sessions · {view.total.merges} merged PR{view.total.merges === 1 ? '' : 's'}
              </span>
              <span className="spacer" />
              <span className="pill" title="Cost divided by merged PRs">
                {perMerge(view.total)} per merge
              </span>
              {view.total.wasteUsd > 0 && (
                <span className="pill costs-waste-pill" title="Sessions listed under Waste">
                  {fmtUsd(view.total.wasteUsd)} waste
                </span>
              )}
            </div>
            <KindSplit split={view.total} />
          </div>
          <div className="ops-table-wrap" tabIndex={0} role="region" aria-label="Cost per floor">
            <table className="ops-table costs-table">
              <thead>
                <tr>
                  <th>Floor</th>
                  <th>Cost</th>
                  <th>Merged</th>
                  <th>Per merge</th>
                  <th>Waste</th>
                </tr>
              </thead>
              <tbody>
                {view.floors.map((f) => (
                  <tr key={f.repoId}>
                    <th style={{ ['--accent' as string]: repo(f.repoId)?.color ?? '#1f1d2b' }} className="costs-floor">
                      {floorName(f.repoId)}
                    </th>
                    <td>{fmtUsd(f.usd)}</td>
                    <td>{f.merges}</td>
                    <td>{perMerge(f)}</td>
                    <td>{f.wasteUsd ? fmtUsd(f.wasteUsd) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.byDay.length > 1 && (
            <div className="ops-table-wrap" tabIndex={0} role="region" aria-label="Cost per day">
              <table className="ops-table costs-table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Cost</th>
                    <th>Merged</th>
                    <th>Per merge</th>
                    <th>Waste</th>
                  </tr>
                </thead>
                <tbody>
                  {view.byDay.map((d) => (
                    <tr key={d.day}>
                      <th>{new Date(`${d.day}T12:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</th>
                      <td>{fmtUsd(d.usd)}</td>
                      <td>{d.merges}</td>
                      <td>{perMerge(d)}</td>
                      <td>{d.wasteUsd ? fmtUsd(d.wasteUsd) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 className="section">🏷️ Most expensive issues</h3>
          <ol className="costs-list small">
            {view.top.map((t) => (
              <li key={`${t.repoId}:${t.issue}:${t.pr}`}>
                <b>{fmtUsd(t.usd)}</b> <WorkLink repo={repo(t.repoId)} issue={t.issue} pr={t.pr} />
                <span className="muted">
                  {' '}
                  · {t.sessions} session{t.sessions === 1 ? '' : 's'} · floor {repo(t.repoId)?.floor ?? '?'}
                  {t.merged ? ' · merged' : ''}
                </span>
              </li>
            ))}
          </ol>
          <h3 className="section">
            🗑️ Waste {view.waste.length > 0 && <span className="badge">{view.waste.length}</span>}
          </h3>
          {view.waste.length === 0 ? (
            <p className="muted small">Nothing wasted: every session ended with a PR, a commit or a verdict.</p>
          ) : (
            <ul id="costs-waste" className="costs-list small">
              {view.waste.map((w) => (
                <li key={`${w.at}:${w.kind}:${w.agent}`}>
                  <b>{fmtUsd(w.usd)}</b> {TASK_KIND_LABELS[w.kind]}: {w.why} · <WorkLink repo={repo(w.repoId)} issue={w.issue} pr={w.pr} />
                  <span className="muted"> · {w.agent} · {new Date(w.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Settings → Effort per kind of task: defaults the manager can set, with what the ledger says each kind cost. */
export function EffortByKind() {
  const settings = useStore((s) => s.settings);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CostsView | null>(null);
  useEffect(() => {
    if (open && !view) api.costs(30).then(setView, () => undefined);
  }, [open, view]);
  const set = (kind: TaskKind, effort: EffortLevel | '') => void api.setTaskEffort(kind, effort).catch(() => undefined); // api() already toasted the error
  const chosen = Object.keys(settings.taskEffort).length;
  return (
    <details className="effort-kinds" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="small">
        <b>Effort per kind of task</b> {chosen ? `(${chosen} set)` : '(all at the default)'}
      </summary>
      <p className="muted small">An agent's own effort (Team tab) still wins. A kind left on the default runs at the default effort ({settings.defaultEffort}; the CEO's own for the CEO).</p>
      {TASK_KINDS.map((kind) => {
        const fallback: EffortLevel = isCeoKind(kind) ? 'xhigh' : settings.defaultEffort;
        const hint = effortHint(kind, view?.kinds.find((k) => k.kind === kind), fallback);
        return (
          <label key={kind} className="field">
            <span>{TASK_KIND_LABELS[kind]}</span>
            <select value={settings.taskEffort[kind] ?? ''} onChange={(e) => set(kind, e.target.value as EffortLevel | '')}>
              <option value="">default</option>
              {EFFORTS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            {hint && <span className="muted small">{hint}</span>}
          </label>
        );
      })}
    </details>
  );
}
