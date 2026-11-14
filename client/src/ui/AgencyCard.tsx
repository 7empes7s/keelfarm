// The agency pipeline (#667): the Company page's card under Earnings, shown once an agency floor has an opportunity.
// The ranked opportunities with their expected profit and score (Approve / Not now on the shortlisted ones, the last
// 30 days' earnings on live ones) and every external action waiting for the manager, with its exact draft.
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { AgencyAction, OpportunityView } from '../../../shared/agency';
import { Icon } from './Icon';
import './agency.css';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const STATUS: Record<OpportunityView['status'], string> = { new: 'New', shortlisted: 'Waiting for you', approved: 'Planning', declined: 'Not now', live: 'Live' };
const KIND: Record<AgencyAction['kind'], string> = { post: 'Post', send: 'Message', signup: 'Sign-up', proposal: 'Gig proposal', listing: 'Listing' };

function Decide({ label, onDecide }: { label: string; onDecide: (approve: boolean) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const go = (approve: boolean) => {
    setBusy(true);
    onDecide(approve).catch(() => undefined).finally(() => setBusy(false)); // api() already toasted an error
  };
  return (
    <span className="ag-decide">
      <button className="ds-btn btn-good" disabled={busy} onClick={() => go(true)} aria-label={`Approve ${label}`}>
        Approve
      </button>
      <button className="ds-btn" disabled={busy} onClick={() => go(false)} aria-label={`Not now: ${label}`}>
        Not now
      </button>
    </span>
  );
}

function Opportunity({ o }: { o: OpportunityView }) {
  return (
    <li className="ag-item">
      <span className="ag-row">
        <b className="grow ag-title">{o.title}</b>
        <span className={`ag-pill ag-${o.status}`}>{STATUS[o.status]}</span>
      </span>
      <span className="ag-facts small muted">
        <span>{usd(o.profitMonth)}/mo profit</span>
        <span>{o.effortDays} d effort</span>
        <span>first $ in {o.daysToFirstDollar} d</span>
        <span>score {o.score}</span>
        {o.earned30 !== null && <span className="ag-earned">{usd(o.earned30)} earned in 30 d</span>}
        {o.planIssue !== undefined && <span>plan #{o.planIssue}</span>}
      </span>
      {o.status === 'shortlisted' && <Decide label={o.title} onDecide={(approve) => api.decideOpportunity(o.slug, approve)} />}
    </li>
  );
}

function Action({ a }: { a: AgencyAction }) {
  return (
    <li className="ag-item">
      <span className="ag-row">
        <b className="grow ag-title">
          {KIND[a.kind]}: {a.summary}
        </b>
        {a.status !== 'pending' && <span className={`ag-pill ag-${a.status}`}>{a.status === 'approved' ? 'Approved' : a.status === 'done' ? 'Done' : 'Not now'}</span>}
      </span>
      <span className="small muted ag-target">To {a.target}</span>
      {a.status === 'pending' && (
        <>
          <blockquote className="ag-draft small">{a.draft}</blockquote>
          <Decide label={a.summary} onDecide={(approve) => api.decideAgencyAction(a.id, approve)} />
        </>
      )}
    </li>
  );
}

export function AgencyCard() {
  const v = useStore((s) => s.agency);
  if (!v || (!v.opportunities.length && !v.actions.length)) return null;
  const waiting = v.actions.filter((a) => a.status === 'pending');
  return (
    <section className="pk-card ag-card" aria-label="Agency pipeline">
      <span className="ag-row">
        <b className="small grow">
          <Icon name="briefcase-business" /> Agency pipeline
        </b>
        {waiting.length > 0 && <span className="ag-pill ag-shortlisted">{waiting.length} to approve</span>}
      </span>
      {waiting.length > 0 && (
        <>
          <h3 className="phone-h">Needs your OK before it goes out</h3>
          <ul className="ag-list">
            {waiting.map((a) => (
              <Action key={a.id} a={a} />
            ))}
          </ul>
        </>
      )}
      <h3 className="phone-h">Opportunities</h3>
      <ul className="ag-list">
        {v.opportunities.slice(0, 6).map((o) => (
          <Opportunity key={o.slug} o={o} />
        ))}
      </ul>
    </section>
  );
}
