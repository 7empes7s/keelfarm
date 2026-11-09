import { useState } from 'react';
import { fmtPct, fmtUsd } from '../ops';
import { KIND_GROUP_LABELS, kindShares, type CostsView } from '../../../shared/costs';
import { excludedCause, O2_FIRST_PASS, O2_ROUNDS_PER_MERGE, ROUND_CAUSE_LABELS, type RoundCause, type RoundStats } from '../../../shared/rounds';
import type { RepoView } from '../../../shared/types';
import './rounds.css';
import { Icon } from './Icon';
import { TrendChart } from './TrendChart';
import { firstPassBubble, lastDays, roundsBubble } from './trendPoints';

// Mission control → Rounds (#188): QA rounds per merge and the first-round pass rate against O2's targets, the failed
// rounds by cause (a cause opens to its PRs), each floor over 7 and 30 days, and cost per merge by build, QA and fix.
// The numbers are shared/rounds.ts's, in the costs view; this only draws them (docs/design.md: stat card, share bar).

const CAUSE_TONE: Record<RoundCause, string> = {
  bug: 'var(--ds-series-3)',
  nit: 'var(--ds-series-1)',
  'spec-missing': 'var(--ds-series-4)',
  conflict: 'color-mix(in srgb, var(--ds-series-4) 50%, var(--ds-series-3))',
  checks: 'color-mix(in srgb, var(--ds-series-1) 50%, var(--ds-series-3))',
  'lab-error': 'var(--ds-line-strong)',
  outage: 'var(--ds-surface-sunken)',
};

const fmtRounds = (n: number | null) => (n === null ? '—' : n.toFixed(2));

/** A trend, oldest first, with O2's target as a dashed line; days without a number are left out. */
export function TrendLine({ points, target, label }: { points: (number | null)[]; target: number; label: string }) {
  const vals = points.flatMap((p, i) => (p === null ? [] : [[i, p] as const]));
  if (vals.length < 2) return null;
  const max = Math.max(target, ...vals.map(([, v]) => v));
  const min = Math.min(target, ...vals.map(([, v]) => v));
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * 100;
  const y = (v: number) => 22 - ((v - min) / (max - min || 1)) * 20;
  return (
    <svg className="costs-spark rounds-spark" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={label}>
      <line x1="0" x2="100" y1={y(target)} y2={y(target)} />
      <polyline points={vals.map(([i, v]) => `${x(i)},${y(v)}`).join(' ')} />
    </svg>
  );
}

/** On target (green) or off it (red). */
const onTarget = (ok: boolean | null) => (ok === null ? '' : ok ? 'costs-down' : 'costs-up');

function FloorRow({ name, color, week, month }: { name: string; color: string | undefined; week: RoundStats; month: RoundStats }) {
  return (
    <tr>
      <th style={{ ['--accent' as string]: color ?? 'var(--ds-outline)' }} className="costs-floor">
        {name}
      </th>
      <td data-label="Rounds 7d">{fmtRounds(week.perMerge)}</td>
      <td data-label="1st pass 7d">{fmtPct(week.firstPass)}</td>
      <td data-label="Rounds 30d">{fmtRounds(month.perMerge)}</td>
      <td data-label="1st pass 30d">{fmtPct(month.firstPass)}</td>
    </tr>
  );
}

