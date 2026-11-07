// Careers with insight (#205): an agent's usage and cost beside their floor and the office, their 8-week sparklines,
// their timeline (fetched once when the profile opens, never polled), and the Team tab's highlights row and phone cards.
import { useEffect, useState } from 'react';
import { durationText, highlights, spendShare, thisWeek, wasteShare, weeklySeries, workIdle, type CareerView, type Highlight } from '../../../shared/careers';
import { groupByDay, type TimelineItem, type TimelineView } from '../../../shared/careerTimeline';
import { ROUND_CAUSE_LABELS } from '../../../shared/rounds';
import { api } from '../api';
import { useStore, type Agent } from '../store';
import { ProgressBar } from './ProgressBar';
import { cliName } from './AgentSettings';
import './careers.css';

export const usd = (x: number) => `$${x < 10 ? x.toFixed(2) : x.toFixed(0)}`;
export const hours = (ms: number) => `${Math.round(ms / 360_000) / 10}h`;
const pctText = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

/** "Claude Code · opus · high, since 3d ago": what they run. */
export function rigText(c: CareerView, clis: Parameters<typeof cliName>[0], now: number, short = false): string {
  if (!c.rig) return '—';
  const model = c.rig.model.replace(/^claude-/, '') || 'default model';
  const what = short ? model : [cliName(clis, c.rig.cli as Parameters<typeof cliName>[1]), model, c.rig.effort || 'default effort'].join(' · ');
  return short ? what : `${what}, for ${durationText(Math.max(60_000, now - c.rig.since))}`;
}

/** Tokens when their coding agent reports them, else turns. */
export const usageText = (c: CareerView) => (c.tokens > 0 ? `${c.tokens >= 1e6 ? `${(c.tokens / 1e6).toFixed(1)}M` : `${Math.round(c.tokens / 1e3)}k`} tokens` : `${c.turns} turns`);

/** Eight weeks as bars, oldest first; a week without data is a gap. */
export function Spark({ values, label, show }: { values: (number | null)[]; label: string; show: (x: number) => string }) {
  const top = Math.max(1e-9, ...values.map((v) => v ?? 0));
  const last = [...values].reverse().find((v) => v !== null);
  return (
    <figure className="cr-spark">
      <figcaption>
        <span>{label}</span>
        <b>{last === undefined || last === null ? '—' : show(last)}</b>
      </figcaption>
      <svg viewBox={`0 0 ${values.length * 10} 24`} role="img" aria-label={`${label}, the last ${values.length} weeks, oldest first: ${values.map((v) => (v === null ? 'none' : show(v))).join(', ')}`}>
        {values.map((v, i) => (v === null ? <rect key={i} className="cr-spark-gap" x={i * 10 + 2} y={22} width={6} height={1.5} rx={0.75} /> : <rect key={i} x={i * 10 + 2} y={23 - Math.max(1.5, (v / top) * 22)} width={6} height={Math.max(1.5, (v / top) * 22)} rx={1.5} />))}
      </svg>
    </figure>
  );
}

/** The profile's usage and cost (cost per merge and waste share against the floor are in its stat grid): this week and
 *  all time, waste, tokens, what they run, time working, their share of the office's spend and 8-week sparklines. */
