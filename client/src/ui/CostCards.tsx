import { useState, type ReactElement } from 'react';
import { fmtUsd } from '../ops';
import { useStore } from '../store';
import { costInsights, KIND_GROUP_LABELS, kindGroup, wasteGroups, type CostItem, type CostsView, type CostWaste, type KindGroup, type WasteGroup } from '../../../shared/costs';
import { dayKey } from '../../../shared/journal';
import { ago } from '../../../shared/usage';
import { spendLimit } from '../../../shared/progressBars';
import { ProgressBar } from './ProgressBar';
import { HoverCard, PeekCard } from './HoverCard';
import type { RepoView } from '../../../shared/types';
import { Icon } from './Icon';
import type { IconName } from './icons';

// Mission control → Where the plan goes (#106): the insight strip, the most expensive issues as ranked cards and the
// waste grouped by cause. The numbers are shared/costs.ts's; these only draw them (docs/design.md: stat card, ranked
// card, share bar).

const pct = (n: number) => `${Math.round(n * 100)}%`;
const KIND_ICON: Record<KindGroup, IconName> = { build: 'hammer', qa: 'search', fix: 'wrench', ceo: 'briefcase-business' };
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** ↑ 24% / ↓ 10%, red when the cost went up. */
function Change({ change }: { change: number | null }) {
  if (change === null || Math.round(change * 100) === 0) return <span className="muted">level</span>;
  return <span className={change > 0 ? 'costs-up' : 'costs-down'}>{`${change > 0 ? '↑' : '↓'} ${pct(Math.abs(change))}`}</span>;
}

/** The cost per merge day by day, oldest first; days without a merge are left out of the line. */
function Sparkline({ points }: { points: (number | null)[] }) {
  const vals = points.flatMap((p, i) => (p === null ? [] : [[i, p] as const]));
  if (vals.length < 2) return null;
  const max = Math.max(...vals.map(([, v]) => v));
  const min = Math.min(...vals.map(([, v]) => v));
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * 100;
  const y = (v: number) => 22 - ((v - min) / (max - min || 1)) * 20;
  return (
    <svg className="costs-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={vals.map(([i, v]) => `${x(i)},${y(v)}`).join(' ')} />
    </svg>
  );
}

/** A share bar: one segment per part, its width its share. */
function ShareBar({ parts, label }: { parts: { key: string; share: number; tone: string }[]; label: string }) {
  return (
    <span className="costs-bar" role="img" aria-label={label}>
      {parts.map((p) => (
        <span key={p.key} style={{ width: `${Math.max(p.share * 100, 1)}%`, background: p.tone }} />
      ))}
    </span>
  );
}

const KIND_TONE: Record<KindGroup, string> = { build: 'var(--ds-series-1)', qa: 'var(--ds-series-2)', fix: 'var(--ds-series-3)', ceo: 'var(--ds-series-4)' };

