import { useEffect, useState } from 'react';
import { isReset, readingsNote, usageBars } from '../../../shared/usage';
import { useStore } from '../store';
import { ProgressBar } from './ProgressBar';
import { HoverCard, PeekCard } from './HoverCard';
import { fmtUsd } from '../ops';
import { sharesNote, shareStats } from './peekFacts';

// Claude's latest usage, one bar per limit ("5-hour: 42%, resets 18:30"), in Mission control and on pocket mode's
// company page. The numbers are the whole subscription's, read from the agents' and the CEO's sessions,
// or by the office itself while they're idle (#89).

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

/** `link`: each bar opens Claude's usage page (off inside a card that is itself a button). */
export function UsageBars({ link = true }: { link?: boolean }) {
  const readings = useStore((s) => s.claudeUsage);
  const check = useStore((s) => s.claudeUsageCheck);
  const now = useNow(30_000);
  const note = readingsNote(readings, now, check) ?? (readings.some((r) => isReset(r, now)) ? 'Reset, waiting for a new reading' : null);
  const allShares = useStore((s) => s.claudeUsageShares);
  const repos = useStore((s) => s.repos);
  const floorOf = (id: string) => {
    const r = repos.find((x) => x.id === id);
    return r && `Floor ${r.floor} · ${r.fullName.split('/')[1]}`;
  };
  // The meters' hover card (#213): what's counted, when it resets, and who spent the office's part of each bar's window (#334).
  const shares = new Map(allShares.filter((s) => s.rows.length).map((s) => [s.type, { rows: shareStats(s, floorOf, fmtUsd), note: sharesNote(s, now, fmtUsd) }]));
  return (
    <div className="usage-bars">
      {usageBars(readings, now).map((b) => (
        <HoverCard
          key={b.type}
          label={`${b.name} usage`}
          peek={
            <PeekCard
              title={`${b.name}: ${b.pct}%`}
              sub="The whole Claude plan’s use in this window: every agent’s and the CEO’s sessions, plus your own."
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
            aria={`Claude's ${b.name.toLowerCase()} usage: ${b.pct}%${b.resets ? `, ${b.resets}` : ''}`}
            href={link ? USAGE_PAGE : undefined}
            tap={link ? "Open Claude's usage page" : undefined}
          />
        </HoverCard>
      ))}
      {note && <div className="muted small usage-note">{note}</div>}
    </div>
  );
}
