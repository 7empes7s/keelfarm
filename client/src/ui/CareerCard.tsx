// Careers (#226) in the HUD and the panels: an agent's career card (portrait, rank, badges, stats, last merged PRs and
// what they're known for), the card that pops up when you look at a desk for a moment, the agent window's Profile tab
// (#117, with usage and a timeline since #205) and the Team tab's highlights, table (cards on a phone) and past agents.
import { useEffect, useRef, useState } from 'react';
import { avgFixRounds, badges, costPerMerge, durationText, firstRoundRate, knownFor, medianToMerge, mergesThisWeek, passRate, profileStats, rank, spendShare, tenureDays, thisWeek, wasteShare, weeklySeries, workIdle, type CareerView } from '../../../shared/careers';
import { agentsOnRepo, useStore, type Agent } from '../store';
import { Icon, IconText } from './Icon';
import { CareerTimeline, Highlights, hours, rigText, Spark, usageText, usd, UsageInsights } from './CareerInsights';
import { drawPortrait } from './portrait';
import { ProfileVoice } from './ProfileVoice';
import './charter.css'; // the stat cards (docs/design.md)

const PEEK_MS = 700;
const LAST = 5;

export const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
export const fixed1 = (x: number | null) => (x === null ? '—' : x.toFixed(1));

/** "3 days", "5 hours", "12 minutes" on the team. */
export function tenureText(c: CareerView, now: number) {
  const d = tenureDays(c, now);
  if (d >= 1) return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'}`;
  const h = d * 24;
  if (h >= 1) return `${Math.floor(h)} hour${Math.floor(h) === 1 ? '' : 's'}`;
  const m = Math.max(1, Math.round(h * 60));
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/** " · rehired 2×" after someone's tenure, '' in their first stint (#205). */
const rehiredText = (c: CareerView) => (c.hires > 1 ? ` · rehired ${c.hires - 1}×` : '');

function ago(at: number, now: number) {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 60) return m <= 1 ? 'just now' : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function Portrait({ agent, size }: { agent: Agent; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) drawPortrait(ctx, size * 2, agent);
  }, [agent.id, agent.look, agent.role, agent.color, agent.hair, agent.skin, size]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="career-portrait" width={size * 2} height={size * 2} style={{ width: size, height: size }} aria-label={`${agent.name}'s portrait`} />;
}

