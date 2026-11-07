import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtUsd } from '../ops';
import { useStore } from '../store';
import { effortHint, isCeoKind, TASK_KIND_LABELS, TASK_KINDS, type CostsView, type CostSplit, type TaskKind } from '../../../shared/costs';
import type { EffortLevel } from '../../../shared/types';
import { EFFORTS } from './AgentSettings';
import { EmptyState } from './EmptyState';
import { InsightStrip, TopIssues, WasteCards } from './CostCards';
import { Icon } from './Icon';
import { RoundsCard } from './RoundsCard';
import { ConflictsCard } from './ConflictsCard';
import './costs.css';

// Mission control → Where the plan goes (#18): the cost ledger, loaded on demand (it's never in the snapshot). The
// insight strip, cost per merged PR per floor and per day, split by task kind; QA rounds by cause (RoundsCard.tsx); the
// most expensive issues; and the waste by cause (CostCards.tsx), each linking to its issue or PR.

const DAYS = [1, 7, 30];

const perMerge = (s: CostSplit) => (s.perMerge === null ? '—' : fmtUsd(s.perMerge));

/** A floor's or day's numbers as table cells, labelled for the card each row becomes on a phone. */
function SplitCells({ s }: { s: CostSplit }) {
  return (
    <>
      <td data-label="Cost">{fmtUsd(s.usd)}</td>
      <td data-label="Merged">{s.merges}</td>
      <td data-label="Per merge">{perMerge(s)}</td>
      <td data-label="Waste">{s.wasteUsd ? fmtUsd(s.wasteUsd) : '—'}</td>
    </>
  );
}

function KindSplit({ split }: { split: CostSplit }) {
  const kinds = (Object.entries(split.byKind) as [TaskKind, number][]).sort((a, b) => b[1] - a[1]);
  if (!kinds.length) return null;
  return (
    <ul id="costs-kinds" className="costs-kinds small">
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

const kTokens = (n: number) => `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;

/** What each kind of session loads before its first step (#50): measured from its first turn, with its largest parts. */
function StartupTable({ view }: { view: CostsView }) {
  if (!view.startup.length) return null;
  return (
    <>
      <h3 className="section">
        <Icon name="package" /> What sessions load at startup
      </h3>
      <div className="ops-table-wrap" tabIndex={0} role="region" aria-label="Startup context per kind of task">
        <table className="ops-table costs-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Tokens</th>
              <th>Largest parts</th>
            </tr>
          </thead>
          <tbody>
            {view.startup.map((r) => (
              <tr key={r.kind}>
                <th>{TASK_KIND_LABELS[r.kind]}</th>
                <td title={`average of ${r.sessions} session${r.sessions === 1 ? '' : 's'}`}>{kTokens(r.avg)}</td>
                <td className="small costs-parts">{r.top.map((p) => `${p.label} ${kTokens(p.tokens)}`).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">The first turn's input, before any work. Lean sessions and role profiles in Settings → Tools &amp; skills cut the plugins, MCP servers and connectors in it.</p>
    </>
  );
}

export function CostsSection() {
  const repos = useStore((s) => s.repos);
  const [days, setDays] = useState(7);
  const [repoId, setRepoId] = useState('');
  const [view, setView] = useState<CostsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [cause, setCause] = useState<string | null>(null); // the waste group that's open
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
    <div id="ops-card-costs" className="costs" data-tour="costs">
      <h3 className="section">
        <Icon name="wallet" /> Where the plan goes
      </h3>
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
          <InsightStrip view={view} floorName={floorName} onCause={setCause} />
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
          <RoundsCard view={view} repo={repo} floorName={floorName} />
          <ConflictsCard view={view} repoId={repoId} />
          <div id="costs-floors" className="costs-stack" role="region" aria-label="Cost per floor">
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
                    <SplitCells s={f} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.byDay.length > 1 && (
            <div id="costs-days" className="costs-stack" role="region" aria-label="Cost per day">
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
                      <SplitCells s={d} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <StartupTable view={view} />
          <h3 className="section">
            <Icon name="tag" /> Most expensive issues
          </h3>
          <TopIssues top={view.top} repo={repo} />
          <h3 id="costs-waste" className="section">
            <Icon name="trash-2" /> Waste {view.total.wasteSessions > 0 && <span className="badge">{view.total.wasteSessions}</span>}
          </h3>
          {view.waste.length === 0 ? (
            <EmptyState kind="waste" compact />
          ) : (
            <WasteCards view={view} repo={repo} open={cause} setOpen={setCause} />
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
