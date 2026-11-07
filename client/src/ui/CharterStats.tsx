import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { STATUS_LABELS, type CharterInsights, type ObjectiveInsight, type ObjectiveStatus, type StatsWindow } from '../../../shared/charterStats';
import type { CharterParts } from '../../../shared/charter';
import type { RepoView } from '../../../shared/types';
import { focusProgress, objectiveParts, objectiveProgress, type ObjectiveProgress } from '../../../shared/progressBars';
import { ProgressBar } from './ProgressBar';
import { HoverCard, PeekCard } from './HoverCard';

// The Charter tab's numbers (#105, shared/charterStats.ts): the floor's insight strip and each objective's card. Every
// number is a button that lists what it counts (PRs or issues, linked to GitHub) under its card.

/** What a tapped number lists. */
interface Shown { key: string; label: string; prs?: number[]; issues?: number[]; rules?: { rule: string; prs: number[] }[] }

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const money = (x: number | null) => (x === null ? '–' : `$${x.toFixed(2)}`);
const lead = (ms: number | null) => (ms === null ? '–' : ms < 36 * 3600_000 ? `${Math.max(1, Math.round(ms / 3600_000))} h` : `${(ms / 86_400_000).toFixed(1)} d`);
const ago = (at: number) => `${Math.round((Date.now() - at) / 86_400_000)} days ago`;

function RefList({ repo, shown }: { repo: RepoView; shown: Shown }) {
  const link = (n: number, pull: boolean) => (
    <a key={`${pull}${n}`} href={`${repo.url}/${pull ? 'pull' : 'issues'}/${n}`} target="_blank" rel="noreferrer">
      #{n}
    </a>
  );
  const none = !shown.prs?.length && !shown.issues?.length && !shown.rules?.length;
  return (
    <div className="cs-refs" role="region" aria-label={shown.label}>
      <b className="small">{shown.label}</b>
      {none && <span className="muted small">Nothing yet.</span>}
      {!!shown.prs?.length && <div className="cs-links">{shown.prs.map((n) => link(n, true))}</div>}
      {!!shown.issues?.length && <div className="cs-links">{shown.issues.map((n) => link(n, false))}</div>}
      {shown.rules?.map((r) => (
        <div key={r.rule || 'other'} className="cs-rule small">
          <span className="grow">{r.rule || 'Another standard'}</span>
          <b>{r.prs.length}</b>
          <span className="cs-links">{r.prs.map((n) => link(n, true))}</span>
        </div>
      ))}
    </div>
  );
}

/** What a number means, how it's counted, and its last 7 days against 30 (#213): its hover card. */
interface Explain {
  means: string;
  counted: string;
  trend?: [string, string];
  spark?: number[];
}

/** One number that lists what it counts when tapped, and explains itself on hover or focus. */
function Stat({ shown, open, onTap, title, children, tone, explain }: { shown: Shown; open: Shown | null; onTap: (s: Shown | null) => void; title: string; children: ReactNode; tone?: 'warn' | 'good'; explain: Explain }) {
  const on = open?.key === shown.key;
  const peek = <PeekCard title={title} sub={explain.means} stats={[['How it’s counted', explain.counted], ...(explain.trend ? ([['Last 7 days', explain.trend[0]], ['Last 30 days', explain.trend[1]]] as [string, string][]) : [])]} spark={explain.spark} />;
  return (
    <HoverCard label={title} peek={peek}>
      <button type="button" className={`cs-stat${tone ? ` cs-${tone}` : ''}`} aria-expanded={on} onClick={() => onTap(on ? null : shown)}>
        <span className="cs-stat-title">{title}</span>
        <span className="cs-stat-value">{children}</span>
      </button>
    </HoverCard>
  );
}

/** How far along an objective (or the focus) is: merged in 30 days against its open issues; tapping lists them. */
function ObjectiveBar({ id, label, p, open, onTap }: { id: string; label: string; p: ObjectiveProgress; open: Shown | null; onTap: (s: Shown | null) => void }) {
  const left = p.progress.length + p.ready.length + p.waiting.length;
  const name = id === 'focus' ? label : `${id} progress`;
  const shown: Shown = { key: `progress-${id}`, label: `${name}: merged in 30 days, then open issues (in progress, ready, waiting)`, prs: p.merged, issues: [...p.progress, ...p.ready, ...p.waiting] };
  const on = open?.key === shown.key;
  return (
    <ProgressBar
      label={label}
      value={p.share === null ? 'nothing yet' : `${p.merged.length} merged · ${left} open`}
      parts={objectiveParts(p)}
      aria={`${name}: ${p.merged.length} merged in 30 days, ${p.progress.length} in progress, ${p.ready.length} ready, ${p.waiting.length} waiting`}
      onClick={() => onTap(on ? null : shown)}
      tap={on ? 'Hide the list' : 'List them'}
      expanded={on}
    />
  );
}

