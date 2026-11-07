// The health strip (#55): this computer's memory, swap and load, the sessions running and waiting, and why new work
// waits or which session the office lost to memory. On the console's Floors tab, so pocket mode shows it too. Also the
// memory settings (Settings → Office) it goes by.
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { gb, type MemorySettings } from '../../../shared/health';

const RECENT_MS = 6 * 3_600_000; // a stop older than this is history, not news

export function HealthStrip() {
  const health = useStore((s) => s.health);
  const demo = useStore((s) => s.demo);
  const headroom = useStore((s) => s.settings.memory.headroomMb);
  const [busy, setBusy] = useState(false);
  const m = health?.memory;
  if (!health || !m) return null;
  const free = m.availableMb + m.swapFreeMb;
  const tone = health.held || free < headroom ? 'office-state-bad' : free < headroom * 2 ? 'office-state-busy' : 'office-state-ok';
  const stop = health.lastStop && Date.now() - health.lastStop.at < RECENT_MS ? health.lastStop : null;
  const low = m.availableMb < headroom * 2;
  const simulate = () => {
    setBusy(true);
    void api
      .simulateMemory(!low)
      .catch(() => undefined) // api() already toasted it
      .finally(() => setBusy(false));
  };
  return (
    <div className="card office-card" id="ops-card-health">
      <div className="row wrap">
        <span className="floor-badge office-badge" aria-hidden>
          🩺
        </span>
        <div className="grow">
          <b>Server</b>{' '}
          <span className="muted small">
            {gb(m.availableMb)} of {gb(m.totalMb)} memory free{m.swapTotalMb > 0 && ` · swap ${gb(m.swapFreeMb)} free`}
            {m.load !== null && ` · load ${m.load.toFixed(1)} on ${m.cpus} cores`}
          </span>
          <div className={`small office-state ${tone}`} role="status">
            {health.held ?? `${health.running} session${health.running === 1 ? '' : 's'} running${health.waiting ? `, ${health.waiting} waiting for memory to resume` : ''}`}
          </div>
          {stop && (
            <div className="small muted">
              {new Date(stop.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: {stop.agent}: {stop.why}
            </div>
          )}
        </div>
        {demo && (
          <div className="office-actions">
            <button className="btn btn-small btn-ghost" disabled={busy} onClick={simulate} title="The demo only: pretend this computer is short of memory, or has it back">
              {low ? 'Memory back' : 'Simulate low memory'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Settings → Office: the headroom kept free, the most one session may use, and when a wait pings the manager. */
export function MemoryFields({ memory, set }: { memory: MemorySettings; set: (p: { memory: MemorySettings }) => void }) {
  const field = (key: 'headroomMb' | 'sessionMaxMb', label: string, min: number, none: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        key={memory[key]}
        type="number"
        min={min}
        step={0.5}
        placeholder={none}
        defaultValue={memory[key] ? memory[key] / 1024 : ''}
        onBlur={(e) => {
          const mb = Math.round((Number(e.target.value) || 0) * 1024);
          if (mb !== memory[key]) set({ memory: { ...memory, [key]: mb } });
        }}
      />
    </label>
  );
  return (
    <>
      {field('headroomMb', 'Memory kept free (GB)', 0, '0')}
      {field('sessionMaxMb', 'Most memory per session (GB)', 0.5, 'No limit')}
      <label className="field">
        <span>Ping me when work waits for memory (min)</span>
        <input
          key={memory.alertAfterMin}
          type="number"
          min={1}
          step={1}
          defaultValue={memory.alertAfterMin}
          onBlur={(e) => {
            const min = Math.round(Number(e.target.value));
            if (min >= 1 && min !== memory.alertAfterMin) set({ memory: { ...memory, alertAfterMin: min } });
          }}
        />
      </label>
      <p className="muted small">
        New sessions wait while starting one would leave less than this free (memory and swap), and on Linux a session whose processes grow past its most is stopped and resumed later. Leave the most empty
        for no limit; the CEO always gets to work. A wait shows in the office at once; your devices ring only when it lasts this long, at most once an hour.
      </p>
    </>
  );
}
