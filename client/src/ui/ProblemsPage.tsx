// Settings → Company → Problems (#544): the problems register for the manager. What needs them on top, then open problems
// grouped by cause and floor, worst first (time and dollars lost), recurring ones flagged, each linking to its PR, issue
// and agent; filters by owner and state (this week's resolved ones), trends per cause, and the daily digest's hour.
// Built from the store in plain code (shared/problems.ts); IT's tickets join as infrastructure.
import { useState } from 'react';
import { api } from '../api';
import { useMode } from '../pocket/mode';
import { useStore } from '../store';
import { CAUSE_LABELS, causeTrends, digestHour, fmtLost, groupProblems, isOpen, lostNow, OWNER_LABELS, PROBLEM_OWNERS, recurring, register, STATE_LABELS, worstFirst, type Problem, type ProblemOwner } from '../../../shared/problems';
import { fmtUsd } from '../ops';
import { go } from './goTo';
import { Icon } from './Icon';
import { agoText } from './peekFacts';
import { linkTarget, problemLinks } from './problemLinks';
import './problems.css';

type StateFilter = 'open' | 'week' | 'all';
const STATES: { id: StateFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'week', label: 'Resolved this week' },
  { id: 'all', label: 'All' },
];
const WEEK = 7 * 24 * 60 * 60_000;
const lostText = (ms: number, usd: number) => [ms >= 60_000 ? fmtLost(ms) : '', usd >= 0.01 ? fmtUsd(usd) : ''].filter(Boolean).join(' · ') || 'nothing lost yet';

function Links({ p }: { p: Problem }) {
  const world = { repos: useStore((s) => s.repos), agents: useStore((s) => s.agents), qa: useStore((s) => s.qa) };
  const mode = useMode((s) => s.mode) === 'pocket' ? 'pocket' : 'office';
  const links = problemLinks(p).flatMap((l) => {
    const t = linkTarget(l.ref, world, mode);
    return t ? [{ ...l, t }] : [];
  });
  if (!links.length) return null;
  return (
    <span className="pb-links">
      {links.map((l) => (
        <button key={l.label} type="button" className="btn btn-small btn-ghost" onClick={() => go(l.t)}>
          <Icon name={l.icon} /> {l.label}
        </button>
      ))}
    </span>
  );
}

function Row({ p, all, now }: { p: Problem; all: Problem[]; now: number }) {
  return (
    <li className="pb-row" data-problem={p.id}>
      <div className="pb-row-head">
        <span className="pb-row-title">{p.title}</span>
        {recurring(p, all, now) && (
          <span className="pb-tag pb-tag-warn">
            <Icon name="repeat" /> Recurring
          </span>
        )}
      </div>
      <div className="pb-row-meta small muted">
        {OWNER_LABELS[p.owner]} · {STATE_LABELS[p.state]} · {p.count > 1 ? `${p.count}× · ` : ''}
        {lostText(lostNow(p, now), p.lostUsd)} · {agoText(p.lastAt, now)}
      </div>
      {p.detail && <p className="pb-row-detail small">{p.detail}</p>}
      {p.resolution && (
        <p className="pb-row-detail small">
          <Icon name="circle-check" /> {p.resolution}
        </p>
      )}
      <Links p={p} />
    </li>
  );
}

function DigestHour() {
  const notify = useStore((s) => s.settings.notify);
  const hour = digestHour(notify.problemsDigestHour);
  return (
    <label className="field pb-digest">
      <span>Daily digest in the CEO chat (and Telegram) at</span>
      <select value={hour} onChange={(e) => void api.updateSettings({ notify: { ...notify, problemsDigestHour: Number(e.target.value) } }).catch(() => undefined)}>
        <option value={-1}>Off</option>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>
            {String(h).padStart(2, '0')}:00
          </option>
        ))}
      </select>
    </label>
  );
}

/** Mission control's way in: open problems, what needs the manager, and Open Problems. */
export function ProblemsTile() {
  const own = useStore((s) => s.problems);
  const tickets = useStore((s) => s.itTickets);
  const open = register(own, tickets).filter(isOpen);
  const yours = open.filter((p) => p.needsYou).length;
  return (
    <div className={`card pb-group${yours ? ' pb-yours' : ''}`}>
      <div className="pb-group-head">
        <h3>
          <Icon name="clipboard-list" /> Problems
        </h3>
        <span className="small muted pb-group-lost">
          {open.length} open{yours ? ` · ${yours} need${yours === 1 ? 's' : ''} you` : ''}
        </span>
      </div>
      <div>
        <button type="button" className="btn btn-small" onClick={() => go({ kind: 'section', section: 'problems' })}>
          Open Problems <Icon name="chevron-right" />
        </button>
      </div>
    </div>
  );
}