/** Merges per week, the last 4 weeks, as bars. */
function Sparkline({ weeks }: { weeks: number[] }) {
  const top = Math.max(1, ...weeks);
  return (
    <svg className="cs-spark" viewBox="0 0 40 16" role="img" aria-label={`Merges per week, oldest first: ${weeks.join(', ')}`}>
      {weeks.map((n, i) => {
        const h = Math.max(1, (n / top) * 14);
        return <rect key={i} x={i * 10 + 1} y={16 - h} width={8} height={h} rx={1.5} />;
      })}
    </svg>
  );
}

/** The floor's numbers above the charter: in focus, untagged, off charter, standards broken, stalled objectives. */
export function InsightStrip({ repo, insights, days }: { repo: RepoView; insights: CharterInsights; days: StatsWindow }) {
  const [open, setOpen] = useState<Shown | null>(null);
  const f = insights.byWindow[days];
  const [w7, w30] = [insights.byWindow[7], insights.byWindow[30]];
  const stalled = insights.objectives.filter((o) => o.stalled);
  const off = f.offCharter.reduce((n, g) => n + g.prs.length, 0);
  const worst = f.standards?.find((s) => s.prs.length > 0);
  const tap = (s: Shown | null) => setOpen(s);
  const focusBar = focusProgress(insights.objectives, insights.focus);
  return (
    <div className="card cs-strip">
      {focusBar && <ObjectiveBar id="focus" label={`Current focus (${insights.focus.join(', ')})`} p={focusBar} open={open} onTap={tap} />}
      <div className="cs-grid">
        <Stat title="In focus" explain={{ means: 'The share of merges that served the current focus.', counted: 'Merged PRs whose issue names a focus objective, over all merges', trend: [pct(w7.inFocus.share), pct(w30.inFocus.share)] }} open={open} onTap={tap} shown={{ key: 'focus', label: `Merges that served the focus (${insights.focus.join(', ') || 'none named'})`, prs: f.inFocus.prs }}>
          {insights.focus.length ? pct(f.inFocus.share) : 'no focus'}
          <small>{insights.focus.length ? `of ${f.merged.length} merges` : 'name objectives in it'}</small>
        </Stat>
        <Stat title="Untagged" explain={{ means: 'Work that names no objective, so the charter can’t count it.', counted: 'Merged PRs, plus open issues, with no objective in the issue', trend: [String(w7.untagged.length), String(w30.untagged.length)] }} open={open} onTap={tap} tone={f.untagged.length + insights.untaggedIssues.length ? 'warn' : undefined} shown={{ key: 'untagged', label: 'Merged PRs, then open issues, naming no objective', prs: f.untagged, issues: insights.untaggedIssues }}>
          {f.untagged.length + insights.untaggedIssues.length}
          <small>
            {f.untagged.length} merged · {insights.untaggedIssues.length} open
          </small>
        </Stat>
        <Stat title="Off charter" explain={{ means: 'PRs that touched something the charter rules out.', counted: 'Non-goals QA flagged on merged PRs', trend: [String(w7.offCharter.reduce((n, g) => n + g.prs.length, 0)), String(w30.offCharter.reduce((n, g) => n + g.prs.length, 0))] }} open={open} onTap={tap} tone={off ? 'warn' : undefined} shown={{ key: 'off', label: 'PRs QA saw touching a non-goal', rules: f.offCharter }}>
          {off}
          <small>{off ? 'touched a non-goal' : 'no non-goal touched'}</small>
        </Stat>
        <Stat title="Standards broken" explain={{ means: 'How often QA failed a PR on one of the charter’s standards.', counted: 'QA charter checks that failed, per standard' }} open={open} onTap={tap} tone={worst ? 'warn' : undefined} shown={{ key: 'standards', label: 'QA failures per standard, the most broken first', rules: f.standards ?? [] }}>
          {f.standards ? f.standards.reduce((n, s) => n + s.prs.length, 0) : 'no data yet'}
          <small className="cs-clip">{f.standards ? (worst ? `most: ${worst.rule || 'another standard'}` : 'none broken') : 'from QA charter checks'}</small>
        </Stat>
        <Stat title="Stalled" explain={{ means: 'Objectives nothing has moved lately.', counted: 'Objectives with no merged PR in 14 days' }} open={open} onTap={tap} tone={stalled.length ? 'warn' : 'good'} shown={{ key: 'stalled', label: 'Objectives with no merge in 14 days', rules: stalled.map((o) => ({ rule: `${o.id}${o.lastMerge ? `: last merge ${ago(o.lastMerge)}` : ': never merged'}`, prs: [] })) }}>
          {stalled.length ? stalled.map((o) => o.id).join(' · ') : 'none'}
          <small>no merge in 14 days</small>
        </Stat>
      </div>
      {open && <RefList repo={repo} shown={open} />}
    </div>
  );
}

const STATUSES: ObjectiveStatus[] = ['on-track', 'at-risk', 'met'];

