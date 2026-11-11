// Resource safety (#55): the office never takes its computer down. Before a session starts, free memory and swap are
// checked against what that kind of session needs (learned from past peaks): work that doesn't fit waits in the queue,
// with the reason on the health strip. On Linux each agent's processes are measured through /proc (by the folder they
// work in): one over the per-session ceiling, or the biggest when memory is about to run out, is stopped. A session
// killed that way, by the OS or by its terminal keeper dying resumes once memory is back, up to twice, and then its work
// goes back to the queue. Elsewhere only admission runs (os.freemem). Waits show as a quiet note in the office; the
// manager's devices ring only after a long wait, with stops grouped, at most hourly, and at once when work is requeued
// (#115). The office's previews are measured too (#204): under memory pressure an idle one (nobody watching, no agent
// using it) stops before any agent session is stopped or refused. Pure rules first, then the readings, then
// OfficeHealth, which the Swarm drives.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { browserNote, DEFAULT_ESTIMATES, gb, type HealthView, type HeldWork, type MemoryReading, type MemorySettings, type SessionKind } from '../shared/health.ts';
import { diskAlert, diskHold, diskLevel, DISK_HELD_KINDS, diskWarning, uniqueDisks, worstLevel, type CleanResult, type DiskAlertMark, type DiskReading, type DiskSettings, type DiskView } from '../shared/disk.ts';
import type { ServerNow, ServerPoint } from '../shared/serverLoad.ts';
import { HttpError } from './httpError.ts';
import { realLoad, type LoadContext } from './serverLoad.ts';

export { DEFAULT_MEMORY, memorySettings, type SessionKind } from '../shared/health.ts';

// ---------- rules ----------

/** A just-started session that can't be measured is taken to grow to its estimate within this long. */
const WARMUP_MS = 3 * 60_000;
/** A killed session resumes at most this many times in a row before its work goes back to the queue. */
export const KILL_RETRIES = 2;
/** Memory pings (a long wait, the stopped sessions' digest) at most this often: on a small box waits come and go all day. */
export const MEMORY_PING_GAP_MS = 3_600_000;
/** The demo's wait pings after this long instead of Settings' minutes, so Simulate low memory shows it. */
const DEMO_ALERT_MS = 20_000;
const HELPS = 'To help: fewer agents on a floor, or a lower "Memory kept free" in Settings → Office.';

/** What kind of session an agent runs on their task. */
export function sessionKind(a: { role: string; task: string | null }): SessionKind {
  return a.role === 'ceo' ? 'ceo' : a.task === 'qa' ? 'qa' : a.task === 'fix' ? 'fix' : 'build';
}

/** What running sessions are still expected to grow by: their estimate less what they use now (unmeasured: while young). */
export function reservedMb(sessions: { kind: SessionKind; rssMb: number | null; ageMs: number }[], estimate: (k: SessionKind) => number): number {
  return sessions.reduce((n, s) => n + (s.rssMb !== null ? Math.max(0, estimate(s.kind) - s.rssMb) : s.ageMs < WARMUP_MS ? estimate(s.kind) : 0), 0);
}

/** What's free for a new session (memory and swap less what running ones will still grow by), and what one needs. */
function memoryFit(x: { memory: MemoryReading; estimateMb: number; headroomMb: number; reservedMb: number }): { freeMb: number; needMb: number } {
  return { freeMb: x.memory.availableMb + x.memory.swapFreeMb - x.reservedMb, needMb: x.estimateMb + x.headroomMb };
}

/**
 * Why a session of `kind` can't start now (null: it can). The CEO always can: its jobs are small and steer everyone.
 * `browserMb`: what the test lab's browser uses now, named in the reason (#301).
 */
