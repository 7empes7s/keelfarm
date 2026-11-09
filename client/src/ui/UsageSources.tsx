// Usage for every account and provider (#361): one row per source (Claude and Codex accounts, ElevenLabs, Upstash
// Boxes, API spend), worst first, with a bar per window, "resets in 3h" and a status chip. A tap opens the source's
// detail: every window, the last day's history, the agents on it, and (for API spend) the Admin key that reads the
// organisation's cost report. On the Company page (pocket mode) and in Mission control.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtUsd } from '../ops';
import { useStore } from '../store';
import { ago } from '../../../shared/usage';
import { resetsIn, windowWords } from '../../../shared/usageSources';
import { CEO_ID, type UsageProvider, type UsageSource, type UsageSourceStatus, type UsageWindow } from '../../../shared/types';
import { Chip } from './DetailsPage';
import type { ChipTone } from './detailsRules';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { ProgressBar } from './ProgressBar';
import { Sheet } from './Sheet';
import { floorShares } from './peekFacts';
import './usageSources.css';

const ICON: Record<UsageProvider, IconName> = { claude: 'asterisk', codex: 'terminal', elevenlabs: 'mic', upstash: 'cloud', anthropic: 'wallet', openai: 'wallet', gemini: 'sparkles', openrouter: 'shuffle', hetzner: 'server' };
const STATUS: Record<UsageSourceStatus, [string, ChipTone]> = { ready: ['Ready', 'good'], near: ['Near limit', 'warn'], limited: ['Limited', 'bad'], 'signed-out': ['Signed out', 'bad'], error: ['Error', 'warn'] };
const tone = (w: UsageWindow) => (w.usedPct === null ? 'neutral' : w.usedPct >= 90 ? 'bad' : w.usedPct >= 75 ? 'warn' : 'good');

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function WindowBar({ w, now }: { w: UsageWindow; now: number }) {
  const when = resetsIn(w.resetsAt, now);
  const value = w.usedPct === null ? windowWords(w) : `${w.usedPct}%${when ? ` · resets ${when}` : ''}`;
  return <ProgressBar compact label={<b>{w.name}</b>} value={value} pct={w.usedPct === null ? 0 : w.usedPct / 100} tone={tone(w)} aria={`${w.name}: ${value}`} />;
}

/** The usage card's rows; `limit` shows only the worst few (the Company page). */
export function UsageSources({ limit }: { limit?: number }) {
  const sources = useStore((s) => s.accounts.sources);
  const now = useNow(30_000);
  const [open, setOpen] = useState<string | null>(null);
  if (!sources) return <p className="muted small">Usage for every account shows once the office has started.</p>;
  const shown = limit ? sources.slice(0, limit) : sources;
  const detail = sources.find((s) => s.id === open);
  return (
    <div className="us-list">
      {shown.map((s) => {
        const [word, chip] = STATUS[s.status];
        return (
          <button key={s.id} type="button" className="us-row" onClick={() => setOpen(s.id)} aria-label={`${s.label}: ${word}. Open its usage`}>
            <span className="us-head">
              <span className="us-icon" aria-hidden>
                <Icon name={ICON[s.provider]} />
              </span>
              <span className="us-name">
                <b>{s.label}</b>
                {s.plan && <span className="muted small"> · {s.plan}</span>}
              </span>
              <Chip tone={chip}>{word}</Chip>
            </span>
            {s.windows.map((w) => (
              <WindowBar key={w.name} w={w} now={now} />
            ))}
            {!s.windows.length && s.note && <span className="muted small">{s.note}</span>}
          </button>
        );
      })}
      {limit && sources.length > limit && <p className="muted small">and {sources.length - limit} more in Mission control</p>}
      {detail && <UsageDetail s={detail} now={now} onClose={() => setOpen(null)} />}
    </div>
  );
}

