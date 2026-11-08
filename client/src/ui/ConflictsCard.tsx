import { fmtUsd } from '../ops';
import { useStore } from '../store';
import type { CostsView } from '../../../shared/costs';
import { O2_ROUNDS_PER_MERGE } from '../../../shared/rounds';
import { Icon } from './Icon';
import { TrendLine } from './RoundsCard';
import './conflicts.css';

// Mission control → Conflicts (#256): conflict rounds per merge over 7 days with its trend, the issues conflict-aware
// scheduling started instead of overlapping ones, what cheap conflict-only fixes saved, and the top 10 hot files. The
// numbers come from the costs view (shared/conflicts.ts), mission control's ops and the floors' hot files.

/** Repeat rounds O2 leaves room for: everything over the first round, per merge. */
const REPEAT_BUDGET = Math.round((O2_ROUNDS_PER_MERGE - 1) * 100) / 100;

export function ConflictsCard({ view, repoId }: { view: CostsView; repoId: string }) {
  const repos = useStore((s) => s.repos);
  const avoidedBy = useStore((s) => s.ops.avoided);
  const c = view.conflicts;
  if (!c) return null;
  const shown = repos.filter((r) => !repoId || r.id === repoId);
  const avoided = shown.reduce((n, r) => n + (avoidedBy?.[r.id] ?? 0), 0);
  const hot = shown
    .flatMap((r) => (r.hotFiles ?? []).map((f) => ({ ...f, floor: r.floor, color: r.color })))
    .sort((a, b) => b.score - a.score || b.conflicts - a.conflicts)
    .slice(0, 10);
  const max = Math.max(1, ...hot.map((f) => f.score));
  const many = shown.length > 1;
  return (
    <section id="ops-card-conflicts" className="conflicts" aria-labelledby="conflicts-title">
      <h3 id="conflicts-title" className="section">
        <Icon name="git-merge" /> Conflicts
      </h3>
      <div className="costs-stats">
        <div className="costs-stat">
          <span className="costs-stat-label">Conflict rounds per merge</span>
          <b className={`costs-stat-value ${c.perMerge === null ? '' : c.perMerge <= REPEAT_BUDGET ? 'costs-down' : 'costs-up'}`}>{c.perMerge === null ? '—' : c.perMerge.toFixed(2)}</b>
          <TrendLine points={c.trend} target={REPEAT_BUDGET} label={`Conflict rounds per merge over 30 days, target ${REPEAT_BUDGET}`} />
          <span className="costs-stat-note">last 7 days · target ≤ {REPEAT_BUDGET}</span>
        </div>
        <div className="costs-stat">
          <span className="costs-stat-label">Avoided by scheduling</span>
          <b className="costs-stat-value">{avoided}</b>
          <span className="costs-stat-note">issues started instead of one on busy files, 7 days</span>
        </div>
        <div className="costs-stat">
          <span className="costs-stat-label">Saved by cheap rounds</span>
          <b className="costs-stat-value">{c.savedUsd === null ? '—' : fmtUsd(c.savedUsd)}</b>
          <span className="costs-stat-note">
            {c.cheapRounds} conflict-only fix{c.cheapRounds === 1 ? '' : 'es'} on the cheaper model, 7 days{c.savedUsd === null && c.cheapRounds ? ' · no normal one to compare yet' : ''}
          </span>
        </div>
      </div>
      <h4 className="rounds-sub">Hot files</h4>
      {hot.length === 0 ? (
        <p className="muted small">No hot files yet. They show once file leases or conflict-aware scheduling is on for a floor (Floors tab → Version control).</p>
      ) : (
        <ol className="conflicts-hot" aria-label="Top 10 hot files">
          {hot.map((f) => (
            <li key={`${f.floor}:${f.path}`} title={`${f.conflicts} conflict fix${f.conflicts === 1 ? '' : 'es'}, score ${f.score}`}>
              <code className="conflicts-path">
                {many && <span className="muted">{f.floor} · </span>}
                {f.path}
              </code>
              <span className="conflicts-track" aria-hidden="true">
                <span style={{ width: `${(f.score / max) * 100}%`, ['--accent' as string]: f.color }} />
              </span>
              <b className="conflicts-n">{f.conflicts}</b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