/** The strip over the costs: each stat taps through to the rows it counts. */
export function InsightStrip({ view, floorName, onCause }: { view: CostsView; floorName: (id: string) => string; onCause: (cause: string) => void }) {
  const i = costInsights(view, dayKey(Date.now()));
  const spend = i.today && spendLimit(i.today);
  // Each stat explains itself on hover or focus (#213): what it means, how it's counted, its last 7 days.
  const week = view.byDay.slice(0, 7).reverse();
  const tip = (title: string, children: ReactElement<Record<string, unknown>>, means: string, counted: string, spark?: number[]) => (
    <HoverCard label={title} peek={<PeekCard title={title} sub={means} stats={[['How it’s counted', counted]]} spark={spark} note={spark && spark.length > 1 ? `The last ${spark.length} days, oldest first` : undefined} />}>
      {children}
    </HoverCard>
  );
  return (
    <div className="costs-stats">
      {i.today &&
        tip(
          'Today',
          <button className="costs-stat" onClick={() => jump('costs-days')}>
            <span className="costs-stat-label">Today</span>
            <b className="costs-stat-value">{fmtUsd(i.today.usd)}</b>
            <span className="costs-stat-note">
              <Change change={i.today.change} /> vs {fmtUsd(i.today.avg)} a day
            </span>
            {spend && <ProgressBar label="Of a usual day" value={pct(i.today.usd / i.today.avg)} pct={spend.pct} tone={spend.tone} compact aria={`Today's spend: ${fmtUsd(i.today.usd)}, ${pct(i.today.usd / i.today.avg)} of the 7-day average`} />}
          </button>,
          'What the agents and the CEO spent since midnight, against a usual day.',
          'Every finished session’s cost in the ledger today; a usual day is the 7-day average',
          week.map((d) => d.usd),
        )}
      {tip(
        'Per merge',
        <button className="costs-stat" onClick={() => jump(view.byDay.length > 1 ? 'costs-days' : 'costs-floors')}>
          <span className="costs-stat-label">Per merge</span>
          <b className="costs-stat-value">{view.total.perMerge === null ? '—' : fmtUsd(view.total.perMerge)}</b>
          <Sparkline points={i.perMerge.points} />
          {i.perMerge.change !== null && (
            <span className="costs-stat-note">
              <Change change={i.perMerge.change} /> over the days
            </span>
          )}
        </button>,
        'What one merged PR costs, everything included.',
        'All sessions’ cost (builds, QA, fixes, the CEO) over the merges in the window',
        week.flatMap((d) => (d.perMerge === null ? [] : [d.perMerge])),
      )}
      {tip(
        'Waste',
        <button className="costs-stat" onClick={() => jump('costs-waste')}>
          <span className="costs-stat-label">Waste</span>
          <b className="costs-stat-value">{i.wasteShare === null ? '—' : pct(i.wasteShare)}</b>
          <span className="costs-stat-note">of spend, {fmtUsd(view.total.wasteUsd)}</span>
        </button>,
        'Spend that didn’t lead anywhere.',
        'Sessions that failed, were stopped or redone, as a share of all spend',
        week.map((d) => d.wasteUsd),
      )}
      {i.biggestCause && (
        <button
          className="costs-stat"
          onClick={() => {
            onCause(i.biggestCause!.cause);
            jump('costs-waste');
          }}
        >
          <span className="costs-stat-label">Biggest waste</span>
          <b className="costs-stat-value">{fmtUsd(i.biggestCause.usd)}</b>
          <span className="costs-stat-note">{i.biggestCause.cause}</span>
        </button>
      )}
      {i.topFloor && (
        <button className="costs-stat" onClick={() => jump('costs-floors')}>
          <span className="costs-stat-label">Costliest floor</span>
          <b className="costs-stat-value">{fmtUsd(i.topFloor.usd)}</b>
          <span className="costs-stat-note">
            {floorName(i.topFloor.repoId)}, {pct(i.topFloor.share)}
          </span>
        </button>
      )}
      {i.kinds.length > 0 && (
        <button className="costs-stat costs-stat-wide" onClick={() => jump('costs-kinds')}>
          <span className="costs-stat-label">Where it goes</span>
          <ShareBar label={i.kinds.map((k) => `${KIND_GROUP_LABELS[k.group]} ${pct(k.share)}`).join(', ')} parts={i.kinds.map((k) => ({ key: k.group, share: k.share, tone: KIND_TONE[k.group] }))} />
          <span className="costs-legend">
            {i.kinds.map((k) => (
              <span key={k.group}>
                <i style={{ background: KIND_TONE[k.group] }} />
                {KIND_GROUP_LABELS[k.group]} {pct(k.share)}
              </span>
            ))}
          </span>
        </button>
      )}
    </div>
  );
}

// ---------- the pieces of work ----------