export function admission(x: { kind: SessionKind; memory: MemoryReading | null; estimateMb: number; headroomMb: number; reservedMb: number; browserMb?: number | null }): string | null {
  if (x.kind === 'ceo' || !x.memory) return null;
  const { freeMb: free, needMb } = memoryFit({ ...x, memory: x.memory });
  if (free >= needMb) return null;
  return `Waiting for memory: ${gb(free)} free${x.reservedMb > 0 ? ' once running sessions grow' : ''}, a ${x.kind} session needs about ${gb(x.estimateMb)} and ${gb(x.headroomMb)} stays free.${browserNote(x.browserMb) && ` Of what's used, ${browserNote(x.browserMb)}.`}`;
}

/** A kind's next estimate after one of its sessions peaked at `peakMb`: quick to grow, slow to shrink. */
export function learnEstimate(prevMb: number, peakMb: number): number {
  if (!(peakMb > 0)) return prevMb;
  const next = peakMb > prevMb ? prevMb + (peakMb - prevMb) / 2 : prevMb * 0.9 + peakMb * 0.1;
  return Math.round(Math.max(256, Math.min(32_768, next)));
}

/** A session that ended because something killed it: the OOM killer or a SIGKILL (137), or its terminal keeper dying (-1). */
export function sessionKilled(errors: string[]): boolean {
  return /exited with code (-1|137)\b|SIGKILL/.test(errors.join('\n'));
}

/** After a killed session: resume it (its CLI picks the conversation back up), or put its work back in the queue. */
export function killRetry(retries: number, resumable: boolean): 'resume' | 'requeue' {
  return resumable && retries < KILL_RETRIES ? 'resume' : 'requeue';
}

/** The session to stop: one over the ceiling, else the biggest when memory is about to run out; null: none. */
export function memoryVictim(x: { memory: MemoryReading; headroomMb: number; sessionMaxMb: number; sessions: { id: string; rssMb: number }[] }): { id: string; why: string } | null {
  const over = x.sessionMaxMb > 0 ? x.sessions.find((s) => s.rssMb > x.sessionMaxMb) : undefined;
  if (over) return { id: over.id, why: `its processes used ${gb(over.rssMb)}, over the ${gb(x.sessionMaxMb)} a session may use` };
  const free = x.memory.availableMb + x.memory.swapFreeMb;
  const biggest = [...x.sessions].sort((p, q) => q.rssMb - p.rssMb)[0];
  if (!biggest || free >= x.headroomMb / 2) return null;
  return { id: biggest.id, why: `the server was running out of memory (${gb(free)} left) and its processes used the most (${gb(biggest.rssMb)})` };
}

/** The preview to stop for memory: the biggest one nobody watches and no agent uses; null when none is idle. */
export function idlePreview(previews: { key: string; rssMb: number; idle: boolean }[]): string | null {
  return [...previews].filter((p) => p.idle).sort((a, b) => b.rssMb - a.rssMb)[0]?.key ?? null;
}

/**
 * What to stop for memory: a session over the ceiling stays that session's problem; when memory is about to run out, an
 * idle preview goes before the biggest session. Null: nothing has to go.
 */
export function memoryRelief(x: Parameters<typeof memoryVictim>[0] & { previews: { key: string; rssMb: number; idle: boolean }[] }): { preview: string } | { session: { id: string; why: string } } | null {
  const over = x.sessionMaxMb > 0 && x.sessions.some((s) => s.rssMb > x.sessionMaxMb);
  const preview = idlePreview(x.previews);
  if (!over && preview && x.memory.availableMb + x.memory.swapFreeMb < x.headroomMb / 2) return { preview };
  const session = memoryVictim(x);
  return session ? { session } : null;
}

/** Ping about work waiting for memory? Only once it has waited `delayMs`, once per wait, and at most once an hour. */
export function heldPing(x: { since: number; told: boolean; now: number; delayMs: number; lastPingAt: number | null }): boolean {
  return !x.told && x.now - x.since >= x.delayMs && (x.lastPingAt === null || x.now - x.lastPingAt >= MEMORY_PING_GAP_MS);
}

