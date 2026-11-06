// The office's health (#55): memory, swap and load, sessions running and waiting, and the memory settings, for the
// health strip in the manager's console and pocket mode. The server's side (readings, admission, stops and retries) is
// server/health.ts.

/** What a session is for: each kind has its own memory estimate. The test lab's (#56): a browser job, a heavy command. */
export type SessionKind = 'build' | 'fix' | 'qa' | 'preview' | 'ceo' | 'consult' | 'labBrowser' | 'labRun';

export interface MemorySettings {
  headroomMb: number; // kept free for the system: new work waits rather than eat into it
  sessionMaxMb: number; // most one agent's processes may use before the office stops them (Linux); 0 = no ceiling
  estimates: Partial<Record<SessionKind, number>>; // learned from past sessions' peak memory, MB
  alertAfterMin: number; // work that has waited this long for memory pings the manager's devices (#115)
}

/** Before any session has been measured. */
export const DEFAULT_ESTIMATES: Record<SessionKind, number> = { build: 1536, fix: 1536, qa: 1536, preview: 512, ceo: 512, consult: 1024, labBrowser: 512, labRun: 1536 };
export const DEFAULT_MEMORY: MemorySettings = { headroomMb: 1536, sessionMaxMb: 4096, estimates: {}, alertAfterMin: 15 };

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
    alertAfterMin: mb(p.alertAfterMin, 1, 1440) ?? base.alertAfterMin ?? DEFAULT_MEMORY.alertAfterMin,
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
  heldWork: HeldWork | null; // the same wait, counted, for the in-app note (#115)
  lastStop: { agent: string; why: string; at: number } | null; // the latest session the office lost to memory
}

/** Work waiting for memory: how many tasks, what's free and what the smallest of them needs (its estimate + headroom). */
export interface HeldWork {
  tasks: number;
  freeMb: number;
  needMb: number;
}

export const gb = (mbs: number) => `${(Math.max(0, mbs) / 1024).toFixed(1)} GB`;

/** The quiet in-app note while work waits for memory (no push, no sound): "⏳ 2 tasks waiting for memory · …". */
export function heldNote(h: HeldWork | null | undefined): string | null {
  if (!h) return null;
  return `⏳ ${h.tasks} ${h.tasks === 1 ? 'task' : 'tasks'} waiting for memory · ${gb(h.freeMb)} free, ${gb(h.needMb)} needed`;
}
