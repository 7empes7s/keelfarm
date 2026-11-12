// The server's load by program (#271, shared/serverLoad.ts): every 15 s, memory, swap, load and disk, and each
// process's memory and CPU from /proc, grouped into programs: an agent's CLI session, the test browsers and demo
// offices or test runners they started, previews, this office, Postgres/Docker, the rest. A 24 h trend of 1-minute
// points stays in memory, kept in its own file every 10 minutes for the next start (#587). Linux reads /proc; elsewhere only memory, load and disk.
// Pure parsing and grouping first, then the readings, then ServerLoad, which the Swarm drives.
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addPoint, capPrograms, keptTrend, MAX_ORPHANS, pointOf, SAVE_MS, type DiskUse, type OrphanUse, type ProgramUse, type ServerNow, type ServerPoint } from '../shared/serverLoad.ts';
import { HOME_DIR } from './config.ts';
import { HttpError } from './httpError.ts';
import { kill, killPlan, orphans, type Proc } from './procSweep.ts';

// ---------- parsing ----------

const PAGE_KB = 4; // Linux's page on x86-64 and arm64
const CLK_TCK = 100; // USER_HZ: /proc's ticks per second

/** /proc/meminfo, in MB. */
export function parseMeminfo(text: string): { totalMb: number; availableMb: number; swapTotalMb: number; swapFreeMb: number } | null {
  const mb = (key: string) => Math.round(Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? NaN) / 1024);
  const totalMb = mb('MemTotal');
  const availableMb = mb('MemAvailable');
  if (!Number.isFinite(totalMb) || !Number.isFinite(availableMb)) return null;
  return { totalMb, availableMb, swapTotalMb: mb('SwapTotal') || 0, swapFreeMb: mb('SwapFree') || 0 };
}

/** /proc/loadavg's 1-minute load. */
export function parseLoadavg(text: string): number | null {
  const n = Number(text.trim().split(/\s+/)[0]);
  return text.trim() && Number.isFinite(n) ? n : null;
}

/** /proc/stat's first line: the machine's busy and total ticks. */
export function parseCpuTicks(text: string): { busy: number; total: number } | null {
  const m = text.match(/^cpu\s+([\d\s]+)$/m);
  if (!m) return null;
  const v = m[1].trim().split(/\s+/).map(Number);
  const total = v.reduce((a, b) => a + b, 0);
  const idle = (v[3] ?? 0) + (v[4] ?? 0); // idle + iowait
  return { busy: total - idle, total };
}

/** A /proc/<pid>/stat line: its name (comm), parent, group, CPU ticks, start time and resident memory. */
export interface ProcStat {
  pid: number;
  comm: string;
  ppid: number;
  pgid: number;
  ticks: number; // utime + stime
  start: number; // starttime, to tell a reused pid apart
  rssMb: number;
}

export function parseStat(line: string): ProcStat | null {
  const open = line.indexOf('(');
  const close = line.lastIndexOf(')'); // a name may itself hold ") "
  if (open < 0 || close < open) return null;
  const f = line.slice(close + 2).trim().split(/\s+/);
  const pid = Number(line.slice(0, open));
  if (!Number.isInteger(pid) || f.length < 22) return null;
  return { pid, comm: line.slice(open + 1, close), ppid: Number(f[1]), pgid: Number(f[2]), ticks: Number(f[11]) + Number(f[12]), start: Number(f[19]), rssMb: (Number(f[21]) * PAGE_KB) / 1024 };
}

/** Each process's CPU share of one core since the previous reading (`dtMs` ago); a new or reused pid counts from now. */
export function cpuShares(now: readonly ProcStat[], prev: ReadonlyMap<number, { ticks: number; start: number }>, dtMs: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of now) {
    const was = prev.get(p.pid);
    const d = was && was.start === p.start && dtMs > 0 ? p.ticks - was.ticks : 0;
    out.set(p.pid, Math.max(0, Math.round(((d / CLK_TCK) / (dtMs / 1000)) * 1000) / 10));
  }
  return out;
}

// ---------- grouping ----------

/** A process as grouping reads it. */
export interface ProcRow {
  pid: number;
  ppid: number;
  pgid: number;
  comm: string;
  rssMb: number;
  cpuPct: number;
  cwd: string | null;
}

/** Who's who on this computer, from the office's side. */
export interface LoadContext {
  /** The office's own processes (itself, its launcher, the terminal keeper). */
  officePids: number[];
  /** Where agents' machines are: `<machinesDir>/<machine>/work/<repo>` (orphans are found there). */
  machinesDir: string;
  /** Each agent's folders (their machine; the CEO's folder), and whether a session of theirs is live. */
  agents: { id: string; name: string; machine: string | null; dirs: string[]; live: boolean }[];
  /** The previews running, their desk folders, names and chat refs. */
  previews: { key: string; dir: string; name: string; ref: string | null }[];
}