/** That ping's words: what's happening, that it needs nothing, and what helps. */
export function heldMessage(h: HeldWork, waitedMs: number): { title: string; body: string } {
  const min = Math.max(1, Math.round(waitedMs / 60_000));
  return {
    title: `Work has waited ${min} min for memory`,
    body: `${h.tasks} ${h.tasks === 1 ? 'task waits' : 'tasks wait'}: ${gb(h.freeMb)} free, ${gb(h.needMb)} needed${browserNote(h.browserMb) && ` (${browserNote(h.browserMb)})`}. Nothing to do: it starts by itself once memory frees up. ${HELPS}`,
  };
}

/** The digest of sessions stopped for memory that resume by themselves: at most one an hour; null: nothing to send yet. */
export function stopDigest(names: string[], now: number, lastPingAt: number | null): { title: string; body: string } | null {
  if (!names.length || (lastPingAt !== null && now - lastPingAt < MEMORY_PING_GAP_MS)) return null;
  const who = [...new Set(names)];
  const one = names.length === 1;
  return {
    title: one ? `${who[0]}'s session was stopped to free memory and will resume` : `${names.length} sessions were stopped to free memory and will resume`,
    body: `${one ? '' : `${who.join(', ')}. `}Nothing to do: ${one ? 'it resumes' : 'they resume'} by ${one ? 'itself' : 'themselves'} once memory is back. ${HELPS}`,
  };
}

/** A killed session's work that went back to the queue loses that session's progress: this one pings at once. */
export function requeueMessage(name: string, why: string, next: string): { title: string; body: string } {
  return { title: `${name}'s work went back to the queue`, body: `${why}. ${next} That session's progress is lost: the task starts again from the queue. ${HELPS}` };
}

/** restart_agent's agent, when their task can be restarted; else refused with what the CEO can do instead. */
export function checkRestart<A extends { name: string; role: string; status: string; task: string | null }>(a: A): A {
  if (a.role === 'ceo') throw new Error('That is you: restart_agent restarts the agents on the floors.');
  if (a.status === 'preparing' || a.status === 'working') throw new Error(`${a.name} is working: guide them with message_agent instead.`);
  if (!a.task) throw new Error(`${a.name} has no task to restart: they are free, and the office gives them work from the queue.`);
  return a;
}

// ---------- readings ----------

/** What the processes working in one folder use. */
interface TreeUsage {
  rssMb: number;
  pids: number[];
}

export interface ResourceProbe {
  memory(): Promise<MemoryReading>;
  /** What the processes working in each folder (or below it) use, by folder; empty where the OS can't say (not Linux). */
  usage(dirs: string[]): Promise<Map<string, TreeUsage>>;
  /** Stop those processes at once. */
  kill(pids: number[]): void;
  /** What the test lab's browser uses (its whole process tree), MB; null when it isn't running or can't be measured. */
  browser?(): Promise<number | null>;
  /** The server's load by program (#271, server/serverLoad.ts). */
  server(ctx: LoadContext): Promise<ServerNow>;
  /** Stop a process left over from an ended session, and what it started, by pid (#271). */
  stopOrphan(pid: number, ctx: LoadContext): Promise<void>;
  /** The 24 h trend's points from before the office started: the demo's made-up day; none for the real one. */
  serverSeed(): ServerPoint[];
  /** The demo only: pretend memory is low, or back. */
  simulate?(low: boolean): void;
}

const MB = 1024 * 1024;

async function readMemory(): Promise<MemoryReading> {
  const at = Date.now();
  const cpus = os.cpus().length || 1;
  const load = process.platform === 'win32' ? null : os.loadavg()[0];
  if (process.platform === 'linux') {
    const info = await fs.readFile('/proc/meminfo', 'utf8').catch(() => '');
    const mb = (key: string) => Math.round(Number(info.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? NaN) / 1024);
    if (Number.isFinite(mb('MemAvailable'))) return { availableMb: mb('MemAvailable'), totalMb: mb('MemTotal'), swapFreeMb: mb('SwapFree') || 0, swapTotalMb: mb('SwapTotal') || 0, load, cpus, at };
  }
  return { availableMb: Math.round(os.freemem() / MB), totalMb: Math.round(os.totalmem() / MB), swapFreeMb: 0, swapTotalMb: 0, load, cpus, at };
}

