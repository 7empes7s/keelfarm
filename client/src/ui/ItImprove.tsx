// IT's improvements (#543): the weekly review's cards (Approve / Not now; also in IT's chat), problems per week, the
// costliest causes with minutes and $ lost and whether each is new, recurring or fixed, and what was changed with its
// before/after. A cause opens its tickets. Settings → The IT department.
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { CauseRow, CauseStatus, ItImproveCard } from '../../../shared/itImprove';
import { agoText } from './peekFacts';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import './itImprove.css';

const NONE: never[] = [];
const STATUS: Record<CauseStatus, string> = { new: 'New', recurring: 'Recurring', fixed: 'Fixed' };
const money = (usd: number) => `$${usd.toFixed(2)}`;
const day = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });

function what(c: ItImproveCard) {
  if (c.kind === 'issue') return `File an issue on floor ${c.floor}`;
  if (c.kind === 'office_playbook') return 'Add to the office playbook';
  return `Add to floor ${c.floor}'s ${c.kind === 'qa_brief' ? 'QA brief' : 'playbook'}`;
}

function Status({ s }: { s: CauseStatus }) {
  return <span className={`it-imp-status it-imp-${s}`}>{STATUS[s]}</span>;
}

export function ImproveCard({ c }: { c: ItImproveCard }) {
  const [busy, setBusy] = useState(false);
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn()
      .catch(() => undefined) // api() already toasted the error
      .finally(() => setBusy(false));
  };
  return (
    <article className="it-rec it-imp-card" aria-label={`Improvement: ${c.title}`}>
      <h4 className="it-rec-title">
        <Icon name="trending-up" /> {c.title}
      </h4>
      <p className="small it-imp-cause">
        <Status s={c.status} /> {c.cause}
      </p>
      <p className="small">
        <b>{what(c)}</b>
        {c.line ? `: ${c.line}` : ''}
      </p>
      {c.body && (
        <details className="small it-imp-body">
          <summary>The issue</summary>
          <p>{c.body}</p>
        </details>
      )}
      <p className="small muted">{c.why}</p>
      {c.full && (
        <p className="small it-imp-full" role="status">
          <Icon name="info" /> {c.full}
        </p>
      )}
      <div className="row it-rec-foot">
        <span className="muted small grow">
          {c.by} · {agoText(c.at, Date.now())}
        </span>
        <span className="it-imp-acts">
          <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => act(() => api.itImproveDismiss(c.id))}>
            Not now
          </button>
          {c.full ? (
            <button type="button" className="btn btn-small btn-good" disabled={busy} onClick={() => act(() => api.itImproveFit(c.id))}>
              <Icon name="brain" /> Ask the CEO to fit it
            </button>
          ) : (
            <button type="button" className="btn btn-small btn-good" disabled={busy} onClick={() => act(() => api.itImproveApprove(c.id))}>
              <Icon name="check" /> Approve
            </button>
          )}
        </span>
      </div>
    </article>
  );
}

/** The review's open cards; nothing while there are none (IT's chat shows them too). */
export function ItImproveCards() {
  const cards = useStore((x) => x.itImprove?.cards ?? NONE);
  if (!cards.length) return null;
  return (
    <div className="it-recs">
      {cards.map((c) => (
        <ImproveCard key={c.id} c={c} />
      ))}
    </div>
  );
}