export function UsageInsights({ c, everyone }: { c: CareerView; everyone: CareerView[] }) {
  const clis = useStore((s) => s.clis);
  const now = Date.now();
  const week = thisWeek(c, now);
  const { work, idle } = workIdle(c, now);
  const share = spendShare(c, everyone, now);
  const waste = wasteShare(c);
  const series = weeklySeries(c, now);
  return (
    <section className="cr-usage" aria-label="Usage and cost">
      <h4 className="cr-h">Usage and cost</h4>
      <div className="cs-grid">
        <div className="cs-stat pf-stat" title="Estimated, as the coding agents report it; subscription usage is billed by plan">
          <span className="cs-stat-title">Cost</span>
          <b className="pf-value">{usd(week.usd)}</b>
          <small>this week · {usd(c.costUsd)} all time</small>
        </div>
        <div className={`cs-stat pf-stat ${waste !== null && waste > 0.2 ? 'cs-warn' : ''}`} title="Sessions that came to nothing: no PR, no commit, stopped by the watchdog or the usage limit">
          <span className="cs-stat-title">Waste</span>
          <b className="pf-value">{usd(c.wasteUsd)}</b>
          <small>
            {pctText(waste)} of spend · {c.wasted} of {c.sessions} sessions
          </small>
        </div>
        <div className="cs-stat pf-stat">
          <span className="cs-stat-title">Usage</span>
          <b className="pf-value">{usageText(c)}</b>
          <small>{c.tokens > 0 ? `${c.turns} turns` : 'their coding agent reports no tokens'}</small>
        </div>
        <div className="cs-stat pf-stat">
          <span className="cs-stat-title">Runs</span>
          <b className="pf-value cr-rig">{rigText(c, clis, now, true)}</b>
          <small>{rigText(c, clis, now)}</small>
        </div>
      </div>
      <ProgressBar
        label="Working vs idle"
        value={`${hours(work)} working · ${hours(idle)} idle`}
        parts={[
          { key: 'work', label: 'working', value: Math.round(work / 60_000) },
          { key: 'idle', label: 'idle', value: Math.round(idle / 60_000) },
        ]}
        aria={`${hours(work)} working and ${hours(idle)} idle over ${hours(work + idle)} on the team`}
      />
      <ProgressBar label="Share of the office's spend this week" value={pctText(share)} pct={share ?? 0} aria={`${pctText(share)} of what every agent spent this week`} />
      <div className="cr-sparks">
        <Spark label="Merges a week" values={series.merges} show={String} />
        <Spark label="Cost / merge" values={series.costPerMerge} show={usd} />
        <Spark label="First-round QA" values={series.firstPass} show={(x) => pctText(x)} />
      </div>
    </section>
  );
}

// ---------- the timeline ----------

const dayTitle = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const STOP_TEXT: Record<string, string> = { error: 'hit an error', watchdog: 'stopped by the watchdog', stopped: 'stopped', interrupted: 'interrupted', limited: "cut off by Claude's usage limit" };