/** Linux: every process whose working folder is one of `dirs` (or below it), with its resident memory, from /proc. */
async function procUsage(dirs: string[]): Promise<Map<string, TreeUsage>> {
  const out = new Map<string, TreeUsage>();
  if (process.platform !== 'linux' || !dirs.length) return out;
  const roots = await Promise.all(dirs.map((d) => fs.realpath(d).catch(() => path.resolve(d))));
  const pids = (await fs.readdir('/proc').catch(() => [] as string[])).filter((n) => /^\d+$/.test(n));
  await Promise.all(
    pids.map(async (pid) => {
      const cwd = await fs.readlink(`/proc/${pid}/cwd`).catch(() => null); // someone else's processes: not ours to read
      const i = cwd ? roots.findIndex((r) => cwd === r || cwd.startsWith(r + path.sep)) : -1;
      if (i < 0) return;
      const status = await fs.readFile(`/proc/${pid}/status`, 'utf8').catch(() => '');
      const u = out.get(dirs[i]) ?? { rssMb: 0, pids: [] };
      u.rssMb += Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) / 1024;
      u.pids.push(Number(pid));
      out.set(dirs[i], u);
    }),
  );
  return out;
}

/** A process as browserTreeMb reads it: its parent, resident memory and (for the office's own children) command line. */
interface ProcInfo {
  pid: number;
  ppid: number;
  rssMb: number;
  cmd: string;
}

/**
 * The lab's browser (#301): the office's own child Playwright launched (it talks over --remote-debugging-pipe) and
 * every process under it (renderers, GPU, utility), summed. Null when there's none.
 */
export function browserTreeMb(procs: readonly ProcInfo[], officePid: number): number | null {
  const kids = new Map<number, ProcInfo[]>();
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);
  const roots = (kids.get(officePid) ?? []).filter((p) => p.cmd.includes('--remote-debugging-pipe'));
  if (!roots.length) return null;
  let mb = 0;
  const stack = [...roots];
  for (let p = stack.pop(); p; p = stack.pop()) {
    mb += p.rssMb;
    stack.push(...(kids.get(p.pid) ?? []));
  }
  return Math.round(mb);
}

/** Linux: browserTreeMb from /proc for this office process; null elsewhere. */
export async function labBrowserMb(officePid = process.pid): Promise<number | null> {
  if (process.platform !== 'linux') return null;
  const pids = (await fs.readdir('/proc').catch(() => [] as string[])).filter((n) => /^\d+$/.test(n));
  const procs = await Promise.all(
    pids.map(async (pid): Promise<ProcInfo | null> => {
      const status = await fs.readFile(`/proc/${pid}/status`, 'utf8').catch(() => '');
      const ppid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] ?? NaN);
      if (!Number.isFinite(ppid)) return null;
      // Only the office's own children need their command line: that's where the browser starts.
      const cmd = ppid === officePid ? (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).replace(/\0/g, ' ') : '';
      return { pid: Number(pid), ppid, rssMb: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) / 1024, cmd };
    }),
  );
  return browserTreeMb(procs.filter((p): p is ProcInfo => !!p), officePid);
}

function killPids(pids: number[]) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone already
    }
  }
}

export const realResources: ResourceProbe = { memory: readMemory, usage: procUsage, kill: killPids, browser: () => labBrowserMb(), ...realLoad };

// ---------- the office's side ----------

/** A session the office runs now: an agent's (their desk folder, where measured) or the CEO's. */
export interface LiveSession {
  id: string;
  kind: SessionKind;
  dir: string | null;
  startedAt: number;
}

