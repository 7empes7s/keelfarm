// Usage for every account and provider (#361): one row per source (Claude and Codex accounts, ElevenLabs, Upstash
// Boxes, API spend), worst first, with a bar per window, "resets in 3h" and a status chip. A tap opens the source's
// detail: every window, the last day's history, who is on it and who spent it (UsageWho.tsx, #409), and (for API spend)
// the Admin key that reads the organisation's cost report. On the Company page (pocket mode) and in Mission control.
// Each row and sheet has the actions that fit its state (#404, UsageActions.tsx): the chip signs a signed-out account in.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtUsd } from '../ops';
import { useStore } from '../store';
import { ago } from '../../../shared/usage';
import { resetsIn, windowWords } from '../../../shared/usageSources';
import { type UsageProvider, type UsageSource, type UsageSourceStatus, type UsageWindow } from '../../../shared/types';
import { Chip } from './DetailsPage';
import type { ChipTone } from './detailsRules';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { ProgressBar } from './ProgressBar';
import { useBackLayer } from './Panel';
import { Sheet } from './Sheet';
import { sharesNote, shareStats } from './peekFacts';
import { SignInSheet } from './SignInSheet';
import { AgentsSheet, OnIt, UsageActionButton, runUsageAction, useUsageContext, type UsageHost } from './UsageActions';
import { backAt, chipAction, rowAction, usageActions } from './usageActionRules';
import { OnItNow, WindowSplit } from './UsageWho';
import './usageSources.css';

const ICON: Record<UsageProvider, IconName> = { claude: 'asterisk', codex: 'terminal', elevenlabs: 'mic', upstash: 'cloud', anthropic: 'wallet', openai: 'wallet', gemini: 'sparkles', openrouter: 'shuffle', hetzner: 'server', runway: 'clapperboard', luma: 'film', kling: 'video' };
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
  const accounts = useStore((s) => s.accounts.accounts);
  const [open, setOpen] = useState<string | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  if (!sources) return <p className="muted small">Usage for every account shows once the office has started.</p>;
  const shown = limit ? sources.slice(0, limit) : sources;
  const detail = sources.find((s) => s.id === open);
  const host: UsageHost = {
    // Settings' sign-in: its terminal starts, then the guided sheet (#350) follows it
    signIn: (id) => void api.signInAccount(id).then(() => setSigning(id), () => undefined),
    agents: setMoving,
    closeDetail: () => setOpen(null),
  };
  const signingIn = accounts.find((a) => a.id === signing);
  const movingOn = sources.find((s) => s.id === moving);
  return (
    <div className="us-list">
      {shown.map((s) => (
        <UsageRow key={s.id} s={s} now={now} host={host} onOpen={() => setOpen(s.id)} />
      ))}
      {limit && sources.length > limit && <p className="muted small">and {sources.length - limit} more in Mission control</p>}
      {detail && <UsageDetail s={detail} now={now} host={host} onClose={() => setOpen(null)} />}
      {movingOn && (
        <AgentsSheet
          s={movingOn}
          onClose={() => setMoving(null)}
          onAgent={() => {
            setMoving(null);
            setOpen(null);
          }}
        />
      )}
      {signingIn && <SignInSheet a={signingIn} close={() => setSigning(null)} />}
    </div>
  );
}

/** A row: the whole card opens its detail; the chip and the recommended action sit above that. */
function UsageRow({ s, now, host, onOpen }: { s: UsageSource; now: number; host: UsageHost; onOpen: () => void }) {
  const ctx = useUsageContext(s);
  const [word, chip] = STATUS[s.status];
  const action = rowAction(s, ctx);
  const onChip = chipAction(s, ctx);
  const chipRun = onChip === 'detail' ? undefined : usageActions(s, ctx).find((a) => a.id === onChip);
  return (
    <div className="us-row">
      <button type="button" className="us-open" onClick={onOpen} aria-label={`${s.label}: ${word}. Open its usage`} />
      <span className="us-head">
        <span className="us-icon" aria-hidden>
          <Icon name={ICON[s.provider]} />
        </span>
        <span className="us-name">
          <b>{s.label}</b>
          {s.plan && <span className="muted small"> · {s.plan}</span>}
        </span>
        <button type="button" className="us-chip" onClick={() => (chipRun ? runUsageAction(chipRun, s, host) : onOpen())} aria-label={chipRun ? `${word}: ${chipRun.label}` : `${word}: open its usage`}>
          <Chip tone={chip}>{word}</Chip>
        </button>
      </span>
      {s.windows.map((w) => (
        <WindowBar key={w.name} w={w} now={now} />
      ))}
      {!s.windows.length && s.note && <span className="muted small">{s.note}</span>}
      {action && (
        <span className="us-row-actions">
          <UsageActionButton a={action} s={s} host={host} />
        </span>
      )}
    </div>
  );
}

function UsageDetail({ s, now, host, onClose }: { s: UsageSource; now: number; host: UsageHost; onClose: () => void }) {
  useBackLayer(onClose); // Back closes the sheet, not what's under it
  const ctx = useUsageContext(s);
  const repos = useStore((st) => st.repos);
  const allShares = useStore((st) => st.claudeUsageShares);
  // The agents' Claude login: who spent the office's part of this week, as Mission control's meter shows (#213, #334).
  const week = s.id === 'claude-login' ? allShares.find((x) => x.type === 'seven_day') : undefined;
  const shares = week
    ? shareStats(week, (id) => {
        const r = repos.find((x) => x.id === id);
        return r && `Floor ${r.floor} · ${r.fullName.split('/')[1]}`;
      }, fmtUsd)
    : [];
  const [word, chip] = STATUS[s.status];
  const back = resetsIn(backAt(s, ctx.account?.until, now), now);
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
        {s.status === 'limited' && <p className="small">{back ? <>Back <b>{back}</b></> : "It's back when its limit resets."}</p>}
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
        {shares.length > 0 && !s.split && (
          <div>
            <b className="small">Floor shares this week</b> <span className="muted small">{sharesNote(week!, now, fmtUsd)}</span>
            <p className="small">{shares.map(([name, v]) => `${name} ${v}`).join(' · ')}</p>
          </div>
        )}
        {s.accountId ? (
          <>
            <OnItNow accountId={s.accountId} pinned={s.agents ?? []} now={now} close={onClose} />
            <WindowSplit split={s.split} close={onClose} />
          </>
        ) : (
          <div>
            <b className="small">On it</b>
            <OnIt ids={s.agents ?? []} onOpen={onClose} />
          </div>
        )}
        {admin && <AdminKey provider={admin} />}
        <div className="us-actions" role="group" aria-label="Actions">
          {usageActions(s, ctx).map((a) => (
            <UsageActionButton key={a.id} a={a} s={s} host={host} />
          ))}
        </div>
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