function UsageDetail({ s, now, onClose }: { s: UsageSource; now: number; onClose: () => void }) {
  const agents = useStore((st) => st.agents);
  const repos = useStore((st) => st.repos);
  const names = (s.agents ?? []).map((id) => `${agents[id]?.name ?? id}${id === CEO_ID ? ' (CEO)' : ''}`);
  // The agents' Claude login: the floors' share of the running sessions, as Mission control's meter shows (#213).
  const shares =
    s.id === 'claude-login'
      ? floorShares(Object.values(agents), (id) => {
          const r = repos.find((x) => x.id === id);
          return r && `Floor ${r.floor} · ${r.fullName.split('/')[1]}`;
        })
      : [];
  const [word, chip] = STATUS[s.status];
  const admin = s.provider === 'anthropic' || s.provider === 'openai' ? s.provider : s.windows.some((w) => w.unit === '$') ? (s.provider === 'codex' ? 'openai' : 'anthropic') : null;
  return (
    <Sheet
      title={
        <>
          <Icon name={ICON[s.provider]} /> {s.label}
        </>
      }
      onClose={onClose}
      className="us-sheet"
    >
      <div className="us-detail">
        <span className="dp-chips">
          <Chip tone={chip}>{word}</Chip>
          {s.plan && <Chip>{s.plan}</Chip>}
          <span className="muted small">{s.checkedAt ? `read ${ago(s.checkedAt, now)}` : 'not read yet'}</span>
        </span>
        {s.windows.map((w) => (
          <div key={w.name}>
            <WindowBar w={w} now={now} />
            <span className="muted small">{windowWords(w)}</span>
          </div>
        ))}
        {s.spendUsd7d !== undefined && (
          <p className="small">
            Last 7 days: <b>{fmtUsd(s.spendUsd7d)}</b>
          </p>
        )}
        {s.note && <p className="muted small">{s.note}</p>}
        <History points={s.history ?? []} />
        {shares.length > 0 && (
          <div>
            <b className="small">Floor shares</b> <span className="muted small">what the agents working now have spent so far</span>
            <p className="small">{shares.map((x) => `${x.name} ${Math.round(x.share * 100)}%`).join(' · ')}</p>
          </div>
        )}
        <div>
          <b className="small">On it</b>
          <p className="small">{names.length ? names.join(', ') : 'No agent is pinned to it: the rotation uses it in its turn.'}</p>
        </div>
        {admin && <AdminKey provider={admin} />}
      </div>
    </Sheet>
  );
}

/** The last day's fullest window, a bar per half hour. */
function History({ points }: { points: [number, number][] }) {
  if (points.length < 2) return <p className="muted small">History: it fills in as the office reads it (a point every half hour).</p>;
  const peak = Math.max(...points.map((p) => p[1]));
  return (
    <div>
      <b className="small">Last day</b> <span className="muted small">peak {peak}%</span>
      <div className="us-history" role="img" aria-label={`Usage over the last day, peak ${peak}%`}>
        {points.map(([at, pct]) => (
          <span key={at} className={`us-tick us-${pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'good'}`} style={{ height: `${Math.max(4, pct)}%` }} />
        ))}
      </div>
    </div>
  );
}

function AdminKey({ provider }: { provider: 'anthropic' | 'openai' }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const who = provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
  const save = async () => {
    setBusy(true);
    try {
      await api.setUsageAdminKey(provider, key);
      setKey('');
    } catch {
      // api() toasted it
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="us-admin"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="small" htmlFor={`us-admin-${provider}`}>
        <b>{who} Admin key</b> (optional): the whole organisation's API spend from {who}'s cost report. Saved on this computer, never shown again.
      </label>
      <div className="us-admin-row">
        <input id={`us-admin-${provider}`} type="password" autoComplete="off" value={key} placeholder={provider === 'anthropic' ? 'sk-ant-admin…' : 'sk-admin-…'} onChange={(e) => setKey(e.target.value)} />
        <button className="ds-btn" type="submit" disabled={busy || !key.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}