export interface HealthHost {
  probe(): Omit<ResourceProbe, 'server' | 'stopOrphan' | 'serverSeed'>; // the server's load is ServerLoad's (#271)
  settings(): MemorySettings;
  sessions(): LiveSession[];
  /** A line in the agent's feed. */
  log(agentId: string, text: string): void;
  /** Ring the manager's devices (Settings → Notifications). */
  alert(title: string, body: string): void;
  emit(view: HealthView): void;
  save(): void;
  /** A killed session's agent, still stopped on their task: resume it, or (requeue) put it back in the queue. */
  retry(agentId: string, why: string, requeue: boolean): void;
  schedule(): void;
  /** The previews being set up or running, their desk folders, and whether they're idle (nobody watching, no agent on it). */
  previews?(): { key: string; dir: string; idle: boolean }[];
  /** Stop an idle preview to free memory. */
  stopPreview?(key: string): void;
  /** What the previews' processes use now, MB (null: not measured). */
  previewMem?(mb: number | null): void;
}

/** The disks the office writes to (#340), plugged in by the office's disk layer (server/swarm/disk.ts). */
export interface DiskHost {
  read(): Promise<DiskReading[]>;
  settings(): DiskSettings;
  alert(title: string, body: string): void;
  lastClean(): CleanResult | null;
  /** The last disk notification, from the state file, and saving a new one (#502). */
  lastAlert(): DiskAlertMark | null;
  setLastAlert(mark: DiskAlertMark | null): void;
}

export class OfficeHealth {
  private disk: DiskHost | null = null;
  private disks: DiskReading[] = [];
  private memory: MemoryReading | null = null;
  private rss = new Map<string, number>(); // agent id → what their processes use now, MB
  private peaks = new Map<string, number>(); // agent id → the most their current session used, MB
  private stopping = new Map<string, string>(); // agent id → why the office stopped their session
  private retries = new Map<string, number>(); // agent id → their killed sessions resumed in a row
  private waiting = new Map<string, { kind: SessionKind; why: string; requeue: boolean }>(); // killed, to retry
  private held = new Map<string, SessionKind>(); // new work waiting for memory: kind (and floor) → kind
  private wait: { why: string; since: number; told: boolean } | null = null; // since when new work waits, and whether it pinged
  private pings: { held: number | null; stops: number | null } = { held: null, stops: null }; // when each last pinged
  private stopped: string[] = []; // agents whose stopped session resumes by itself, for the next digest
  private demoDelayMs: number | null = null;
  private lastStop: HealthView['lastStop'] = null;
  private lastKey = '';
  private ticking = false;
  private previewRss = new Map<string, number>(); // preview key → what its processes use, MB
  private browserMb: number | null = null; // what the test lab's browser uses, MB (#301)

  constructor(private host: HealthHost) {}

  private estimate = (k: SessionKind) => this.host.settings().estimates[k] ?? DEFAULT_ESTIMATES[k];

  /** The disks to watch: their free space shows on the health strip and holds new builds, QA and previews when low. */
  useDisk(host: DiskHost) {
    this.disk = host;
  }

  /** Why new work that writes to disk waits now (null: it doesn't). */
  private diskHeld(kind: SessionKind): string | null {
    return this.disk && DISK_HELD_KINDS.includes(kind) ? diskHold(this.disks, this.disk.settings()) : null;
  }

  /** Why a session of `kind` can't start now, or null. */
  refusal(kind: SessionKind, now = Date.now()): string | null {
    const disk = this.diskHeld(kind);
    if (disk) return disk;
    const sessions = this.host.sessions().map((s) => ({ kind: s.kind, rssMb: this.rss.get(s.id) ?? null, ageMs: now - s.startedAt }));
    return admission({ kind, memory: this.memory, estimateMb: this.estimate(kind), headroomMb: this.host.settings().headroomMb, reservedMb: reservedMb(sessions, this.estimate), browserMb: this.browserMb });
  }