function ChangeLink({ change }: { change: NonNullable<CauseRow['change']> }) {
  const label = change.issue ? `#${change.issue}${change.floor ? ` on floor ${change.floor}` : ''}` : change.title;
  return change.url ? (
    <a href={change.url} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
}

function CauseSheet({ r, onClose }: { r: CauseRow; onClose: () => void }) {
  const tickets = useStore((x) => x.itTickets);
  return (
    <Sheet title={r.cause} onClose={onClose} className="it-imp-sheet">
      <p className="small">
        <Status s={r.status} /> {r.where} · {r.tickets} ticket{r.tickets === 1 ? '' : 's'} · {r.minutes} agent-min blocked · {money(r.usd)} wasted · {r.qaRounds} failed QA round{r.qaRounds === 1 ? '' : 's'}
      </p>
      <h3 className="it-ticket-h">Latest fix</h3>
      <p className="small">{r.fix || 'None yet.'}</p>
      {r.change && (
        <>
          <h3 className="it-ticket-h">Changed</h3>
          <p className="small">
            {r.change.title} · <ChangeLink change={r.change} /> · {day(r.change.at)}
          </p>
        </>
      )}
      <h3 className="it-ticket-h">Tickets</h3>
      <ul className="small it-imp-ids">
        {r.ids.map((id) => (
          <li key={id}>
            #{id} {tickets.find((t) => t.id === id)?.what ?? ''}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Settings → The IT department → Improvements. */
export function ItImprove() {
  const v = useStore((x) => x.itImprove);
  const on = useStore((x) => x.settings.itDept.on);
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const weeks = v?.weeks ?? NONE;
  const top = Math.max(1, ...weeks.map((w) => w.problems));
  const picked = v?.causes.find((c) => c.key === openKey);
  const review = () => {
    setBusy(true);
    void api
      .itReviewNow()
      .catch(() => undefined) // api() already toasted the error
      .finally(() => setBusy(false));
  };
  const last = weeks.at(-1);
  return (
    <section className="card it-improve" aria-labelledby="it-improve-h">
      <div className="row it-health-head">
        <h3 id="it-improve-h" className="grow">
          <Icon name="trending-up" /> Improvements
        </h3>
        <button type="button" className="btn btn-small" disabled={busy || !on} onClick={review}>
          <Icon name="refresh-cw" /> Review now
        </button>
      </div>
      <p className="muted small">
        Every Monday IT groups the week's tickets by cause, ranks them by time and money lost, and proposes a fix for each. Nothing changes until you approve.
        {v?.reviewedAt ? ` Last review ${agoText(v.reviewedAt, Date.now())}.` : ''}
      </p>
      <ItImproveCards />
      {!v || !weeks.some((w) => w.problems) ? (
        <p className="muted small">No closed tickets yet: the trends start with IT's first fixes.</p>
      ) : (
        <>
          <h4 className="it-imp-h">Problems per week</h4>
          <ol className="it-imp-weeks" aria-label="Problems per week">
            {weeks.map((w) => {
              const label = `Week of ${day(w.start)}: ${w.problems} problem${w.problems === 1 ? '' : 's'}, ${w.minutes} min and ${money(w.usd)} lost, ${w.recurring} recurring, ${w.resolved} resolved`;
              return (
                <li key={w.start} className="it-imp-week" title={label} aria-label={label}>
                  <span className="it-imp-count small">{w.problems || ''}</span>
                  <span className="it-imp-bar" style={{ height: `${(w.problems / top) * 100}%` }} />
                  <span className="it-imp-day small muted">{day(w.start)}</span>
                </li>
              );
            })}
          </ol>
          {last && (
            <p className="small muted">
              This week: {last.problems} problems, {last.minutes} min and {money(last.usd)} lost · {last.recurring} recurring, {last.resolved} resolved
            </p>
          )}
          <h4 className="it-imp-h">Costliest causes</h4>
          <ul className="it-tickets-list" aria-label="Costliest causes">
            {v.causes.map((r) => (
              <li key={r.key}>
                <button type="button" className="ds-row it-ticket-row" onClick={() => setOpenKey(r.key)} aria-label={`${r.cause}: ${STATUS[r.status]}, ${r.tickets} tickets`}>
                  <span className="ds-row-main">
                    <span className="ds-row-title">{r.cause}</span>
                    <span className="ds-row-meta">
                      {r.tickets} ticket{r.tickets === 1 ? '' : 's'} · {r.minutes} min · {money(r.usd)}
                      {r.change?.issue ? ` · fix #${r.change.issue}` : ''}
                    </span>
                  </span>
                  <Status s={r.status} />
                  <Icon name="chevron-right" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {v && v.changes.length > 0 && (
        <>
          <h4 className="it-imp-h">What changed</h4>
          <ul className="it-imp-changes" aria-label="What changed">
            {v.changes.map((c) => (
              <li key={c.id} className="small">
                <b>{c.title}</b> <span className="muted">({c.cause})</span>
                <br />
                {c.issue ? <ChangeLink change={c} /> : c.line} · {day(c.at)} · {c.before} a week before, {c.after} after
              </li>
            ))}
          </ul>
        </>
      )}
      {picked && <CauseSheet r={picked} onClose={() => setOpenKey(null)} />}
    </section>
  );
}