const issueTitle = (repo: RepoView | undefined, issue: number | null, pr: number | null) =>
  (issue !== null ? repo?.issues.find((x) => x.number === issue)?.title : undefined) ?? (pr !== null ? repo?.pulls.find((x) => x.number === pr)?.title : undefined);

/** #12 and PR #40, linking to GitHub. */
function WorkChips({ repo, issue, pr }: { repo: RepoView | undefined; issue: number | null; pr: number | null }) {
  const gh = repo && `https://github.com/${repo.fullName}`;
  return (
    <>
      {issue !== null &&
        (gh ? (
          <a className="costs-chip" href={`${gh}/issues/${issue}`} target="_blank" rel="noreferrer">
            #{issue} <Icon name="external-link" />
          </a>
        ) : (
          <span className="costs-chip">#{issue}</span>
        ))}
      {pr !== null &&
        (gh ? (
          <a className="costs-chip" href={`${gh}/pull/${pr}`} target="_blank" rel="noreferrer">
            PR #{pr} <Icon name="external-link" />
          </a>
        ) : (
          <span className="costs-chip">PR #{pr}</span>
        ))}
    </>
  );
}

function FloorChip({ repo }: { repo: RepoView | undefined }) {
  if (!repo) return <span className="costs-chip">The CEO</span>;
  return (
    <span className="costs-chip costs-floor-chip" style={{ ['--accent' as string]: repo.color }}>
      Floor {repo.floor}
    </span>
  );
}

/** The Kanban icon in a card's corner: the floor's Kanban. */
function KanbanJump({ repo }: { repo: RepoView | undefined }) {
  const openOverlay = useStore((s) => s.openOverlay);
  if (!repo) return null;
  return (
    <button className="costs-corner" aria-label={`Floor ${repo.floor}'s Kanban`} title={`Floor ${repo.floor}'s Kanban`} onClick={() => openOverlay({ kind: 'kanban', repoId: repo.id })}>
      <Icon name="clipboard-list" />
    </button>
  );
}

function status(t: CostItem, repo: RepoView | undefined): 'merged' | 'open' | 'closed' | null {
  if (t.merged) return 'merged';
  if (!repo) return null;
  const open = (t.issue !== null && repo.issues.some((x) => x.number === t.issue)) || (t.pr !== null && repo.pulls.some((x) => x.number === t.pr && x.state === 'OPEN'));
  return open ? 'open' : 'closed';
}

/** The most expensive issues as ranked cards, each with a bar against the top one. */
export function TopIssues({ top, repo }: { top: CostItem[]; repo: (id: string) => RepoView | undefined }) {
  const max = top[0]?.usd || 1;
  return (
    <ol className="costs-ranked">
      {top.map((t, n) => {
        const r = repo(t.repoId);
        const st = status(t, r);
        return (
          <li key={`${t.repoId}:${t.issue}:${t.pr}`} className="costs-card" style={{ ['--accent' as string]: r?.color }}>
            <span className="costs-rank" aria-label={`Number ${n + 1}`}>
              {n + 1}
            </span>
            <div className="costs-card-main">
              <b className="costs-usd">{fmtUsd(t.usd)}</b>
              <span className="costs-title">{issueTitle(r, t.issue, t.pr) ?? (t.issue !== null ? `Issue #${t.issue}` : `PR #${t.pr}`)}</span>
              <span className="costs-chips">
                <WorkChips repo={r} issue={t.issue} pr={t.pr} />
                <FloorChip repo={r} />
                {st && <span className={`costs-chip costs-st-${st}`}>{st}</span>}
              </span>
              <span className="costs-facts">
                <span>
                  {t.sessions} session{t.sessions === 1 ? '' : 's'}
                </span>
                <span>{fmtUsd(t.usd / t.sessions)} each</span>
                {t.qaRounds > 0 && (
                  <span>
                    {t.qaRounds} QA round{t.qaRounds === 1 ? '' : 's'}
                  </span>
                )}
              </span>
              <ShareBar label={`${pct(t.usd / max)} of the top one`} parts={[{ key: 'usd', share: t.usd / max, tone: 'var(--ds-series-1)' }]} />
            </div>
            <KanbanJump repo={r} />
          </li>
        );
      })}
    </ol>
  );
}