const BROWSER = /^(chrome|chromium|headless_shell|chrome_crashpad|msedge|firefox)/i;
const DB = /^(postgres|dockerd|containerd|docker-proxy|docker)/i;
const SHELL = /^(bash|sh|dash|zsh|fish)$/;
const CLI_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };

const inside = (dir: string, p: string) => {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

type Owner = { agent: LoadContext['agents'][number] } | { preview: LoadContext['previews'][number] } | 'office' | null;

/**
 * Processes as programs. A process belongs to the agent or preview whose folder it works in, else to the nearest
 * ancestor (then its process group's leader) that belongs to one, else to the office when it runs under the office.
 * An agent's processes split into their CLI session (the CLI and what it starts directly: MCP servers), test browsers,
 * and the demo offices and test runners started through a shell.
 */
export function groupPrograms(procs: readonly ProcRow[], ctx: LoadContext): ProgramUse[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const office = new Set(ctx.officePids);
  const memo = new Map<number, Owner>();
  const direct = (p: ProcRow): Owner | undefined => {
    if (office.has(p.pid)) return 'office';
    if (!p.cwd) return undefined;
    const preview = ctx.previews.find((v) => inside(v.dir, p.cwd!));
    if (preview) return { preview };
    const agent = ctx.agents.find((a) => a.dirs.some((d) => inside(d, p.cwd!)));
    return agent ? { agent } : undefined;
  };
  const ownerOf = (p: ProcRow): Owner => {
    if (memo.has(p.pid)) return memo.get(p.pid)!;
    let owner: Owner = null;
    const seen = new Set<number>();
    for (let q: ProcRow | undefined = p; q && !seen.has(q.pid); q = byPid.get(q.ppid)) {
      seen.add(q.pid);
      const d = memo.has(q.pid) ? memo.get(q.pid) : direct(q);
      if (d !== undefined && d !== null) {
        owner = d;
        break;
      }
    }
    if (owner === null && p.pgid !== p.pid && byPid.has(p.pgid)) owner = direct(byPid.get(p.pgid)!) ?? null;
    memo.set(p.pid, owner);
    return owner;
  };
  /** The CLI an agent's process belongs to: itself, or reached up its parents with no shell between. */
  const cliOf = (p: ProcRow): string | null => {
    for (let q: ProcRow | undefined = p, i = 0; q && i < 32; q = byPid.get(q.ppid), i++) {
      if (CLI_NAMES[q.comm]) return CLI_NAMES[q.comm];
      if (SHELL.test(q.comm)) return null;
    }
    return null;
  };

  const out = new Map<string, ProgramUse>();
  const add = (key: string, base: Omit<ProgramUse, 'rssMb' | 'cpuPct' | 'procs'>, p: ProcRow) => {
    const g = out.get(key) ?? { ...base, rssMb: 0, cpuPct: 0, procs: 0 };
    g.rssMb += p.rssMb;
    g.cpuPct += p.cpuPct;
    g.procs++;
    if (base.kind === 'agent' && base.name !== g.name && g.name.startsWith('Agent session')) g.name = base.name;
    out.set(key, g);
  };
  for (const p of procs) {
    const owner = ownerOf(p);
    const browser = BROWSER.test(p.comm);
    if (owner && typeof owner === 'object' && 'agent' in owner) {
      const a = owner.agent;
      const who = { agentId: a.id, ref: `@${a.name}` };
      const cli = browser ? null : cliOf(p);
      if (browser) add(`browser:${a.id}`, { kind: 'browser', name: `Test browser · ${a.name}`, ...who }, p);
      else if (cli) add(`agent:${a.id}`, { kind: 'agent', name: `${cli} · ${a.name}`, ...who }, p);
      else add(`runner:${a.id}`, { kind: 'runner', name: `Demo office & tests · ${a.name}`, ...who }, p);
    } else if (owner && typeof owner === 'object') {
      const v = owner.preview;
      add(`preview:${v.key}`, { kind: browser ? 'browser' : 'preview', name: v.name, previewKey: v.key, ...(v.ref && { ref: v.ref }) }, p);
    } else if (browser && owner === 'office') add('browser:lab', { kind: 'browser', name: 'Test lab browser' }, p);
    else if (owner === 'office') add('office', { kind: 'office', name: 'This office' }, p);
    else if (DB.test(p.comm)) add('db', { kind: 'db', name: 'Postgres & Docker' }, p);
    else add('other', { kind: 'other', name: 'Other' }, p);
  }
  return [...out.values()].map((g) => ({ ...g, rssMb: Math.round(g.rssMb), cpuPct: Math.round(g.cpuPct * 10) / 10 }));
}

/** Processes left in machines' worktrees with no live session (procSweep's rule), one per tree: what "Stop it" stops. */
export function orphanUses(procs: readonly ProcRow[], ctx: LoadContext): OrphanUse[] {
  const picks = orphanPicks(procs, ctx);
  const pickSet = new Set(picks.map((p) => p.pid));
  const machineOf = (cwd: string) => path.relative(ctx.machinesDir, cwd).split(/[\\/]/)[0];
  const tops = picks.filter((p) => !pickSet.has(p.ppid));
  return tops
    .map((t) => {
      const agent = ctx.agents.find((a) => a.machine === machineOf(t.cwd!));
      const tree = treeOf(t.pid, picks);
      return { pid: t.pid, name: t.comm, ...(agent && { agentId: agent.id, agent: agent.name }), rssMb: Math.round(tree.reduce((n, p) => n + p.rssMb, 0)) };
    })
    .sort((a, b) => b.rssMb - a.rssMb)
    .slice(0, MAX_ORPHANS);
}

const asProc = (p: ProcRow): Proc => ({ pid: p.pid, ppid: p.ppid, pgid: p.pgid, cwd: p.cwd, ports: [] });

function orphanPicks(procs: readonly ProcRow[], ctx: LoadContext): ProcRow[] {
  const live = ctx.agents.filter((a) => a.live && a.machine).map((a) => a.machine!);
  const picked = new Set(orphans(procs.map(asProc), ctx.machinesDir, live, [], ctx.officePids).map((p) => p.pid));
  return procs.filter((p) => picked.has(p.pid));
}

/** `pid` and every pick below it. */
function treeOf<T extends { pid: number; ppid: number }>(pid: number, picks: readonly T[]): T[] {
  const out = picks.filter((p) => p.pid === pid);
  for (let i = 0; i < out.length; i++) out.push(...picks.filter((p) => p.ppid === out[i].pid));
  return out;
}

// ---------- readings ----------

/** Readings carried from one sample to the next, for CPU shares. */
export interface LoadMemo {
  at: number;
  cpu: { busy: number; total: number } | null;
  procs: Map<number, { ticks: number; start: number }>;
}

async function readDisks(dirs: { label: string; dir: string }[]): Promise<DiskUse[]> {
  const out: (DiskUse & { key: string })[] = [];
  for (const d of dirs) {
    const s = await fs.statfs(d.dir).catch(() => null);
    if (!s) continue;
    const mb = (blocks: number) => Math.round((blocks * s.bsize) / 1024 / 1024);
    const key = `${s.blocks}:${s.bsize}`; // the same file system twice shows once
    if (!out.some((x) => x.key === key)) out.push({ key, label: d.label, totalMb: mb(s.blocks), freeMb: mb(s.bavail) });
  }
  return out.map(({ key: _key, ...d }) => d);
}

async function readProcRows(memo: LoadMemo, now: number): Promise<{ rows: ProcRow[]; procs: LoadMemo['procs'] }> {
  const pids = (await fs.readdir('/proc').catch(() => [] as string[])).filter((n) => /^\d+$/.test(n));
  const stats = (await Promise.all(pids.map((pid) => fs.readFile(`/proc/${pid}/stat`, 'utf8').then(parseStat, () => null)))).filter((s): s is ProcStat => !!s);
  const cpu = cpuShares(stats, memo.procs, memo.at ? now - memo.at : 0);
  const rows = await Promise.all(
    stats.map(async (s): Promise<ProcRow> => ({ pid: s.pid, ppid: s.ppid, pgid: s.pgid, comm: s.comm, rssMb: s.rssMb, cpuPct: cpu.get(s.pid) ?? 0, cwd: await fs.readlink(`/proc/${s.pid}/cwd`).catch(() => null) })),
  );
  return { rows, procs: new Map(stats.map((s) => [s.pid, { ticks: s.ticks, start: s.start }])) };
}

/** One reading of the server (`memo` is updated for the next one's CPU shares). */
async function readServer(ctx: LoadContext, memo: LoadMemo, disks: { label: string; dir: string }[]): Promise<ServerNow> {
  const at = Date.now();
  const cpus = os.cpus().length || 1;
  const linux = process.platform === 'linux';
  const [meminfo, loadavg, stat] = linux ? await Promise.all(['/proc/meminfo', '/proc/loadavg', '/proc/stat'].map((f) => fs.readFile(f, 'utf8').catch(() => ''))) : ['', '', ''];
  const mem = parseMeminfo(meminfo) ?? { totalMb: Math.round(os.totalmem() / 1048576), availableMb: Math.round(os.freemem() / 1048576), swapTotalMb: 0, swapFreeMb: 0 };
  const ticks = parseCpuTicks(stat);
  const cpuPct = ticks && memo.cpu && ticks.total > memo.cpu.total ? Math.round(((ticks.busy - memo.cpu.busy) / (ticks.total - memo.cpu.total)) * 1000) / 10 : null;
  const { rows, procs } = linux ? await readProcRows(memo, at) : { rows: [], procs: new Map() };
  Object.assign(memo, { at, cpu: ticks, procs });
  return {
    at,
    cpus,
    load: process.platform === 'win32' ? null : (parseLoadavg(loadavg) ?? os.loadavg()[0]),
    cpuPct,
    ...mem,
    disks: await readDisks(disks),
    programs: capPrograms(groupPrograms(rows, ctx)),
    orphans: orphanUses(rows, ctx),
    measured: linux,
  };
}

/** Stop an orphan and what it started, by pid only, after checking it's still one (never by name). */
async function stopOrphanTree(pid: number, ctx: LoadContext): Promise<void> {
  if (process.platform !== 'linux') throw new HttpError(404, 'Processes can only be told apart on Linux.');
  const { rows } = await readProcRows({ at: 0, cpu: null, procs: new Map() }, Date.now());
  const picks = orphanPicks(rows, ctx);
  if (!picks.some((p) => p.pid === pid)) throw new HttpError(409, `Process ${pid} is gone or no longer left over from an ended session.`);
  kill(killPlan(treeOf(pid, picks).map(asProc), rows.map(asProc), ctx.officePids));
}

// ---------- the office's side ----------

export interface LoadHost {
  read(ctx: LoadContext): Promise<ServerNow>;
  /** Points from before this office started (the real one's from disk, the demo's made-up day). */
  seed(): ServerPoint[];
  context(): LoadContext;
  emit(now: ServerNow): void;
  /** Keeps the trend for the next start (every SAVE_MS); the demo keeps nothing. */
  save?(points: ServerPoint[]): void;
}

export class ServerLoad {
  private latest: ServerNow | null = null;
  private trend: ServerPoint[];
  private reading = false;
  private savedAt = 0;

  constructor(private host: LoadHost) {
    this.trend = host.seed();
  }

  /** Read the server once: the latest reading out to the tabs, a point into the trend once a minute. */
  async tick() {
    if (this.reading) return;
    this.reading = true;
    try {
      this.latest = await this.host.read(this.host.context());
      this.trend = addPoint(this.trend, pointOf(this.latest));
      if (this.host.save && this.latest.at - this.savedAt >= SAVE_MS) {
        this.savedAt = this.latest.at;
        this.host.save(this.trend);
      }
      this.host.emit(this.latest);
    } catch (err) {
      console.warn('server load: could not read', err);
    } finally {
      this.reading = false;
    }
  }

  view(): ServerNow | null {
    return this.latest;
  }

  points(): ServerPoint[] {
    return this.trend;
  }
}

const memo: LoadMemo = { at: 0, cpu: null, procs: new Map() };
const TREND_FILE = path.join(HOME_DIR, 'server-trend.json');

/** The day's trend from before a restart (#587), so the chart isn't empty after every update. */
function readTrend(): ServerPoint[] {
  try {
    return keptTrend(JSON.parse(fsSync.readFileSync(TREND_FILE, 'utf8')), Date.now());
  } catch {
    return []; // none yet, or unreadable: start a new day
  }
}

function saveTrend(points: ServerPoint[]) {
  const tmp = `${TREND_FILE}.tmp`;
  void fs
    .writeFile(tmp, JSON.stringify(points))
    .then(() => fs.rename(tmp, TREND_FILE))
    .catch((err) => console.warn('server load: could not keep the trend', err));
}

/** This computer's readings, for the ResourceProbe (health.ts): the system disk and the office's data folder. */
export const realLoad = {
  server: (ctx: LoadContext) => readServer(ctx, memo, [{ label: 'System disk', dir: path.parse(HOME_DIR).root }, { label: 'Office data', dir: HOME_DIR }]),
  stopOrphan: stopOrphanTree,
  serverSeed: readTrend,
  serverSave: saveTrend,
};
