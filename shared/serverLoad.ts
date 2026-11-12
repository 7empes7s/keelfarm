// How much of the server is used and by which programs (#271): the latest reading (memory, swap, load, disk and each
// program's memory and CPU), a 24 h trend of 1-minute points (in memory, on disk every 10 minutes), and the pure rules both
// sides share. The server samples it (server/serverLoad.ts); the chat's `server:*` sources and Mission control's
// Server card draw it (client/src/ui/chatVisualSources.ts, ServerCard.tsx). Only program names leave the server,
// never command lines.

/** What a program is: an agent's CLI session, a test browser, a demo office or test runner, a preview, the office itself. */
export type ProgramKind = 'agent' | 'browser' | 'runner' | 'preview' | 'office' | 'db' | 'other';

export interface ProgramUse {
  kind: ProgramKind;
  name: string; // "Claude Code · Ada", "Test browser · Ada", "Preview · floor 2 PR #13"
  agentId?: string;
  previewKey?: string;
  ref?: string; // a chat ref to what uses it ("@Ada", "preview: floor 2 #13")
  rssMb: number;
  cpuPct: number; // of one core, since the last reading
  procs: number;
}

/** A process left in an agent's worktree after their session ended (#227): flagged with "Stop it". */
export interface OrphanUse {
  pid: number;
  name: string; // the program's name only (comm), never its command line
  agentId?: string;
  agent?: string;
  rssMb: number; // with what it started that is orphaned too
}

export interface DiskUse {
  label: string;
  totalMb: number;
  freeMb: number;
}

/** One reading of the server. `measured` is false where programs can't be told apart (not Linux). */
export interface ServerNow {
  at: number;
  cpus: number;
  load: number | null; // 1-minute load average; null on Windows
  cpuPct: number | null; // the whole machine's busy share since the last reading, 0-100
  totalMb: number;
  availableMb: number;
  swapTotalMb: number;
  swapFreeMb: number;
  disks: DiskUse[];
  programs: ProgramUse[]; // biggest first
  orphans: OrphanUse[];
  measured: boolean;
}

/** A point of the 24 h trend, in percent: memory used, swap used, load against the cores. */
export interface ServerPoint {
  at: number;
  memPct: number;
  swapPct: number;
  loadPct: number | null;
}

export const SAMPLE_MS = 15_000;
export const POINT_MS = 60_000;
export const TREND_MS = 24 * 3_600_000;
/** How often the trend is written to disk, so a restart keeps the day (#587). */
export const SAVE_MS = 10 * 60_000;
/** Programs in a reading at most; smaller ones are summed into Other (keeps the snapshot small in a big company). */
const MAX_PROGRAMS = 24;
export const MAX_ORPHANS = 10;

