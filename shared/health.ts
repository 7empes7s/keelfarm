// The office's health (#55): memory, swap and load, sessions running and waiting, and the memory settings, for the
// health strip in the manager's console and pocket mode. The server's side (readings, admission, stops and retries) is
// server/health.ts.

/** What a session is for: each kind has its own memory estimate. The test lab's (#56): a browser job, a heavy command. */
export type SessionKind = 'build' | 'fix' | 'qa' | 'preview' | 'ceo' | 'labBrowser' | 'labRun';

export interface MemorySettings {
  headroomMb: number; // kept free for the system: new work waits rather than eat into it
  sessionMaxMb: number; // most one agent's processes may use before the office stops them (Linux); 0 = no ceiling
  estimates: Partial<Record<SessionKind, number>>; // learned from past sessions' peak memory, MB
}

/** Before any session has been measured. */
export const DEFAULT_ESTIMATES: Record<SessionKind, number> = { build: 1536, fix: 1536, qa: 1536, preview: 512, ceo: 512, labBrowser: 512, labRun: 1536 };
export const DEFAULT_MEMORY: MemorySettings = { headroomMb: 1536, sessionMaxMb: 4096, estimates: {} };

const KINDS = Object.keys(DEFAULT_ESTIMATES) as SessionKind[];
const mb = (raw: unknown, min: number, max: number) => (Number.isFinite(Number(raw)) ? Math.max(min, Math.min(max, Math.round(Number(raw)))) : null);

/** Memory settings from a saved state or a PATCH /api/settings, field by field; anything invalid keeps `base`. */
export function memorySettings(base: MemorySettings, patch: unknown): MemorySettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof MemorySettings, unknown>>;
  const est = (p.estimates && typeof p.estimates === 'object' ? p.estimates : {}) as Record<string, unknown>;
  const sessionMax = mb(p.sessionMaxMb, 0, 262_144);
  return {
    headroomMb: mb(p.headroomMb, 0, 65_536) ?? base.headroomMb,
    sessionMaxMb: sessionMax === null ? base.sessionMaxMb : sessionMax && Math.max(512, sessionMax),
    estimates: Object.fromEntries(KINDS.map((k) => [k, mb(est[k], 128, 65_536) ?? base.estimates[k]]).filter(([, v]) => v)),
  };
}

/** One reading of this computer's memory: /proc/meminfo on Linux, os.freemem elsewhere (no swap there). */
export interface MemoryReading {
  availableMb: number;
  totalMb: number;
  swapFreeMb: number;
  swapTotalMb: number;
  load: number | null; // the 1-minute load average; null where the OS has none (Windows)
  cpus: number;
  at: number;
}

export interface HealthView {
  memory: MemoryReading | null; // null until the first reading
  running: number; // agent sessions running
  waiting: number; // agents whose stopped session waits for memory to resume
  held: string | null; // why new work waits now, e.g. "Waiting for memory: …"
  lastStop: { agent: string; why: string; at: number } | null; // the latest session the office lost to memory
}

export const gb = (mbs: number) => `${(Math.max(0, mbs) / 1024).toFixed(1)} GB`;
