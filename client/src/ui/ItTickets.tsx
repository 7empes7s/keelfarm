// IT tickets (#542): office problems agents and the office reported to IT, open or closed, with how often, who reported
// them and how long IT took; a ticket opens its evidence and what was done. Settings → The IT department.
import { useState } from 'react';
import { useStore } from '../store';
import type { ItTicket } from '../../../shared/itTickets';
import { fmtDuration } from '../ops';
import { agoText } from './peekFacts';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import './itTickets.css';

type Filter = 'open' | 'closed' | 'all';
const NONE: ItTicket[] = [];
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

const who = (t: ItTicket) => t.by.map((b) => b.name).join(', ');
const fixedIn = (t: ItTicket) => (t.closedAt ? fmtDuration(t.closedAt - t.at) : null);

function TicketSheet({ t, onClose }: { t: ItTicket; onClose: () => void }) {
  const now = Date.now();
  return (
    <Sheet title={`Ticket #${t.id}`} onClose={onClose} className="it-ticket-sheet">
      <p className="it-ticket-what">
        <b>{t.what}</b>
      </p>
      <p className="small muted">
        {t.where} · {t.blocking ? 'blocking' : 'not blocking'} · reported {t.count}× by {who(t)} · first {agoText(t.at, now)}
        {t.count > 1 && `, last ${agoText(t.lastAt, now)}`}
      </p>
      <h3 className="it-ticket-h">Evidence</h3>
      {t.evidence.map((e, i) => (
        <pre key={i} className="it-ticket-evidence">
          {e}
        </pre>
      ))}
      <h3 className="it-ticket-h">What was done</h3>
      {t.status === 'closed' ? (
        <p className="it-ticket-done">
          <Icon name="circle-check" /> {t.resolution} <span className="muted small">(fixed in {fixedIn(t)})</span>
        </p>
      ) : (
        <p className="muted small">{t.wokeAt ? 'IT is looking at it.' : 'Nothing yet: IT looks when it blocks someone or keeps coming back.'}</p>
      )}
    </Sheet>
  );
}

export function ItTickets() {
  const tickets = useStore((s) => s.itTickets ?? NONE);
  const [filter, setFilter] = useState<Filter>('open');
  const [openId, setOpenId] = useState<number | null>(null);
  const open = tickets.filter((t) => t.status === 'open');
  const shown = filter === 'all' ? tickets : tickets.filter((t) => t.status === filter);
  const picked = tickets.find((t) => t.id === openId);
  return (
    <section className="card it-tickets" aria-labelledby="it-tickets-h">
      <div className="it-tickets-head">
        <h3 id="it-tickets-h">
          <Icon name="clipboard-list" /> Tickets
        </h3>
        <span className="muted small">
          {open.length} open{open.some((t) => t.blocking) ? ` · ${open.filter((t) => t.blocking).length} blocking` : ''}
        </span>
      </div>
      <div className="it-tickets-filter" role="group" aria-label="Show tickets">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`btn btn-small ${filter === f.id ? '' : 'btn-ghost'}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="muted small">{tickets.length ? 'None here.' : 'No tickets yet. Agents report office problems (the test lab, previews, ports, disk, sign-in, CI) with it_report, and the office files the ones it sees itself.'}</p>
      ) : (
        <ul className="it-tickets-list">
          {shown.map((t) => (
            <li key={t.id}>
              <button type="button" className="ds-row it-ticket-row" onClick={() => setOpenId(t.id)} aria-label={`Ticket #${t.id}: ${t.what}, ${t.status}`}>
                <span className={`it-ticket-badge ${t.status === 'open' ? (t.blocking ? 'it-ticket-blocking' : 'it-ticket-open') : 'it-ticket-closed'}`}>#{t.id}</span>
                <span className="ds-row-main">
                  <span className="ds-row-title">{t.what}</span>
                  <span className="ds-row-meta">
                    {t.where} · {t.count}× · {who(t)} · {t.status === 'open' ? `${t.blocking ? 'blocking, ' : ''}${agoText(t.lastAt, Date.now())}` : `fixed in ${fixedIn(t)}`}
                  </span>
                </span>
                <span className={`it-ticket-state small ${t.status === 'open' ? '' : 'muted'}`}>{t.status === 'open' ? 'Open' : 'Closed'}</span>
                <Icon name="chevron-right" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && <TicketSheet t={picked} onClose={() => setOpenId(null)} />}
    </section>
  );
}