export function RoundsCard({ view, repo, floorName }: { view: CostsView; repo: (id: string) => RepoView | undefined; floorName: (id: string) => string }) {
  const [days, setDays] = useState<7 | 30>(7);
  const [open, setOpen] = useState<RoundCause | null>(null);
  const r = view.rounds;
  const w = days === 7 ? r.week : r.month;
  const failed = w.byCause.reduce((n, c) => n + c.rounds, 0);
  const kinds = kindShares(view.total.byKind).filter((k) => k.group !== 'ceo');
  // The trend over the switch's days: each point is the week up to that day.
  const trend = { perMerge: r.trend.perMerge.slice(-days), firstPass: r.trend.firstPass.slice(-days), merges: r.trend.merges.slice(-days) };
  const trendDays = lastDays(days, Date.now());
  return (
    <section id="ops-card-rounds" className="rounds" aria-labelledby="rounds-title">
      <h3 id="rounds-title" className="section">
        <Icon name="repeat" /> Rounds
      </h3>
      <div className="rounds-seg" role="group" aria-label="Rounds over">
        {([7, 30] as const).map((d) => (
          <button key={d} className="btn btn-small btn-ghost" aria-pressed={days === d} onClick={() => setDays(d)}>
            {d} days
          </button>
        ))}
      </div>
      <div className="costs-stats">
        <div className="costs-stat">
          <span className="costs-stat-label">Rounds per merge</span>
          <b className={`costs-stat-value ${onTarget(w.perMerge === null ? null : w.perMerge <= O2_ROUNDS_PER_MERGE)}`}>{fmtRounds(w.perMerge)}</b>
          <TrendChart
            key={days}
            values={trend.perMerge}
            target={{ value: O2_ROUNDS_PER_MERGE, better: 'lower', label: `target ≤ ${O2_ROUNDS_PER_MERGE}` }}
            label={`Rounds per merge, each day's last 7 days, over ${days} days, target ${O2_ROUNDS_PER_MERGE}`}
            bubble={(i) => roundsBubble(trendDays[i], trend.perMerge[i]!, trend.merges[i])}
          />
          <span className="costs-stat-note">
            target ≤ {O2_ROUNDS_PER_MERGE} · {w.merges} merge{w.merges === 1 ? '' : 's'}
          </span>
        </div>
        <div className="costs-stat">
          <span className="costs-stat-label">First-round pass</span>
          <b className={`costs-stat-value ${onTarget(w.firstPass === null ? null : w.firstPass >= O2_FIRST_PASS)}`}>{fmtPct(w.firstPass)}</b>
          <TrendChart
            key={days}
            values={trend.firstPass}
            target={{ value: O2_FIRST_PASS, better: 'higher', label: `target ≥ ${fmtPct(O2_FIRST_PASS)}` }}
            label={`First-round pass rate, each day's last 7 days, over ${days} days, target ${fmtPct(O2_FIRST_PASS)}`}
            bubble={(i) => firstPassBubble(trendDays[i], trend.firstPass[i]!, trend.merges[i])}
          />
          <span className="costs-stat-note">target ≥ {fmtPct(O2_FIRST_PASS)}</span>
        </div>
        <div className="costs-stat">
          <span className="costs-stat-label">Not the PR's fault</span>
          <b className="costs-stat-value">{w.excluded}</b>
          <span className="costs-stat-note">CI outage and lab error rounds, left out of the numbers</span>
        </div>
        {kinds.length > 0 && view.total.merges > 0 && (
          <div className="costs-stat costs-stat-wide">
            <span className="costs-stat-label">Cost per merge{view.total.perMerge === null ? '' : `: ${fmtUsd(view.total.perMerge)}`}</span>
            <span className="rounds-split">
              {kinds.map((k) => (
                <span key={k.group}>
                  {KIND_GROUP_LABELS[k.group]} <b>{fmtUsd(k.usd / view.total.merges)}</b>
                </span>
              ))}
            </span>
            <span className="costs-stat-note">over the same days as the costs above</span>
          </div>
        )}
      </div>
      <h4 className="rounds-sub">Failed rounds by cause {failed > 0 && <span className="badge">{failed}</span>}</h4>
      {failed === 0 ? (
        <p className="muted small">No failed rounds with a cause in these days.</p>
      ) : (
        <>
          <span className="costs-bar rounds-bar" role="img" aria-label={w.byCause.map((c) => `${ROUND_CAUSE_LABELS[c.cause]} ${c.rounds}`).join(', ')}>
            {w.byCause.map((c) => (
              <span key={c.cause} style={{ width: `${(c.rounds / failed) * 100}%`, background: CAUSE_TONE[c.cause] }} />
            ))}
          </span>
          <ul className="costs-groups">
            {w.byCause.map((c) => {
              const on = open === c.cause;
              const id = `rounds-cause-${c.cause}`;
              return (
                <li key={c.cause} className="costs-group">
                  <button className="costs-group-head" aria-expanded={on} aria-controls={id} onClick={() => setOpen(on ? null : c.cause)}>
                    <span className="costs-group-name">
                      <i className="rounds-dot" style={{ background: CAUSE_TONE[c.cause] }} aria-hidden="true" />
                      {ROUND_CAUSE_LABELS[c.cause]}
                      {excludedCause(c.cause) && <span className="muted small"> · not counted</span>}
                    </span>
                    <b>{c.rounds}</b>
                    <span className="costs-group-count">{Math.round((c.rounds / failed) * 100)}%</span>
                    <span className="costs-caret" aria-hidden="true">
                      <Icon name={on ? 'chevron-up' : 'chevron-down'} />
                    </span>
                  </button>
                  {on && (
                    <ul id={id} className="rounds-prs">
                      {c.prs.map((p) => {
                        const rp = repo(p.repoId);
                        const label = p.pr ? `PR #${p.pr}` : `#${p.issue}`;
                        const href = rp && `https://github.com/${rp.fullName}/${p.pr ? `pull/${p.pr}` : `issues/${p.issue}`}`;
                        return (
                          <li key={`${p.repoId}#${p.pr}:${p.issue}`}>
                            {href ? (
                              <a className="rounds-pr" href={href} target="_blank" rel="noreferrer" style={{ ['--accent' as string]: rp?.color }}>
                                <span>{label} <Icon name="external-link" /></span>
                                <span className="muted small">
                                  {floorName(p.repoId)} · {p.rounds}×
                                </span>
                              </a>
                            ) : (
                              <span className="rounds-pr">
                                {label} · {p.rounds}×
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {r.floors.length > 0 && (
        <div id="rounds-floors" className="costs-stack" role="region" aria-label="Rounds per floor">
          <table className="ops-table costs-table">
            <thead>
              <tr>
                <th>Floor</th>
                <th>Rounds 7d</th>
                <th>1st pass 7d</th>
                <th>Rounds 30d</th>
                <th>1st pass 30d</th>
              </tr>
            </thead>
            <tbody>
              {r.floors.map((f) => (
                <FloorRow key={f.repoId} name={floorName(f.repoId)} color={repo(f.repoId)?.color} week={f.week} month={f.month} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