function Stat({ label, value, title }: { label: string; value: string | number; title?: string }) {
  return (
    <div className="career-stat" title={title}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function CareerCard({ agent, compact = false }: { agent: Agent; compact?: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === agent.repoId));
  const now = Date.now();
  const c = agent.career;
  if (!c) return <div className="career-card muted small">{agent.name} runs the company; their record is the whole office.</div>;
  return (
    <div className={`career-card ${compact ? 'career-compact' : ''}`} style={{ ['--accent' as string]: agent.color }}>
      <div className="career-head">
        <Portrait agent={agent} size={compact ? 44 : 88} />
        <div className="career-who">
          <div className="career-name">{agent.name}</div>
          <div className="career-title">
            {rank(c)}
            {repo ? ` · floor ${repo.floor}` : ''}
          </div>
          {c.firstPass >= 10 && (
            <div className="career-badges">
              <span className="career-badge career-star">
                <Icon name="star" /> 10 first-time passes
              </span>
            </div>
          )}
          <div className="career-known">“{knownFor(c)}”</div>
        </div>
      </div>
      <div className="career-stats">
        <Stat label="PRs merged" value={c.merged} />
        <Stat label="PRs opened" value={c.opened} />
        <Stat label="first-time QA" value={c.firstPass} title="PRs that passed QA on their first round" />
        <Stat label="QA pass rate" value={pct(passRate(c))} title={`${c.qaPass} of ${c.qaPass + c.qaFail} QA rounds on their PRs passed`} />
        <Stat label="fix rounds / PR" value={fixed1(avgFixRounds(c))} />
        <Stat label="QA reviews" value={c.reviews} />
        <Stat label="longest streak" value={c.best} title="PRs in a row that passed QA first time" />
        <Stat label="on the team" value={tenureText(c, now) + rehiredText(c)} />
        {!compact && <Stat label="est. cost" value={`$${c.costUsd.toFixed(2)}`} title="What the coding agents report, API-equivalent; subscription usage is billed by plan" />}
        {!compact && <Stat label="turns" value={c.turns} />}
      </div>
      {c.recent.length > 0 && (
        <div className="career-recent">
          {!compact && <div className="muted small">Last merged</div>}
          {c.recent.slice(0, compact ? 1 : LAST).map(([n, title, at]) => (
            <div key={n} className="career-pr">
              {compact && <span className="muted">Last merged </span>}
              {repo ? (
                <a href={`https://github.com/${repo.fullName}/pull/${n}`} target="_blank" rel="noreferrer">
                  #{n}
                </a>
              ) : (
                <b>#{n}</b>
              )}{' '}
              <span className="career-pr-title">{title || 'untitled'}</span> <span className="muted">{ago(at, now)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The agent window's Profile tab (#117): who they are, then their numbers beside their floor's, a sparkline and badges. */
export function AgentProfile({ agent }: { agent: Agent }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === agent.repoId));
  const agents = useStore((s) => s.agents);
  const now = Date.now();
  const c = agent.career;
  if (!c)
    return (
      <div className="pf">
        <p className="muted small">{agent.name} runs the company; their record is the whole office.</p>
        <ProfileVoice agent={agent} />
      </div>
    );
  const floor = agentsOnRepo(agents, agent.repoId).flatMap((a) => (a.career && a.role !== 'ceo' ? [a.career] : []));
  const everyone = Object.values(agents).flatMap((a) => (a.career && a.role !== 'ceo' ? [a.career] : []));
  const stats = profileStats(c, floor, repo?.floor ?? 0, now);
  const earned = badges(c);
  return (
    <div className="pf" style={{ ['--accent' as string]: agent.color }}>
      <div className="career-head">
        <Portrait agent={agent} size={64} />
        <div className="career-who">
          <div className="career-name">{agent.name}</div>
          <div className="career-title">
            {rank(c)}
            {repo ? ` · floor ${repo.floor}` : ''} · {tenureText(c, now)} on the team{rehiredText(c)}
          </div>
          <div className="career-known">{knownFor(c)}</div>
        </div>
      </div>
      <div className="cs-grid pf-grid">
        {stats.map((x) => (
          <div key={x.key} className={`cs-stat pf-stat ${x.verdict === 'better' ? 'cs-good' : x.verdict === 'worse' ? 'cs-warn' : ''}`} title={x.title}>
            <span className="cs-stat-title">{x.label}</span>
            <b className="pf-value">{x.text}</b>
            {x.vsFloor && <small>{x.vsFloor}</small>}
          </div>
        ))}
      </div>
      <UsageInsights c={c} everyone={everyone} />
      {earned.length > 0 && (
        <div className="career-badges">
          {earned.map((b) => (
            <span key={b} className="career-badge">
              <IconText text={b} />
            </span>
          ))}
        </div>
      )}
      {c.recent.length > 0 && (
        <div className="career-recent">
          <div className="muted small">Last merged</div>
          {c.recent.slice(0, LAST).map(([n, title, at]) => (
            <div key={n} className="career-pr">
              {repo ? (
                <a href={`https://github.com/${repo.fullName}/pull/${n}`} target="_blank" rel="noreferrer">
                  #{n}
                </a>
              ) : (
                <b>#{n}</b>
              )}{' '}
              <span className="career-pr-title">{title || 'untitled'}</span> <span className="muted">{ago(at, now)}</span>
            </div>
          ))}
        </div>
      )}
      <CareerTimeline agent={agent} />
      <ProfileVoice agent={agent} />
    </div>
  );
}

/** Look at someone's desk for a moment and their card pops up at the left edge, under the hover card. */
export function CareerPeek() {
  const id = useStore((s) => (s.focus?.id.startsWith('agent-') ? s.focus.id.slice(6) : null));
  const agent = useStore((s) => (id ? s.agents[id] : undefined));
  const overlay = useStore((s) => s.overlay);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return setShown(null);
    const t = setTimeout(() => setShown(id), PEEK_MS);
    return () => clearTimeout(t);
  }, [id]);
  if (!agent || shown !== agent.id || overlay || !agent.career) return null;
  return (
    <div className="career-peek" aria-live="polite">
      <CareerCard agent={agent} compact />
    </div>
  );
}

// ---------- the Team tab ----------

/** What the columns read besides the career: the time, everyone's careers (for shares) and the coding agents' names. */
interface Ctx {
  now: number;
  everyone: CareerView[];
  clis: ReturnType<typeof useStore.getState>['clis'];
}

type Col = { key: string; label: string; title?: string; value: (c: CareerView, x: Ctx) => number | string; show?: (c: CareerView, x: Ctx) => string };

const orNone = (x: number | null) => x ?? -1;

const COLS: Col[] = [
  { key: 'merged', label: 'Merged', value: (c) => c.merged },
  { key: 'opened', label: 'Opened', value: (c) => c.opened },
  { key: 'firstRound', label: '1st-round QA', title: 'PRs that passed QA on their first round', value: (c) => orNone(firstRoundRate(c)), show: (c) => pct(firstRoundRate(c)) },
  { key: 'firstPass', label: '1st-time passes', title: 'PRs that passed QA on their first round, counted', value: (c) => c.firstPass },
  { key: 'rate', label: 'Pass rate', title: 'QA rounds on their PRs that passed', value: (c) => orNone(passRate(c)), show: (c) => pct(passRate(c)) },
  { key: 'fixes', label: 'Fixes / PR', title: 'Fix rounds per merged PR', value: (c) => orNone(avgFixRounds(c)), show: (c) => fixed1(avgFixRounds(c)) },
  { key: 'reviews', label: 'Reviews', title: 'QA reviews done', value: (c) => c.reviews },
  { key: 'best', label: 'Streak', title: 'Longest run of PRs passing QA first time', value: (c) => c.best },
  { key: 'week', label: 'This week', title: 'Merges in the last 7 days', value: (c, x) => mergesThisWeek(c, x.now) },
  { key: 'since', label: 'On the team', title: 'Every stint together', value: (c, x) => tenureDays(c, x.now), show: (c, x) => tenureText(c, x.now) + rehiredText(c) },
  { key: 'costWeek', label: 'Cost this week', title: 'Estimated, as the coding agents report it', value: (c, x) => thisWeek(c, x.now).usd, show: (c, x) => usd(thisWeek(c, x.now).usd) },
  { key: 'cost', label: 'Cost', title: 'All time, estimated', value: (c) => c.costUsd, show: (c) => usd(c.costUsd) },
  { key: 'perMerge', label: 'Cost / merge', value: (c) => orNone(costPerMerge(c)), show: (c) => (costPerMerge(c) === null ? '—' : usd(costPerMerge(c)!)) },
  { key: 'waste', label: 'Waste', title: 'Spent on sessions that came to nothing, and its share', value: (c) => c.wasteUsd, show: (c) => `${usd(c.wasteUsd)} (${pct(wasteShare(c))})` },
  { key: 'work', label: 'Working', title: 'Hours in sessions', value: (c, x) => workIdle(c, x.now).work, show: (c, x) => hours(workIdle(c, x.now).work) },
  { key: 'idle', label: 'Idle', title: 'Hours on the team outside sessions', value: (c, x) => workIdle(c, x.now).idle, show: (c, x) => hours(workIdle(c, x.now).idle) },
  { key: 'usage', label: 'Tokens / turns', title: 'Tokens when their coding agent reports them, else turns', value: (c) => c.tokens || c.turns, show: usageText },
  { key: 'toMerge', label: 'To merge', title: 'Median time from starting an issue to its merge', value: (c) => orNone(medianToMerge(c)), show: (c) => (medianToMerge(c) === null ? '—' : durationText(medianToMerge(c)!)) },
  { key: 'rig', label: 'Model', title: 'The coding agent, model and effort they run', value: (c, x) => rigText(c, x.clis, x.now, true), show: (c, x) => rigText(c, x.clis, x.now, true) },
  { key: 'share', label: 'Share', title: "Their share of the office's spend this week", value: (c, x) => orNone(spendShare(c, x.everyone, x.now)), show: (c, x) => pct(spendShare(c, x.everyone, x.now)) },
];

const DEFAULT_COLS = ['merged', 'firstRound', 'week', 'costWeek', 'perMerge', 'waste', 'work', 'since', 'rig'];
const COLS_KEY = 'cubefarm:career-cols';

/** The columns this browser picked (a convenience: the defaults when storage is off). */
function useColumns(): [string[], (key: string) => void] {
  const [cols, setCols] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null') as unknown;
      if (Array.isArray(saved)) return COLS.map((c) => c.key).filter((k) => saved.includes(k));
    } catch {
      // private window or blocked storage
    }
    return DEFAULT_COLS;
  });
  const toggle = (key: string) => {
    const next = cols.includes(key) ? cols.filter((k) => k !== key) : COLS.map((c) => c.key).filter((k) => k === key || cols.includes(k));
    setCols(next);
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(next));
    } catch {
      // kept for this visit only
    }
  };
  return [cols, toggle];
}