export const KIND_LABELS: Record<ProgramKind, string> = {
  agent: 'Agent sessions',
  browser: 'Test browsers',
  runner: 'Demo offices & tests',
  preview: 'Previews',
  office: 'This office',
  db: 'Postgres & Docker',
  other: 'Other',
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
export const memUsedMb = (n: ServerNow) => Math.max(0, n.totalMb - n.availableMb);
export const swapUsedMb = (n: ServerNow) => Math.max(0, n.swapTotalMb - n.swapFreeMb);
export const memPct = (n: ServerNow) => pct(memUsedMb(n), n.totalMb);
export const swapPct = (n: ServerNow) => pct(swapUsedMb(n), n.swapTotalMb);
/** The load average against the cores, in percent (100 = every core busy). */
export const loadPct = (n: Pick<ServerNow, 'load' | 'cpus'>) => (n.load === null ? null : pct(n.load, n.cpus || 1));

export const pointOf = (n: ServerNow): ServerPoint => ({ at: n.at, memPct: memPct(n), swapPct: swapPct(n), loadPct: loadPct(n) });

/** The trend with a new point: at most one a minute, nothing older than 24 h. */
export function addPoint(trend: readonly ServerPoint[], p: ServerPoint): ServerPoint[] {
  const last = trend[trend.length - 1];
  const kept = trend.filter((x) => x.at > p.at - TREND_MS);
  return last && p.at - last.at < POINT_MS ? kept : [...kept, p];
}

/** The trend read back from disk: well-formed points of the last 24 h, oldest first; [] for anything else. */
export function keptTrend(raw: unknown, now: number): ServerPoint[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  return raw
    .filter((p): p is ServerPoint => !!p && num(p.at) && num(p.memPct) && num(p.swapPct) && (p.loadPct === null || num(p.loadPct)) && p.at > now - TREND_MS && p.at <= now)
    .map(({ at, memPct, swapPct, loadPct }) => ({ at, memPct, swapPct, loadPct }))
    .sort((a, b) => a.at - b.at);
}

/** The trend in buckets of `bucketMs` (each bucket's average), oldest first, so a phone draws a day in ~144 points. */
export function bucketTrend(trend: readonly ServerPoint[], bucketMs: number): ServerPoint[] {
  const out: ServerPoint[] = [];
  let group: ServerPoint[] = [];
  const flush = () => {
    if (!group.length) return;
    const avg = (f: (p: ServerPoint) => number | null) => {
      const vals = group.map(f).filter((v): v is number => v !== null);
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    };
    out.push({ at: group[group.length - 1].at, memPct: avg((p) => p.memPct) ?? 0, swapPct: avg((p) => p.swapPct) ?? 0, loadPct: avg((p) => p.loadPct) });
    group = [];
  };
  for (const p of trend) {
    if (group.length && Math.floor(p.at / bucketMs) !== Math.floor(group[0].at / bucketMs)) flush();
    group.push(p);
  }
  flush();
  return out;
}

/** Memory by kind of program, biggest first, with what no program accounts for (the kernel's caches, other users) left out. */
export function byKind(programs: readonly ProgramUse[]): { kind: ProgramKind; rssMb: number }[] {
  const sums = new Map<ProgramKind, number>();
  for (const p of programs) sums.set(p.kind, (sums.get(p.kind) ?? 0) + p.rssMb);
  return [...sums].map(([kind, rssMb]) => ({ kind, rssMb: Math.round(rssMb) })).sort((a, b) => b.rssMb - a.rssMb);
}

/** Memory and CPU per agent (their session, browsers and test runners together), biggest first. */
export function byAgent(programs: readonly ProgramUse[]): { agentId: string; name: string; ref: string | undefined; rssMb: number; cpuPct: number }[] {
  const out = new Map<string, { agentId: string; name: string; ref: string | undefined; rssMb: number; cpuPct: number }>();
  for (const p of programs) {
    if (!p.agentId) continue;
    const a = out.get(p.agentId) ?? { agentId: p.agentId, name: p.name.split(' · ').pop()!, ref: p.ref, rssMb: 0, cpuPct: 0 };
    a.rssMb += p.rssMb;
    a.cpuPct += p.cpuPct;
    out.set(p.agentId, a);
  }
  return [...out.values()].map((a) => ({ ...a, rssMb: Math.round(a.rssMb), cpuPct: Math.round(a.cpuPct) })).sort((a, b) => b.rssMb - a.rssMb);
}

/** The biggest programs, the rest summed into one "Other" (which also takes the readings' own Other). */
export function capPrograms(programs: readonly ProgramUse[], max = MAX_PROGRAMS): ProgramUse[] {
  const sorted = [...programs].sort((a, b) => b.rssMb - a.rssMb);
  const rest = sorted.filter((p, i) => p.kind === 'other' || i >= max - 1);
  const kept = sorted.filter((p) => !rest.includes(p));
  if (!rest.length) return kept;
  const other: ProgramUse = { kind: 'other', name: 'Other', rssMb: 0, cpuPct: 0, procs: 0 };
  for (const p of rest) {
    other.rssMb += p.rssMb;
    other.cpuPct += p.cpuPct;
    other.procs += p.procs;
  }
  return [...kept, { ...other, rssMb: Math.round(other.rssMb), cpuPct: Math.round(other.cpuPct * 10) / 10 }];
}
