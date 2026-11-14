// Earnings vs. spend (#666): the Company page's top card (this week's earnings, spend and profit, 8 weeks as bars) and,
// one tap away, the sheet with the weeks, the split by floor and by cost type, the earnings by source, manual entries,
// fixed monthly costs and each floor's feed. A floor's feed URL is set in its floor settings (EarningsFeedField).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { CostType, EarningsView, EarningsWeek } from '../../../shared/earnings';
import type { RepoView } from '../../../shared/types';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { confirmDialog } from './Confirm';
import { pushLayer } from './backStack';
import './earnings.css';

const usd = (n: number, sign = false) => {
  const s = `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 })}`;
  return n < 0 ? `−${s}` : sign && n > 0 ? `+${s}` : s;
};
const weekLabel = (start: string) => new Date(`${start}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const TYPE_LABEL: Record<CostType, string> = { claude: 'Claude (agents and CEO)', providers: 'Providers', fixed: 'Fixed costs' };
const tone = (n: number) => (n > 0 ? 'good' : n < 0 ? 'bad' : '');
const quiet = async <T,>(p: Promise<T>) => p.catch(() => undefined); // api() already toasted the error

/** 8 weeks as pairs of bars, earnings beside spend, this week last. */
function Trend({ weeks }: { weeks: EarningsWeek[] }) {
  const top = Math.max(1, ...weeks.flatMap((w) => [w.earnings, w.spend]));
  const h = (n: number) => Math.max(2, Math.round((Math.max(0, n) / top) * 40));
  return (
    <svg className="earn-trend" viewBox={`0 0 ${weeks.length * 24} 44`} preserveAspectRatio="none" role="img" aria-label={`8 weeks: ${weeks.map((w) => `${weekLabel(w.start)} ${usd(w.profit, true)}`).join(', ')}`}>
      {weeks.map((w, i) => (
        <g key={w.start}>
          <rect className="earn-bar-in" x={i * 24 + 3} y={44 - h(w.earnings)} width={8} height={h(w.earnings)} rx={2} />
          <rect className="earn-bar-out" x={i * 24 + 12} y={44 - h(w.spend)} width={8} height={h(w.spend)} rx={2} />
        </g>
      ))}
    </svg>
  );
}

function noDataText(v: EarningsView, repos: RepoView[]) {
  const floors = v.noData.map((id) => repos.find((r) => r.id === id)?.floor).filter((f) => f !== undefined);
  if (!floors.length) return null;
  return `${floors.length === 1 ? `Floor ${floors[0]}'s feed` : `Floors ${floors.join(', ')}' feeds`} couldn't be read: missing, not $0.`;
}

