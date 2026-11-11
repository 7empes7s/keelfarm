import { useEffect, useState } from 'react';
import { isReset, readingsNote, usageBars, usageMeters, type UsageMeter } from '../../../shared/usage';
import type { UsageCheckError } from '../../../shared/types';
import { Chip } from './DetailsPage';
import { useStore } from '../store';
import { ProgressBar } from './ProgressBar';
import { HoverCard, PeekCard } from './HoverCard';
import { fmtUsd } from '../ops';
import { sharesNote, shareStats } from './peekFacts';

// Claude's latest usage, one bar per limit ("5-hour: 42%, resets 18:30"), in Mission control and on pocket mode's
// company page: a row per Claude login (#383), each with its own numbers, read from the sessions on it or by the
// office itself while they're idle (#89).

/** Claude's own page of the plan's limits. */
const USAGE_PAGE = 'https://claude.ai/settings/usage';

/** Re-render every `ms`, so "resets" and "as of" keep up with the clock. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** `link`: each bar opens Claude's usage page (off inside a card that is itself a button). One row per Claude login (#383). */
export function UsageBars({ link = true }: { link?: boolean }) {
  const readings = useStore((s) => s.claudeUsage);
  const accounts = useStore((s) => s.accounts);
  const check = useStore((s) => s.claudeUsageCheck);
  const now = useNow(30_000);
  const allShares = useStore((s) => s.claudeUsageShares);
  const repos = useStore((s) => s.repos);
  const floorOf = (id: string) => {
    const r = repos.find((x) => x.id === id);
    return r && `Floor ${r.floor} · ${r.fullName.split('/')[1]}`;
  };
  // The meters' hover card (#213): what's counted, when it resets, and who spent the office's part of each bar's window (#334).
  // The shares' windows are the built-in login's readings, so only its row shows them.
  const shares = new Map(allShares.filter((s) => s.rows.length).map((s) => [s.type, { rows: shareStats(s, floorOf, fmtUsd), note: sharesNote(s, now, fmtUsd) }]));
  const meters = usageMeters(accounts, readings);
  const many = meters.length > 1;
  return (
    <div className="usage-bars">
      {meters.map((m) => (
        <Meter key={m.id} m={m} titled={many} link={link} now={now} check={m.builtIn ? check : null} shares={m.builtIn ? shares : new Map()} />
      ))}
    </div>
  );
}

type Shares = Map<string, { rows: [string, string][]; note: string | null }>;

/** One Claude login's bars: its name, plan and Next / CEO marks when there are several, then a bar per limit and its "as of". */
function Meter({ m, titled, link, now, check, shares }: { m: UsageMeter; titled: boolean; link: boolean; now: number; check: UsageCheckError | null; shares: Shares }) {
  const note = readingsNote(m.readings, now, check) ?? (m.readings.some((r) => isReset(r, now)) ? 'Reset, waiting for a new reading' : null);
  const who = titled ? m.name : 'Claude';
  return (
    <div className="usage-meter">
      {titled && (
        <div className="usage-meter-head">
          <b className="usage-meter-name">{m.name}</b>
          {m.plan && <span className="muted small">{m.plan}</span>}
          {m.next && <Chip tone="good">Next</Chip>}
          {m.ceo && <Chip>CEO</Chip>}
        </div>
      )}
      {usageBars(m.readings, now).map((b) => (
        <HoverCard
          key={b.type}
          label={`${who} ${b.name} usage`}
          peek={
            <PeekCard
              title={`${titled ? `${m.name} · ` : ''}${b.name}: ${b.pct}%`}
              sub={titled ? `${m.name}’s use in this window: every session on this login, plus your own.` : 'The whole Claude plan’s use in this window: every agent’s and the CEO’s sessions, plus your own.'}
              stats={[['Resets', b.resets ?? 'not said'], ...(shares.get(b.type)?.rows ?? [])]}
              bar={{ pct: b.pct / 100, tone: b.tone, label: `${b.pct}% used` }}
              note={shares.get(b.type)?.note ?? note}
            />
          }
        >
          <ProgressBar
            label={<b>{b.name}</b>}
            value={`${b.pct}%${b.resets ? `, ${b.resets}` : ''}`}
            pct={b.pct / 100}
            tone={b.tone}
            aria={`${who}'s ${b.name.toLowerCase()} usage: ${b.pct}%${b.resets ? `, ${b.resets}` : ''}`}
            href={link ? USAGE_PAGE : undefined}
            tap={link ? "Open Claude's usage page" : undefined}
          />
        </HoverCard>
      ))}
      {note && <div className="muted small usage-note">{note}</div>}
    </div>
  );
}