  /** What's free for a new session of `kind` and what one needs (null: memory not read yet): Hybrid's room (#260). */
  fit(kind: SessionKind, now = Date.now()): { freeMb: number; needMb: number } | null {
    if (!this.memory) return null;
    const sessions = this.host.sessions().map((s) => ({ kind: s.kind, rssMb: this.rss.get(s.id) ?? null, ageMs: now - s.startedAt }));
    return memoryFit({ memory: this.memory, estimateMb: this.estimate(kind), headroomMb: this.host.settings().headroomMb, reservedMb: reservedMb(sessions, this.estimate) });
  }

  /** New work waiting for memory: since when, and the floors it waits on (null: none). */
  heldFloors(): { since: number; floors: Set<string> } | null {
    if (!this.wait || !this.held.size) return null;
    return { since: this.wait.since, floors: new Set([...this.held.keys()].flatMap((k) => (k.includes(':') ? [k.slice(k.indexOf(':') + 1)] : []))) };
  }

  /** The demo's Simulate low memory is on: its waits are short, so a burst shows soon. */
  get simulated() {
    return this.demoDelayMs !== null;
  }

  /** May the scheduler start a session of `kind` (for `floor`)? When not, the work waits and the health strip says why. */
  admit(kind: SessionKind, floor?: string): boolean {
    const why = this.refusal(kind);
    if (!why) return true;
    this.freePreview(); // the memory it frees shows at the next reading, which retries the held work
    this.held.set(floor ? `${kind}:${floor}` : kind, kind);
    this.wait = { why, since: this.wait?.since ?? Date.now(), told: this.wait?.told ?? false };
    this.emit();
    return false;
  }

  /** What a preview's processes used at the last reading, MB (0: not measured). */
  previewMb(key: string): number {
    return this.previewRss.get(key) ?? 0;
  }

  /** Before work waits for memory: stop the biggest idle preview, if any. */
  private freePreview() {
    const key = idlePreview((this.host.previews?.() ?? []).map((p) => ({ ...p, rssMb: this.previewRss.get(p.key) ?? 0 })));
    if (key) this.host.stopPreview?.(key);
  }

  /** A start the manager or the CEO asked for: refused, with the reason, when it doesn't fit. */
  ensure(kind: SessionKind) {
    const why = this.refusal(kind);
    if (why) throw new HttpError(503, why);
  }

  /** A session to resume that doesn't fit now: true when it waits (the agent stays stopped) until memory is back. */
  later(agentId: string, kind: SessionKind, why: string): boolean {
    if (!this.refusal(kind)) return false;
    this.waiting.set(agentId, { kind, why, requeue: false });
    this.emit();
    return true;
  }

  /**
   * A session ended: its peak teaches its kind's estimate. One that was killed, on a task that may carry on (`mayRetry`),
   * waits to resume once memory is back, or its work goes back to the queue: returns why, for the agent's error line, or
   * null when it ends as usual.
   */
  ended(a: { id: string; name: string }, kind: SessionKind, errors: string[], mayRetry: boolean, resumable: boolean): string | null {
    const peak = this.peaks.get(a.id) ?? 0;
    if (peak > 0) {
      this.host.settings().estimates[kind] = learnEstimate(this.estimate(kind), peak);
      this.host.save();
    }
    const stopped = this.stopping.get(a.id);
    for (const m of [this.peaks, this.rss, this.stopping]) m.delete(a.id);
    if (!mayRetry || !(stopped || sessionKilled(errors))) {
      this.retries.delete(a.id);
      return null;
    }
    const why = stopped ? `The office stopped their session: ${stopped}` : `Their session was killed (${errors.join('; ').slice(0, 160)})`;
    const tries = this.retries.get(a.id) ?? 0;
    const requeue = killRetry(tries, resumable) === 'requeue';
    if (requeue) this.retries.delete(a.id);
    else this.retries.set(a.id, tries + 1);
    this.waiting.set(a.id, { kind, why: stopped ? 'The office stopped your session to free memory' : 'Your session was killed', requeue }); // told to the agent
    const next = requeue ? `${resumable ? `Resumed ${KILL_RETRIES} times already` : "It can't be resumed"}, so the work goes back to the queue.` : `Resuming the same session once memory is back (retry ${tries + 1} of ${KILL_RETRIES}).`;
    this.host.log(a.id, `⚠ ${why}. ${next}`);
    if (requeue) {
      const m = requeueMessage(a.name, why, next);
      this.host.alert(m.title, m.body);
    } else this.stopped.push(a.name); // resumes by itself: in the next hourly digest

    this.lastStop = { agent: a.name, why, at: Date.now() };
    this.emit();
    setTimeout(() => this.retryWaiting(), 1000);
    return `${why}. ${next}`;
  }