/** Everyone's stats: highlights, a sortable table with a column picker (cards on a phone), and the past agents. */
export function TeamStats() {
  const agents = useStore((s) => s.agents);
  const repos = useStore((s) => s.repos);
  const clis = useStore((s) => s.clis);
  const past = useStore((s) => s.pastCareers);
  const openOverlay = useStore((s) => s.openOverlay);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'merged', dir: -1 });
  const [shown, toggle] = useColumns();
  const now = Date.now();
  const floor = (a: Agent) => repos.find((r) => r.id === a.repoId)?.floor ?? 0;
  const people = Object.values(agents).filter((a): a is Agent & { career: CareerView } => a.role !== 'ceo' && !!a.career);
  const x: Ctx = { now, everyone: people.map((a) => a.career), clis };
  const cols = COLS.filter((c) => shown.includes(c.key));
  const col = COLS.find((c) => c.key === sort.key);
  const rows = [...people].sort((a, b) => {
    if (sort.key === 'name') return a.name.localeCompare(b.name) * sort.dir;
    if (sort.key === 'floor' || !col) return (floor(a) - floor(b)) * sort.dir;
    const va = col.value(a.career, x);
    const vb = col.value(b.career, x);
    const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return d * sort.dir || a.name.localeCompare(b.name);
  });
  if (!rows.length && !past.length) return null;
  const profile = (a: Agent) => openOverlay({ kind: 'terminal', agentId: a.id, profile: true });
  const head = (key: string, label: string, title?: string) => (
    <th key={key} title={title} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="sort-btn" onClick={() => setSort({ key, dir: sort.key === key ? (-sort.dir as 1 | -1) : key === 'name' || key === 'floor' ? 1 : -1 })}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? <Icon name="chevron-up" /> : <Icon name="chevron-down" />) : ''}
      </button>
    </th>
  );
  return (
    <div className="card team-stats">
      <div className="row">
        <b className="grow">
          <Icon name="medal" /> Careers
        </b>
        <span className="muted small">Counted from what the office sees: PRs, QA rounds, fixes, merges and sessions. Careers stay through a let-go and come back on a rehire.</span>
      </div>
      <Highlights people={people.map((a) => ({ id: a.id, name: a.name, career: a.career, idleSince: a.status === 'idle' || a.status === 'done' ? (a.endedAt ?? a.career.since) : null }))} />
      <div className="cr-team">
        <details className="cr-cols">
          <summary className="ds-btn btn-small">Columns ({cols.length})</summary>
          <div className="cr-cols-list">
            {COLS.map((c) => (
              <label key={c.key} className="cr-col" title={c.title}>
                <input type="checkbox" checked={shown.includes(c.key)} onChange={() => toggle(c.key)} /> {c.label}
              </label>
            ))}
          </div>
        </details>
        <div className="team-stats-scroll cr-table">
          <table className="team stats-table">
            <thead>
              <tr>
                {head('name', 'Name')}
                {head('floor', 'Floor')}
                {cols.map((c) => head(c.key, c.label, c.title))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">
                    <span className="dot" style={{ background: a.color }} />{' '}
                    <button className="link-btn" title="Open their profile" onClick={() => profile(a)}>
                      {a.name}
                    </button>
                  </td>
                  <td>{repos.find((r) => r.id === a.repoId)?.floor ?? '—'}</td>
                  {cols.map((c) => (
                    <td key={c.key} className="num">
                      {c.show ? c.show(a.career, x) : c.value(a.career, x)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="cr-cards" aria-label="Careers">
          {rows.map((a) => (
            <li key={a.id}>
              <button type="button" className="cr-card" style={{ ['--accent' as string]: a.color }} onClick={() => profile(a)} aria-label={`${a.name}: open their profile`}>
                <span className="cr-card-who">
                  <span className="dot" style={{ background: a.color }} /> <b>{a.name}</b>
                  <span className="muted small">floor {floor(a) || '—'}</span>
                  <span className="cr-chev" aria-hidden>
                    <Icon name="chevron-right" />
                  </span>
                </span>
                <span className="cr-card-stats">
                  <span>
                    <b>{mergesThisWeek(a.career, now)}</b> merged this week
                  </span>
                  <span>
                    <b>{pct(firstRoundRate(a.career))}</b> 1st-round QA
                  </span>
                  <span>
                    <b>{costPerMerge(a.career) === null ? '—' : usd(costPerMerge(a.career)!)}</b> / merge
                  </span>
                </span>
                <Spark label="Merges a week" values={weeklySeries(a.career, now).merges} show={String} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      {past.length > 0 && (
        <details className="cr-past">
          <summary className="cr-past-sum">Past agents ({past.length})</summary>
          <ul className="cr-past-list">
            {past.map((p) => (
              <li key={p.name} className="cr-past-row">
                <b>{p.name}</b>
                <span className="muted small">
                  left {durationText(Math.max(60_000, now - p.left))} ago · {tenureText(p.career, p.left)} on the team{rehiredText(p.career)}
                </span>
                <span className="small">
                  {p.career.merged} merged · {p.career.reviews} reviews · {pct(firstRoundRate(p.career))} 1st-round QA · {usd(p.career.costUsd)}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">Hire someone with the same name and their record comes back.</p>
        </details>
      )}
    </div>
  );
}