function itemLine(it: Exclude<TimelineItem, { type: 'rehired' }>): { icon: string; title: string; meta: string } {
  const cost = `${durationText(Math.max(60_000, it.ms))} · ${usd(it.usd)}`;
  if (it.type === 'build') {
    const passed = it.rounds.filter((r) => r.pass).length;
    const failed = it.rounds.length - passed;
    const causes = [...new Set(it.rounds.flatMap((r) => (r.cause ? [ROUND_CAUSE_LABELS[r.cause]] : [])))];
    const rounds = it.rounds.length ? `QA ${it.rounds.map((r) => (r.pass ? '✓' : '✗')).join('')}${failed && causes.length ? ` (${causes.join(', ')})` : ''}` : '';
    const state = it.state === 'merged' ? 'merged' : it.state === 'no-pr' ? 'no PR' : `PR #${it.pr} open`;
    return { icon: it.state === 'merged' ? '🟣' : it.state === 'no-pr' ? '⚪' : '🟢', title: `${it.issue !== null ? `#${it.issue} ` : ''}${it.title || 'An issue'}`, meta: [it.pr !== null && it.state === 'merged' ? `PR #${it.pr} merged` : state, rounds, it.fixes ? `${it.fixes} fix${it.fixes > 1 ? 'es' : ''}` : '', cost].filter(Boolean).join(' · ') };
  }
  if (it.type === 'review') return { icon: it.pass ? '✅' : '❌', title: `QA on PR #${it.pr}: ${it.pass ? 'passed' : 'failed'}`, meta: [it.cause && ROUND_CAUSE_LABELS[it.cause], it.title, cost].filter(Boolean).join(' · ') };
  if (it.type === 'fix') return { icon: it.why === 'conflict' ? '🔀' : '🔧', title: `${it.why === 'conflict' ? 'Conflict fix' : it.why === 'checks' ? 'Fixed a red check' : "Fixed QA's findings"} on PR #${it.pr}`, meta: [it.title, cost].filter(Boolean).join(' · ') };
  return { icon: '⛔', title: `${it.title || 'A session'} ${STOP_TEXT[it.outcome] ?? it.outcome}`, meta: [it.note, cost].filter(Boolean).join(' · ') };
}

/** What they did over the last month, by day, as cards; each row opens the PR, QA report or session behind it. */
export function CareerTimeline({ agent }: { agent: Agent }) {
  const repos = useStore((s) => s.repos);
  const openOverlay = useStore((s) => s.openOverlay);
  const [view, setView] = useState<TimelineView | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    setView(null);
    api.careerTimeline(agent.id).then(
      (v) => live && setView(v),
      () => live && setView('failed'),
    );
    return () => {
      live = false;
    };
  }, [agent.id]);
  if (view === null) return <p className="muted small">Loading what they did…</p>;
  if (view === 'failed') return <p className="muted small">Their timeline couldn't load.</p>;
  const days = groupByDay(view.items);
  const open = (it: TimelineItem) => {
    if (it.type === 'rehired') return;
    const repo = repos.find((r) => r.id === it.repoId);
    if (it.type === 'review' && it.pr !== null) return openOverlay({ kind: 'app', repoId: it.repoId, pr: it.pr, qa: true });
    if (it.type === 'build' && it.pr !== null && repo) return void window.open(`https://github.com/${repo.fullName}/pull/${it.pr}`, '_blank', 'noopener');
    openOverlay({ kind: 'manager', tab: 'history', history: { agent: agent.name, ...(it.pr !== null ? { repoId: it.repoId, pr: it.pr } : {}) } });
  };
  return (
    <section className="cr-timeline" aria-label="What they did">
      <h4 className="cr-h">What they did</h4>
      {!days.length && <p className="muted small">Nothing in the session history for the last 30 days yet.</p>}
      {days.map((d) => (
        <div key={d.day} className="cr-day">
          <div className="cr-day-head">
            <b>{dayTitle(d.day)}</b>
            <span className="muted small">{usd(d.usd)}</span>
          </div>
          <ul className="cr-day-items">
            {d.items.map((it, i) => {
              if (it.type === 'rehired')
                return (
                  <li key={`r${it.at}`} className="cr-item cr-item-note">
                    <span aria-hidden>👋</span> Rehired at {clock(it.at)}, their record kept
                  </li>
                );
              const line = itemLine(it);
              const tap = it.type === 'build' && it.pr !== null ? 'Open the pull request' : it.type === 'review' ? 'Open the QA report' : 'Open the session in History';
              return (
                <li key={`${it.type}${it.at}${i}`}>
                  <button type="button" className="cr-item" onClick={() => open(it)} aria-label={`${line.title}. ${line.meta}. ${tap}`}>
                    <span className="cr-item-icon" aria-hidden>
                      {line.icon}
                    </span>
                    <span className="cr-item-main">
                      <span className="cr-item-title">{line.title}</span>
                      <span className="cr-item-meta">
                        {clock(it.at)} · {line.meta}
                      </span>
                    </span>
                    <span className="cr-chev" aria-hidden>
                      {it.type === 'build' && it.pr !== null ? '↗' : '›'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {view.cut && <p className="muted small">Older work is in the console's History.</p>}
    </section>
  );
}

// ---------- the Team tab ----------

const HL_ICON: Record<Highlight['key'], string> = { mvp: '🏆', cheapest: '💸', firstPass: '🎯', reviews: '🔍', waste: '🗑️', idle: '💤' };

/** The highlights row above the Team table: each card opens that agent's profile (the waste card their History). */
export function Highlights({ people }: { people: { id: string; name: string; career: CareerView | null; idleSince: number | null }[] }) {
  const openOverlay = useStore((s) => s.openOverlay);
  const cards = highlights(people, Date.now());
  if (!cards.length) return null;
  return (
    <div className="cr-highlights" role="list" aria-label="Highlights">
      {cards.map((h) => (
        <div role="listitem" key={h.key}>
          <button
            type="button"
            className="cr-hl"
            onClick={() => (h.key === 'waste' ? openOverlay({ kind: 'manager', tab: 'history', history: { agent: h.name } }) : openOverlay({ kind: 'terminal', agentId: h.agentId, profile: true }))}
            title={h.key === 'waste' ? 'See the sessions in History' : `Open ${h.name}'s profile`}
          >
            <span className="cr-hl-label">
              <span aria-hidden>{HL_ICON[h.key]}</span> {h.label}
            </span>
            <b className="cr-hl-name">{h.name}</b>
            <small>{h.text}</small>
          </button>
        </div>
      ))}
    </div>
  );
}