/** An objective as a card with its numbers over `days`. */
export function ObjectiveCard({ repo, objective, insight, days, inFocus }: { repo: RepoView; objective: CharterParts['objectives'][number]; insight?: ObjectiveInsight; days: StatsWindow; inFocus: boolean }) {
  const [open, setOpen] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const n = insight?.byWindow[days];
  const setStatus = async (v: string) => {
    setBusy(true);
    await api.setObjectiveStatus(repo.id, objective.id, (v || null) as ObjectiveStatus | null).catch(() => undefined); // toasted
    setBusy(false);
  };
  const id = objective.id;
  return (
    <li className={`cs-objective${insight?.stalled ? ' cs-stalled' : ''}`} id={`charter-${repo.id}-${id}`}>
      <div className="cs-objective-head">
        <span className="charter-id">{id}</span>
        <div className="grow">
          <b className="cs-outcome">{objective.outcome}</b>
          {objective.measure && <div className="muted small">Met when: {objective.measure}</div>}
          <div className="cs-tags">
            {inFocus && <span className="chip">In focus</span>}
            {insight?.stalled && <span className="chip cs-chip-warn">Stalled</span>}
          </div>
        </div>
        <select className={`cs-status cs-status-${insight?.status ?? 'none'}`} value={insight?.status ?? ''} disabled={busy} aria-label={`Status of ${id}`} onChange={(e) => void setStatus(e.target.value)}>
          <option value="">No status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      {n && insight ? (
        <>
          <ObjectiveBar id={id} label="Progress" p={objectiveProgress(insight)} open={open} onTap={setOpen} />
          <div className="cs-grid">
            <Stat title="Merged" explain={{ means: `PRs that moved ${id} forward.`, counted: `Merged PRs whose issue names ${id}`, trend: [String(insight.byWindow[7].prs.length), String(insight.byWindow[30].prs.length)], spark: insight.weeks }} open={open} onTap={setOpen} shown={{ key: 'merged', label: `PRs that named ${id}`, prs: n.prs }}>
              {n.prs.length}
              <small>{pct(n.share)} of all merges</small>
            </Stat>
            <Stat title="Open issues" explain={{ means: `What is still left to do for ${id}.`, counted: 'Open issues naming it: ready, in progress and waiting' }} open={open} onTap={setOpen} shown={{ key: 'open', label: `Open issues naming ${id}: ready, in progress, then waiting`, issues: [...insight.open.ready, ...insight.open.progress, ...insight.open.waiting] }}>
              {insight.open.ready.length + insight.open.progress.length + insight.open.waiting.length}
              <small>
                {insight.open.ready.length} ready · {insight.open.progress.length} in progress · {insight.open.waiting.length} waiting
              </small>
            </Stat>
            <Stat title="QA first round" explain={{ means: 'How often its PRs passed QA without a fix.', counted: 'Merged PRs that passed QA’s first round, over those QA tested', trend: [pct(insight.byWindow[7].firstPass), pct(insight.byWindow[30].firstPass)] }} open={open} onTap={setOpen} shown={{ key: 'qa', label: `${id}'s merged PRs QA tested`, prs: n.qaPrs }}>
              {pct(n.firstPass)}
              <small>{n.rounds === null ? 'no QA on record' : `${n.rounds.toFixed(1)} rounds per merge`}</small>
            </Stat>
            <Stat title="Cost" explain={{ means: `What the agents’ sessions on ${id} cost.`, counted: 'Every session on its issues and PRs, then divided by its merges', trend: [money(insight.byWindow[7].usd), money(insight.byWindow[30].usd)] }} open={open} onTap={setOpen} shown={{ key: 'cost', label: `PRs the cost per merge divides by`, prs: n.prs }}>
              {money(n.usd)}
              <small>{money(n.perMerge)} per merge</small>
            </Stat>
            <Stat title="Lead time" explain={{ means: 'How long its work takes from start to merge.', counted: 'The median from the first session on an issue to its PR’s merge', trend: [lead(insight.byWindow[7].leadMs), lead(insight.byWindow[30].leadMs)] }} open={open} onTap={setOpen} shown={{ key: 'lead', label: 'PRs it is measured on (first session → merge)', prs: n.leadPrs }}>
              {lead(n.leadMs)}
              <small>median, start → merge</small>
            </Stat>
            <Stat title="4 weeks" explain={{ means: `${id}’s merges week by week, oldest first.`, counted: 'Merged PRs naming it, per 7 days', spark: insight.weeks }} open={open} onTap={setOpen} shown={{ key: 'weeks', label: `${id}'s merges in the last 30 days`, prs: insight.byWindow[30].prs }}>
              <Sparkline weeks={insight.weeks} />
              <small>{insight.weeks.join(' · ')} a week</small>
            </Stat>
          </div>
          {open && <RefList repo={repo} shown={open} />}
        </>
      ) : (
        <p className="muted small">Its numbers show after the next sync.</p>
      )}
    </li>
  );
}