export function ProblemsPage() {
  const own = useStore((s) => s.problems);
  const tickets = useStore((s) => s.itTickets);
  const [owner, setOwner] = useState<ProblemOwner | 'all'>('all');
  const [state, setState] = useState<StateFilter>('open');
  const now = Date.now();
  const all = register(own, tickets);
  const open = all.filter(isOpen);
  const yours = worstFirst(open.filter((p) => p.needsYou), now);
  const resolvedWeek = all.filter((p) => !isOpen(p) && now - (p.resolvedAt ?? 0) < WEEK);
  const weekLost = all.filter((p) => now - p.lastAt < WEEK).reduce((s, p) => ({ ms: s.ms + lostNow(p, now), usd: s.usd + p.lostUsd }), { ms: 0, usd: 0 });
  const byState = state === 'open' ? open : state === 'week' ? resolvedWeek : all;
  const shown = byState.filter((p) => owner === 'all' || p.owner === owner);
  const groups = groupProblems(shown, now);
  const trends = causeTrends(all, now).slice(0, 8);
  return (
    <div className="cn-one pb-page">
      <div className="pb-stats" role="group" aria-label="Problems at a glance">
        <div className="pb-stat">
          <span className="pb-stat-title">Open</span>
          <span className="pb-stat-value">{open.length}</span>
        </div>
        <div className={`pb-stat${yours.length ? ' pb-stat-warn' : ''}`}>
          <span className="pb-stat-title">Need you</span>
          <span className="pb-stat-value">{yours.length}</span>
        </div>
        <div className="pb-stat">
          <span className="pb-stat-title">Resolved this week</span>
          <span className="pb-stat-value">{resolvedWeek.length}</span>
        </div>
        <div className="pb-stat">
          <span className="pb-stat-title">Lost this week</span>
          <span className="pb-stat-value pb-stat-small">{lostText(weekLost.ms, weekLost.usd)}</span>
        </div>
      </div>

      {yours.length > 0 && (
        <section className="card pb-group pb-yours" aria-labelledby="pb-yours-h">
          <h3 id="pb-yours-h" className="pb-group-head">
            <Icon name="hand" /> Needs your decision
          </h3>
          <ul className="pb-list">
            {yours.map((p) => (
              <Row key={p.id} p={p} all={all} now={now} />
            ))}
          </ul>
        </section>
      )}

      <div className="pb-filters">
        <div className="pb-filter" role="group" aria-label="Show problems">
          {STATES.map((f) => (
            <button key={f.id} type="button" className={`btn btn-small ${state === f.id ? '' : 'btn-ghost'}`} aria-pressed={state === f.id} onClick={() => setState(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="pb-filter" role="group" aria-label="Owner">
          {(['all', ...PROBLEM_OWNERS] as const).map((o) => (
            <button key={o} type="button" className={`btn btn-small ${owner === o ? '' : 'btn-ghost'}`} aria-pressed={owner === o} onClick={() => setOwner(o)}>
              {o === 'all' ? 'Everyone' : OWNER_LABELS[o]}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="muted small">{all.length ? 'None here.' : 'No problems yet. The office records failed QA rounds, conflicts, PRs that need a human, agents stuck on errors, blocked issues, wasted sessions and IT tickets here by itself.'}</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="card pb-group" data-group={g.key} aria-label={`${CAUSE_LABELS[g.cause]}${g.floor === null ? '' : `, floor ${g.floor}`}`}>
            <div className="pb-group-head">
              <h3>{CAUSE_LABELS[g.cause]}</h3>
              {g.floor !== null && <span className="pb-tag">Floor {g.floor}</span>}
              <span className="pb-tag">{g.items[0].kind}</span>
              <span className="small muted pb-group-lost">
                {g.count}× · {lostText(g.lostMs, g.lostUsd)}
              </span>
            </div>
            <ul className="pb-list">
              {g.items.map((p) => (
                <Row key={p.id} p={p} all={all} now={now} />
              ))}
            </ul>
          </section>
        ))
      )}

      {trends.length > 0 && (
        <section className="card pb-group" aria-labelledby="pb-trends-h">
          <h3 id="pb-trends-h" className="pb-group-head">
            <Icon name="trending-up" /> Trends per cause
          </h3>
          <ul className="pb-list">
            {trends.map((t) => (
              <li key={t.cause} className="pb-trend">
                <span>{CAUSE_LABELS[t.cause]}</span>
                <span className="small">
                  {t.week} this week · {t.before} the week before{' '}
                  <Icon name={t.week > t.before ? 'arrow-up-right' : t.week < t.before ? 'arrow-down-right' : 'arrow-right'} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <DigestHour />
    </div>
  );
}