// ---------- waste ----------

/** "2 h ago"; a tap shows the exact time (a long press has no title on a phone). */
function When({ at }: { at: number }) {
  const [exact, setExact] = useState(false);
  const full = new Date(at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <button className="costs-when" title={full} aria-label={`${ago(at, Date.now())}, ${full}`} onClick={() => setExact((x) => !x)}>
      <time dateTime={new Date(at).toISOString()}>{exact ? full : ago(at, Date.now())}</time>
    </button>
  );
}

function WasteSession({ items, usd, repo }: { items: CostWaste[]; usd: number; repo: RepoView | undefined }) {
  const w = items[0];
  const g = kindGroup(w.kind);
  return (
    <li className="costs-card costs-session" style={{ ['--accent' as string]: repo?.color }}>
      <div className="costs-card-main">
        <span className="costs-session-head">
          <b className="costs-usd">{fmtUsd(usd)}</b>
          <span title={KIND_GROUP_LABELS[g]} aria-label={KIND_GROUP_LABELS[g]}>
            <Icon name={KIND_ICON[g]} />
          </span>
          <span className="costs-who">
            <span className="costs-avatar" aria-hidden="true">
              {w.agent[0]}
            </span>
            {w.agent}
          </span>
          {items.length > 1 && <span className="costs-chip costs-repeat">{items.length}× in a row</span>}
        </span>
        <span className="costs-chips">
          <When at={w.at} />
          <WorkChips repo={repo} issue={w.issue} pr={w.pr} />
          {w.why.startsWith('QA round') && <span className="costs-chip">{w.why}</span>}
        </span>
      </div>
      <KanbanJump repo={repo} />
    </li>
  );
}

/** The waste by cause: a summary, then a group per cause that opens to its sessions. */
export function WasteCards({ view, repo, open, setOpen }: { view: CostsView; repo: (id: string) => RepoView | undefined; open: string | null; setOpen: (cause: string | null) => void }) {
  const groups: WasteGroup[] = wasteGroups(view.waste);
  const listed = view.waste.length;
  return (
    <>
      <div className="costs-waste-sum">
        <span>
          <b className="costs-usd">{fmtUsd(view.total.wasteUsd)}</b> wasted
        </span>
        <span>{view.total.usd ? pct(view.total.wasteUsd / view.total.usd) : '—'} of spend</span>
        <span>
          {view.total.wasteSessions} session{view.total.wasteSessions === 1 ? '' : 's'}
        </span>
      </div>
      {listed < view.total.wasteSessions && <p className="muted small">The newest {listed} are grouped below.</p>}
      <ul className="costs-groups">
        {groups.map((g) => {
          const on = open === g.cause;
          const id = `costs-cause-${g.cause.replace(/\W+/g, '-')}`;
          return (
            <li key={g.cause} className="costs-group">
              <button className="costs-group-head" aria-expanded={on} aria-controls={id} onClick={() => setOpen(on ? null : g.cause)}>
                <span className="costs-group-name">{g.cause}</span>
                <b className="costs-usd">{fmtUsd(g.usd)}</b>
                <span className="costs-group-count">{g.count}×</span>
                <span className="costs-caret" aria-hidden="true">
                  {on ? '▴' : '▾'}
                </span>
                <ShareBar label={`${pct(g.share)} of the waste`} parts={[{ key: 'share', share: g.share, tone: 'var(--ds-series-3)' }]} />
              </button>
              {on && (
                <ul id={id} className="costs-sessions">
                  {g.runs.map((r) => (
                    <WasteSession key={`${r.items[0].at}:${r.items[0].agent}`} items={r.items} usd={r.usd} repo={repo(r.items[0].repoId)} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