/** The Company page's card: tap it for the details. */
export function EarningsCard() {
  const v = useStore((s) => s.earnings);
  const repos = useStore((s) => s.repos);
  const [open, setOpen] = useState(false);
  if (!v) return null;
  const w = v.week;
  const missing = noDataText(v, repos);
  return (
    <>
      <button className="pk-card earn-card" onClick={() => setOpen(true)} aria-label={`Earnings this week: earned ${usd(w.earnings)}, spent ${usd(w.spend)}, ${w.profit < 0 ? 'loss' : 'profit'} ${usd(w.profit)}. Open the details`}>
        <span className="earn-head">
          <b className="small">
            <Icon name="wallet" /> Earnings this week
          </b>
          <span className="muted small">
            Details <Icon name="chevron-right" />
          </span>
        </span>
        <span className="earn-stats">
          <span className="earn-stat">
            <span className="muted small">Earned</span>
            <b>{usd(w.earnings)}</b>
          </span>
          <span className="earn-stat">
            <span className="muted small">Spent</span>
            <b>{usd(w.spend)}</b>
          </span>
          <span className={`earn-stat earn-${tone(w.profit)}`}>
            <span className="muted small">{w.profit < 0 ? 'Loss' : 'Profit'}</span>
            <b>{usd(w.profit, true)}</b>
          </span>
        </span>
        <Trend weeks={v.weeks} />
        <span className="earn-legend small muted">
          <span><i className="earn-dot earn-dot-in" /> earned</span>
          <span><i className="earn-dot earn-dot-out" /> spent</span>
          <span className="grow" />
          <span>8 weeks</span>
        </span>
        {missing && (
          <span className="earn-warn small">
            <Icon name="triangle-alert" /> {missing}
          </span>
        )}
      </button>
      {open && <EarningsSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function Row({ label, a, b, c, badge }: { label: string; a: string; b?: string; c?: { text: string; tone: string }; badge?: number }) {
  return (
    <li className="earn-row">
      {badge !== undefined && <span className="floor-badge">{badge}</span>}
      <span className="grow earn-row-label">{label}</span>
      <span className="earn-num">{a}</span>
      {b !== undefined && <span className="earn-num muted">{b}</span>}
      {c && <span className={`earn-num earn-${c.tone}`}>{c.text}</span>}
    </li>
  );
}

function EarningsSheet({ onClose }: { onClose: () => void }) {
  const v = useStore((s) => s.earnings);
  const repos = useStore((s) => s.repos);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => pushLayer(() => close.current()), []); // Back closes it
  const name = (id: string | null) => {
    const r = id ? repos.find((x) => x.id === id) : undefined;
    return r ? r.fullName.split('/')[1] : id ? 'A floor that left' : 'The company';
  };
  const floorOf = (id: string | null) => (id ? repos.find((x) => x.id === id)?.floor : undefined);
  if (!v) return null;
  return (
    <Sheet title={<><Icon name="wallet" /> Earnings vs. spend</>} onClose={onClose} className="earn-sheet">
      <section>
        <h3 className="phone-h">Weeks</h3>
        <ul className="earn-list">
          <li className="earn-row earn-row-head muted small">
            <span className="grow">Week of</span>
            <span className="earn-num">Earned</span>
            <span className="earn-num">Spent</span>
            <span className="earn-num">Profit</span>
          </li>
          {[...v.weeks].reverse().map((w, i) => (
            <Row key={w.start} label={i === 0 ? 'This week' : weekLabel(w.start)} a={usd(w.earnings)} b={usd(w.spend)} c={{ text: usd(w.profit, true), tone: tone(w.profit) }} />
          ))}
        </ul>
      </section>
      <section>
        <h3 className="phone-h">This week by floor</h3>
        <ul className="earn-list">
          <li className="earn-row earn-row-head muted small">
            <span className="grow">Floor</span>
            <span className="earn-num">Earned</span>
            <span className="earn-num">Spent</span>
          </li>
          {v.byFloor.map((f) => (
            <Row key={f.repoId ?? ''} badge={floorOf(f.repoId)} label={f.repoId ? name(f.repoId) : 'The company (CEO, providers, fixed)'} a={f.earnings === null ? 'no data' : usd(f.earnings)} b={usd(f.spend)} />
          ))}
        </ul>
      </section>
      <section>
        <h3 className="phone-h">This week's spend by type</h3>
        <ul className="earn-list">
          {v.byType.map((t) => (
            <Row key={t.type} label={TYPE_LABEL[t.type]} a={usd(t.usd)} />
          ))}
        </ul>
      </section>
      {v.bySource.length > 0 && (
        <section>
          <h3 className="phone-h">This week's earnings by source</h3>
          <ul className="earn-list">
            {v.bySource.map((s) => (
              <Row key={s.source} label={s.source === 'Feed' ? 'Floor feeds' : s.source} a={usd(s.usd)} />
            ))}
          </ul>
        </section>
      )}
      <Entries v={v} name={name} />
      <FixedCosts v={v} />
      <section>
        <h3 className="phone-h">Feeds</h3>
        {v.feeds.length === 0 && <p className="muted small">No floor has an earnings feed yet.</p>}
        <ul className="earn-list">
          {v.feeds.map((f) => (
            <li key={f.repoId} className="earn-row">
              <span className="floor-badge">{floorOf(f.repoId) ?? '?'}</span>
              <span className="grow earn-row-label">
                {name(f.repoId)}
                <span className="muted small earn-url">{f.url}</span>
              </span>
              <span className={`earn-num small ${f.status === 'no-data' ? 'earn-bad' : f.status === 'ok' ? 'earn-good' : 'muted'}`} title={f.error}>
                {f.status === 'ok' ? 'Read' : f.status === 'no-data' ? 'No data' : 'Waiting'}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">A floor's feed URL is in Settings → Floors, under its Earnings feed.</p>
      </section>
    </Sheet>
  );
}

function Entries({ v, name }: { v: EarningsView; name: (id: string | null) => string }) {
  const repos = useStore((s) => s.repos);
  const [form, setForm] = useState({ usd: '', source: '', date: '', repoId: '', note: '' });
  const add = (e: FormEvent) => {
    e.preventDefault();
    void quiet(api.addEarning({ usd: Number(form.usd), source: form.source, note: form.note, repoId: form.repoId || null, ...(form.date && { date: form.date }) })).then((x) => x && setForm({ usd: '', source: '', date: '', repoId: '', note: '' }));
  };
  const remove = (id: string, label: string) => void confirmDialog({ tone: 'danger', title: 'Remove this entry?', body: label, confirm: 'Remove' }).then((ok) => ok && quiet(api.removeEarning(id)));
  return (
    <section>
      <h3 className="phone-h">Entries</h3>
      <ul className="earn-list">
        {v.entries.map((e) => (
          <li key={e.id} className="earn-row">
            <span className="grow earn-row-label">
              {e.source}
              <span className="muted small">
                {e.date} · {name(e.repoId)}
                {e.note ? ` · ${e.note}` : ''}
              </span>
            </span>
            <span className="earn-num">{usd(e.usd)}</span>
            <Menu label={`More for ${e.source} on ${e.date}`} items={[{ label: 'Remove…', danger: true, onSelect: () => remove(e.id, `${e.source}, ${usd(e.usd)} on ${e.date}`) }]} />
          </li>
        ))}
      </ul>
      <form className="earn-form" onSubmit={add}>
        <input type="number" step="0.01" inputMode="decimal" placeholder="Amount ($)" aria-label="Amount in dollars" value={form.usd} onChange={(e) => setForm({ ...form, usd: e.target.value })} required />
        <input type="text" placeholder="Source, e.g. Sponsor" aria-label="Source" maxLength={60} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} required />
        <input type="date" aria-label="Date (today when empty)" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <select aria-label="Floor" value={form.repoId} onChange={(e) => setForm({ ...form, repoId: e.target.value })}>
          <option value="">The company</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              Floor {r.floor} · {r.fullName.split('/')[1]}
            </option>
          ))}
        </select>
        <input type="text" placeholder="Note (optional)" aria-label="Note" maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <button className="btn btn-small" type="submit">
          <Icon name="plus" /> Add earning
        </button>
      </form>
    </section>
  );
}

function FixedCosts({ v }: { v: EarningsView }) {
  const [label, setLabel] = useState('');
  const [monthly, setMonthly] = useState('');
  const add = (e: FormEvent) => {
    e.preventDefault();
    void quiet(api.addFixedCost({ label, usdPerMonth: Number(monthly) })).then((x) => x && (setLabel(''), setMonthly('')));
  };
  const remove = (id: string, what: string) => void confirmDialog({ tone: 'danger', title: `Remove ${what}?`, body: 'It no longer counts in any week.', confirm: 'Remove' }).then((ok) => ok && quiet(api.removeFixedCost(id)));
  return (
    <section>
      <h3 className="phone-h">Fixed monthly costs</h3>
      <p className="muted small">Spread over every day: {usd(v.fixedPerDay)} a day.</p>
      <ul className="earn-list">
        {v.fixed.map((f) => (
          <li key={f.id} className="earn-row">
            <span className="grow earn-row-label">{f.label}</span>
            <span className="earn-num">{usd(f.usdPerMonth)}/mo</span>
            <Menu label={`More for ${f.label}`} items={[{ label: 'Remove…', danger: true, onSelect: () => remove(f.id, f.label) }]} />
          </li>
        ))}
      </ul>
      <form className="earn-form" onSubmit={add}>
        <input type="text" placeholder="Name, e.g. Server" aria-label="Cost name" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} required />
        <input type="number" step="0.01" min="0.01" inputMode="decimal" placeholder="$ a month" aria-label="Dollars a month" value={monthly} onChange={(e) => setMonthly(e.target.value)} required />
        <button className="btn btn-small" type="submit">
          <Icon name="plus" /> Add cost
        </button>
      </form>
    </section>
  );
}

/** Floor settings: the floor's earnings feed URL, read every hour (through the Access token for the office's own apps). */
export function EarningsFeedField({ repo }: { repo: RepoView }) {
  const feed = useStore((s) => s.earnings?.feeds.find((f) => f.repoId === repo.id));
  return (
    <details className="small">
      <summary>
        <Icon name="wallet" /> Earnings feed{feed ? (feed.status === 'no-data' ? ' · no data' : feed.status === 'ok' ? ' · read' : '') : ' (none)'}
      </summary>
      <p className="muted">A JSON list of days ({'{ date, usd }'}) this floor's app earns. The office reads it every hour.</p>
      <input
        key={feed?.url ?? ''}
        type="url"
        defaultValue={feed?.url ?? ''}
        placeholder="https://… /api/earnings"
        aria-label={`Floor ${repo.floor} earnings feed URL`}
        onBlur={(e) => e.target.value.trim() !== (feed?.url ?? '') && void quiet(api.setEarningsFeed(repo.id, e.target.value))}
      />
      {feed?.error && <div className="term-error">{feed.error}</div>}
    </details>
  );
}
