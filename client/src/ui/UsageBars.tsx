import { useEffect, useState } from 'react';
import { readingsNote, usageBars } from '../../../shared/usage';
import { useStore } from '../store';

// Claude's latest usage, one bar per limit ("5-hour: 42%, resets 18:30"), in Mission control and on pocket mode's
// company page. The numbers are the whole subscription's, read from the agents' and the CEO's sessions.

/** Re-render every `ms`, so "resets" and "as of" keep up with the clock. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function UsageBars() {
  const readings = useStore((s) => s.claudeUsage);
  const now = useNow(30_000);
  const note = readingsNote(readings, now);
  return (
    <div className="usage-bars">
      {usageBars(readings, now).map((b) => (
        <div key={b.type} className="usage-bar">
          <div className="small usage-bar-label">
            <b>{b.name}</b>: {b.pct}%{b.resets && <span className="muted">, {b.resets}</span>}
          </div>
          <div className={`usage-gauge usage-gauge-${b.tone}`} role="meter" aria-label={`Claude's ${b.name.toLowerCase()} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={b.pct}>
            <div style={{ width: `${Math.min(100, b.pct)}%` }} />
          </div>
        </div>
      ))}
      {note && <div className="muted small usage-note">{note}</div>}
    </div>
  );
}
