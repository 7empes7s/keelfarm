// IT monitoring (#525): The IT department → Health. Each check's state (good / needs a look / bad / not here), its
// numbers, trend and last run, Check now (and the demo's Simulate low disk), and IT's open recommendations: ranked options with Run this, and Not now
// (snoozed a day). The recommendation cards also show in IT's chat.
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { openRecs, type ItCheck, type ItCheckLevel, type ItRecommendation } from '../../../shared/itWatch';
import type { ItRisk } from '../../../shared/itDesk';
import { agoText } from './peekFacts';
import { Icon } from './Icon';
import type { IconName } from './icons';
import './itDesk.css';
import './itHealth.css';

const NONE: never[] = [];
const LEVEL: Record<ItCheckLevel, { icon: IconName; word: string }> = {
  good: { icon: 'check', word: 'Good' },
  warn: { icon: 'circle-alert', word: 'Needs a look' },
  bad: { icon: 'x', word: 'Bad' },
  off: { icon: 'minus', word: 'Not on this machine' },
};
const RISK: Record<ItRisk, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };
const clock = (at: number) => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function RecCard({ r }: { r: ItRecommendation }) {
  const [busy, setBusy] = useState(false);
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn()
      .catch(() => undefined) // api() already toasted the error
      .finally(() => setBusy(false));
  };
  return (
    <article className="it-rec" aria-label={`Recommendation: ${r.title}`}>
      <h4 className="it-rec-title">
        <Icon name="stethoscope" /> {r.title}
      </h4>
      <p className="it-rec-evidence small">{r.evidence}</p>
      <ol className="it-rec-options">
        {r.options.map((o, i) => (
          <li key={i} className="it-rec-option">
            <div className="it-rec-option-text">
              <b>{o.does}</b>
              <span className="small">{o.frees}</span>
              <span className="small muted">
                <span className={`it-risk it-risk-${o.risk}`}>{RISK[o.risk]}</span> {o.undo}
              </span>
              <code className="it-rec-cmd small">{o.argv.join(' ')}</code>
            </div>
            <button type="button" className={`btn btn-small ${i === 0 ? 'btn-good' : ''}`} disabled={busy} onClick={() => act(() => api.itPick(r.id, i))} aria-label={`Run option ${i + 1}: ${o.does}`}>
              <Icon name="play" /> Run this
            </button>
          </li>
        ))}
      </ol>
      <div className="row it-rec-foot">
        <span className="muted small grow">
          {r.by} · {agoText(r.at, Date.now())}
        </span>
        <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => act(() => api.itSnooze(r.id))}>
          Not now
        </button>
      </div>
    </article>
  );
}

/** IT's open recommendations (snoozed ones hidden); nothing while there are none. */
export function ItRecCards() {
  const recs = useStore((x) => x.itWatch?.recs ?? NONE);
  const open = openRecs(recs, Date.now());
  if (!open.length) return null;
  return (
    <div className="it-recs">
      {open.map((r) => (
        <RecCard key={r.id} r={r} />
      ))}
    </div>
  );
}

function CheckRow({ c }: { c: ItCheck }) {
  const l = LEVEL[c.level];
  return (
    <li className={`it-check it-check-${c.level}`}>
      <span className="it-check-icon" role="img" aria-label={l.word}>
        <Icon name={l.icon} />
      </span>
      <div className="it-check-text">
        <b>{c.label}</b>
        <span className="small">{c.line}</span>
        {c.trend && <span className="small muted">{c.trend}</span>}
      </div>
      <span className="small muted it-check-word">{l.word}</span>
    </li>
  );
}

/** The IT department → Health. */
export function ItHealth() {
  const w = useStore((x) => x.itWatch);
  const demo = useStore((x) => x.demo);
  const checks = w?.checks ?? NONE;
  const snoozed = (w?.recs ?? NONE).filter((r) => r.snoozedUntil && r.snoozedUntil > Date.now());
  const [busy, setBusy] = useState(false);
  const wrong = checks.filter((c) => c.level === 'warn' || c.level === 'bad').length;
  const last = checks[0]?.at;
  const check = (lowDisk?: boolean) => {
    setBusy(true);
    void (lowDisk === undefined ? Promise.resolve() : api.simulateDisk(lowDisk))
      .then(() => api.itWatchCheck())
      .catch(() => undefined) // api() already toasted the error
      .finally(() => setBusy(false));
  };
  const diskBad = checks.some((c) => c.id === 'disk' && c.level === 'bad');
  return (
    <section className="card it-health" aria-labelledby="it-health-h">
      <div className="row it-health-head">
        <h3 id="it-health-h" className="grow">
          <Icon name="stethoscope" /> Health
        </h3>
        {demo && (
          <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => check(!diskBad)} title="The demo only: pretend the disk is nearly full, or has room again">
            {diskBad ? 'Disk has room' : 'Simulate low disk'}
          </button>
        )}
        <button type="button" className="btn btn-small" disabled={busy || w?.running || w?.on === false} onClick={() => check()}>
          <Icon name="refresh-cw" /> {busy || w?.running ? 'Checking…' : 'Check now'}
        </button>
      </div>
      <p className="muted small" role="status">
        {w?.on === false ? 'Health checks are off.' : !checks.length ? 'The first check runs a few seconds after the office starts, then every 5 minutes. No AI is used to watch: IT is woken only when something gets worse.' : `${wrong ? `${wrong} need${wrong === 1 ? 's' : ''} a look` : 'All good'} · checked ${last ? agoText(last, Date.now()) : '—'}`}
      </p>
      <ItRecCards />
      {snoozed.map((r) => (
        <p key={r.id} className="muted small it-snoozed">
          <Icon name="moon" /> Not now until {clock(r.snoozedUntil!)}: {r.title}
        </p>
      ))}
      {checks.length > 0 && (
        <ul className="it-checks" aria-label="Health checks">
          {checks.map((c) => (
            <CheckRow key={c.id} c={c} />
          ))}
        </ul>
      )}
    </section>
  );
}