  /** Read memory, measure each session, stop one that has to go, and retry or release what waited for memory. */
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const memory = await this.host.probe().memory();
      this.memory = memory;
      if (this.disk) await this.readDisks(this.disk);
      const sessions = this.host.sessions();
      const previews = this.host.previews?.() ?? [];
      const usage = await this.host.probe().usage([...sessions.flatMap((s) => (s.dir ? [s.dir] : [])), ...previews.map((p) => p.dir)]);
      this.previewRss = new Map(previews.flatMap((p) => (usage.has(p.dir) ? [[p.key, usage.get(p.dir)!.rssMb] as const] : [])));
      this.host.previewMem?.(this.previewRss.size ? Math.round([...this.previewRss.values()].reduce((n, mb) => n + mb, 0)) : null);
      // The lab's browser jobs are measured as the browser's whole process tree (#301), not by a folder.
      this.browserMb = (await this.host.probe().browser?.().catch(() => null)) ?? null;
      for (const id of this.rss.keys()) if (id.startsWith('lab:') && !sessions.some((s) => s.id === id)) this.rss.delete(id);
      for (const s of sessions) if (s.kind === 'labBrowser' && this.browserMb !== null) this.rss.set(s.id, this.browserMb);
      const measured: { id: string; rssMb: number; pids: number[] }[] = [];
      for (const s of sessions) {
        const u = s.dir ? usage.get(s.dir) : undefined;
        if (!u) continue;
        this.rss.set(s.id, u.rssMb);
        this.peaks.set(s.id, Math.max(this.peaks.get(s.id) ?? 0, u.rssMb));
        if (s.kind !== 'ceo' && !this.stopping.has(s.id) && u.pids.length) measured.push({ id: s.id, ...u });
      }
      const set = this.host.settings();
      const relief = memoryRelief({ memory, headroomMb: set.headroomMb, sessionMaxMb: set.sessionMaxMb, sessions: measured, previews: previews.map((p) => ({ ...p, rssMb: this.previewRss.get(p.key) ?? 0 })) });
      if (relief && 'preview' in relief) this.host.stopPreview?.(relief.preview);
      const victim = relief && 'session' in relief ? relief.session : null;
      if (victim) {
        this.stopping.set(victim.id, victim.why);
        this.host.log(victim.id, `⚠ Stopping this session: ${victim.why}.`);
        this.host.probe().kill(measured.find((m) => m.id === victim.id)!.pids);
      }
      const wasHeld = this.wait;
      for (const [key, kind] of this.held) if (!this.refusal(kind)) this.held.delete(key);
      const left = [...this.held.values()];
      this.wait = left.length && this.wait ? { ...this.wait, why: this.refusal(left[0]) ?? this.wait.why } : null;
      this.alerts(Date.now());
      this.retryWaiting();
      this.emit();
      if (wasHeld && !this.wait) this.host.schedule();
    } catch (err) {
      console.warn('health: could not read memory', err);
    } finally {
      this.ticking = false;
    }
  }

  private async readDisks(disk: DiskHost) {
    this.disks = uniqueDisks(await disk.read().catch(() => this.disks));
    const s = disk.settings();
    const last = disk.lastAlert();
    const alert = diskAlert(this.disks, s, last, Date.now());
    if (alert.last !== last) disk.setLastAlert(alert.last);
    const m = alert.send && diskWarning(this.disks, s);
    if (m) disk.alert(m.title, m.body);
  }

  /** The memory pings: a long wait (heldPing) and the hourly digest of stopped sessions. In the office only the note shows. */
  private alerts(now: number) {
    const delayMs = this.demoDelayMs ?? this.host.settings().alertAfterMin * 60_000;
    const work = this.heldWork();
    if (this.wait && work && heldPing({ ...this.wait, now, delayMs, lastPingAt: this.pings.held })) {
      this.wait.told = true;
      this.pings.held = now;
      const m = heldMessage(work, now - this.wait.since);
      this.host.alert(m.title, m.body);
    }
    const digest = stopDigest(this.stopped, now, this.pings.stops);
    if (digest) {
      this.stopped = [];
      this.pings.stops = now;
      this.host.alert(digest.title, digest.body);
    }
  }

  /** Work waiting for memory, counted: new work held back and stopped sessions waiting to resume. */
  private heldWork(): HeldWork | null {
    if (this.diskHeld('build')) return null; // the wait is for disk space: the strip says so, not "waiting for memory"
    const kinds = [...this.held.values(), ...[...this.waiting.values()].filter((w) => !w.requeue).map((w) => w.kind)];
    if (!kinds.length || !this.memory) return null;
    const sessions = this.host.sessions().map((s) => ({ kind: s.kind, rssMb: this.rss.get(s.id) ?? null, ageMs: Date.now() - s.startedAt }));
    const reserved = reservedMb(sessions, this.estimate);
    const fits = kinds.map((k) => memoryFit({ memory: this.memory!, estimateMb: this.estimate(k), headroomMb: this.host.settings().headroomMb, reservedMb: reserved }));
    return { tasks: kinds.length, freeMb: Math.max(0, fits[0].freeMb), needMb: Math.min(...fits.map((f) => f.needMb)), ...(this.browserMb ? { browserMb: this.browserMb } : {}) };
  }

  private retryWaiting() {
    for (const [id, w] of this.waiting) {
      if (!w.requeue && this.refusal(w.kind)) continue;
      this.waiting.delete(id);
      this.host.retry(id, w.why, w.requeue);
    }
  }

  /** The demo's Simulate low memory, and its way back (POST /api/health/simulate). */
  async simulate(low: boolean): Promise<HealthView> {
    const probe = this.host.probe();
    if (!probe.simulate) throw new HttpError(404, 'Only the demo office can pretend memory is low.');
    probe.simulate(low);
    this.demoDelayMs = DEMO_ALERT_MS;
    await this.tick();
    return this.view();
  }

  view(): HealthView {
    return { memory: this.memory, running: this.host.sessions().length, waiting: [...this.waiting.values()].filter((w) => !w.requeue).length, held: this.wait?.why ?? null, heldWork: this.heldWork(), lastStop: this.lastStop, disk: this.diskView() };
  }

  private diskView(): DiskView | null {
    if (!this.disk || !this.disks.length) return null;
    const s = this.disk.settings();
    return { disks: this.disks.map((d) => ({ ...d, level: diskLevel(d, s) })), level: worstLevel(this.disks, s), lastClean: this.disk.lastClean() };
  }

  /** Out to the tabs now: a cleanup finished or the disk settings changed. */
  async refresh() {
    if (this.disk) await this.readDisks(this.disk);
    this.emit();
  }

  /** Out to the tabs when something they'd see changed: memory in 64 MB steps, not every reading. */
  private emit() {
    const v = this.view();
    const m = v.memory;
    const key = JSON.stringify({ ...v, memory: m && [m.availableMb >> 6, m.swapFreeMb >> 6, Math.round((m.load ?? 0) * 10)], heldWork: v.heldWork && [v.heldWork.tasks, v.heldWork.freeMb >> 6, v.heldWork.needMb], disk: v.disk && { ...v.disk, disks: v.disk.disks.map((d) => [d.level, d.freeMb >> 8]) } });
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.host.emit(v);
  }
}
