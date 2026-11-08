// Providers & accounts → Rotation (#248): the switches for automatic fallback, its numbers (switches today, minutes
// saved, API spend because of fallback, the latest switches) and each account's timeline of when it was limited.
import { api } from '../api';
import { useStore } from '../store';
import { rotationSettings, spanBars } from '../../../shared/accountRotation';
import { clock } from '../../../shared/usage';
import type { AccountView, RotationSettings, RotationStats } from '../../../shared/types';
import { Icon } from './Icon';

const usd = (n: number) => `$${n.toFixed(2)}`;
const minutes = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`);

/** The rotation's numbers, for this page and Mission control. */
function RotationTiles({ stats }: { stats: RotationStats | undefined }) {
  const s = stats ?? { switchesToday: 0, minutesSaved: 0, apiUsd: 0, recent: [] };
  const tiles: [string, string][] = [
    ['Switches today', String(s.switchesToday)],
    ['Minutes saved', minutes(s.minutesSaved)],
    ['API spend from fallback', usd(s.apiUsd)],
  ];
  return (
    <div className="acc-stats" role="list" aria-label="Rotation today">
      {tiles.map(([label, value]) => (
        <div key={label} className="acc-stat" role="listitem">
          <b>{value}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

/** Mission control → Where the plan goes: the rotation's day, with the way to Providers & accounts. */
export function RotationOps() {
  const stats = useStore((s) => s.accounts.rotation);
  return (
    <section id="ops-card-rotation" aria-labelledby="rotation-title">
      <h3 id="rotation-title" className="section">
        <Icon name="shuffle" /> Account rotation
      </h3>
      <RotationTiles stats={stats} />
      <a className="small" href="#settings/accounts">
        Providers & accounts
      </a>
    </section>
  );
}

export function RotationCard() {
  const saved = useStore((s) => s.settings.rotation);
  const stats = useStore((s) => s.accounts.rotation);
  const r = rotationSettings(saved, undefined);
  const now = Date.now();
  const set = (patch: Partial<RotationSettings>) => void api.updateSettings({ rotation: { ...r, ...patch } }).catch(() => undefined);
  const ceoCodex = r.ceoClis.includes('codex');
  return (
    <section className="acc-cli" aria-label="Rotation">
      <h4>
        <Icon name="shuffle" /> Rotation
      </h4>
      <p className="muted small">When a session hits an account's limit or its sign-in fails, it starts again on the next ready account at once. Nothing counts against its task.</p>
      <div className="ds-switches">
        <label className="toggle">
          <input type="checkbox" checked={r.on} onChange={(e) => set({ on: e.target.checked })} /> Switch accounts automatically
        </label>
        <label className="toggle">
          <input type="checkbox" checked={r.apiLast} disabled={!r.on} onChange={(e) => set({ apiLast: e.target.checked })} /> API keys only as a last resort
        </label>
        <label className="toggle">
          <input type="checkbox" checked={r.agentsSwitchCli} disabled={!r.on} onChange={(e) => set({ agentsSwitchCli: e.target.checked })} /> Agents fall back to another coding agent when out
        </label>
        <label className="toggle">
          <input type="checkbox" checked={ceoCodex} disabled={!r.on} onChange={(e) => set({ ceoClis: e.target.checked ? ['codex'] : [] })} /> The CEO may fall back to Codex
        </label>
      </div>
      <RotationTiles stats={stats} />
      {stats?.recent.length ? (
        <ul className="acc-switches" aria-label="Latest switches">
          {stats.recent.map((s) => (
            <li key={`${s.at}-${s.agentId}`} className="small">
              <b>{clock(s.at, now)}</b> {s.agentName}: {s.from} → {s.to}
              <span className="muted"> ({s.why === 'signed-out' ? 'signed out' : 'limited'})</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** When an account was limited in the last 24 hours, as marks on a bar. */
export function LimitTimeline({ a, now }: { a: AccountView; now: number }) {
  const bars = spanBars(a.limitSpans, now);
  if (!bars.length) return null;
  return (
    <div className="acc-timeline" role="img" aria-label={`${a.label}: limited ${bars.length} time${bars.length === 1 ? '' : 's'} in the last 24 hours`}>
      {bars.map((b) => (
        <span key={b.left} style={{ left: `${b.left * 100}%`, width: `${b.width * 100}%` }} />
      ))}
      <small className="muted">24 h ago</small>
      <small className="muted">now</small>
    </div>
  );
}
