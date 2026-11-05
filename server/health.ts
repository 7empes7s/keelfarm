// Resource safety (#55): the office never takes its computer down. Before a session starts, free memory and swap are
// checked against what that kind of session needs (learned from past peaks): work that doesn't fit waits in the queue,
// with the reason on the health strip. On Linux each agent's processes are measured through /proc (by the folder they
// work in): one over the per-session ceiling, or the biggest when memory is about to run out, is stopped. A session
// killed that way, by the OS or by its terminal keeper dying resumes once memory is back, up to twice, and then its work
// goes back to the queue. Elsewhere only admission runs (os.freemem). Pure rules first, then the readings, then
// OfficeHealth, which the Swarm drives.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_ESTIMATES, gb, type HealthView, type MemoryReading, type MemorySettings, type SessionKind } from '../shared/health.ts';
import { HttpError } from './httpError.ts';

export { DEFAULT_MEMORY, memorySettings, type SessionKind } from '../shared/health.ts';

// ---------- rules ----------

/** A just-started session that can't be measured is taken to grow to its estimate within this long. */
const WARMUP_MS = 3 * 60_000;
/** A killed session resumes at most this many times in a row before its work goes back to the queue. */
export const KILL_RETRIES = 2;
/** Work that has waited for memory this long rings the manager's devices. */
const HELD_ALERT_MS = 60_000;

/** What kind of session an agent runs on their task. */
export function sessionKind(a: { role: string; task: string | null }): SessionKind {
  return a.role === 'ceo' ? 'ceo' : a.task === 'qa' ? 'qa' : a.task === 'fix' ? 'fix' : 'build';
}

/** What running sessions are still expected to grow by: their estimate less what they use now (unmeasured: while young). */
export function reservedMb(sessions: { kind: SessionKind; rssMb: number | null; ageMs: number }[], estimate: (k: SessionKind) => number): number {
  return sessions.reduce((n, s) => n + (s.rssMb !== null ? Math.max(0, estimate(s.kind) - s.rssMb) : s.ageMs < WARMUP_MS ? estimate(s.kind) : 0), 0);
}

/** Why a session of `kind` can't start now (null: it can). The CEO always can: its jobs are small and steer everyone. */
export function admission(x: { kind: SessionKind; memory: MemoryReading | null; estimateMb: number; headroomMb: number; reservedMb: number }): string | null {
  if (x.kind === 'ceo' || !x.memory) return null;
  const free = x.memory.availableMb + x.memory.swapFreeMb - x.reservedMb;
  if (free - x.estimateMb >= x.headroomMb) return null;
  return `Waiting for memory: ${gb(free)} free${x.reservedMb > 0 ? ' once running sessions grow' : ''}, a ${x.kind} session needs about ${gb(x.estimateMb)} and ${gb(x.headroomMb)} stays free.`;
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

function killPids(pids: number[]) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone already
    }
  }
}

export const realResources: ResourceProbe = { memory: readMemory, usage: procUsage, kill: killPids };

// ---------- the office's side ----------

/** A session the office runs now: an agent's (their desk folder, where measured) or the CEO's. */
export interface LiveSession {
  id: string;
  kind: SessionKind;
  dir: string | null;
  startedAt: number;
}

export interface HealthHost {
  probe(): ResourceProbe;
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
}

export class OfficeHealth {
  private memory: MemoryReading | null = null;
  private rss = new Map<string, number>(); // agent id → what their processes use now, MB
  private peaks = new Map<string, number>(); // agent id → the most their current session used, MB
  private stopping = new Map<string, string>(); // agent id → why the office stopped their session
  private retries = new Map<string, number>(); // agent id → their killed sessions resumed in a row
  private waiting = new Map<string, { kind: SessionKind; why: string; requeue: boolean }>(); // killed, to retry
  private held: { kind: SessionKind; why: string; since: number; told: boolean } | null = null; // new work waits for memory
  private lastStop: HealthView['lastStop'] = null;
  private lastKey = '';
  private ticking = false;

  constructor(private host: HealthHost) {}

  private estimate = (k: SessionKind) => this.host.settings().estimates[k] ?? DEFAULT_ESTIMATES[k];

  /** Why a session of `kind` can't start now, or null. */
  refusal(kind: SessionKind, now = Date.now()): string | null {
    const sessions = this.host.sessions().map((s) => ({ kind: s.kind, rssMb: this.rss.get(s.id) ?? null, ageMs: now - s.startedAt }));
    return admission({ kind, memory: this.memory, estimateMb: this.estimate(kind), headroomMb: this.host.settings().headroomMb, reservedMb: reservedMb(sessions, this.estimate) });
  }

  /** May the scheduler start a session of `kind`? When not, the work waits and the health strip says why. */
  admit(kind: SessionKind): boolean {
    const why = this.refusal(kind);
    if (!why) return true;
    this.held = { kind, why, since: this.held?.since ?? Date.now(), told: this.held?.told ?? false };
    this.emit();
    return false;
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
    this.host.alert(`${a.name}'s session was stopped`, `${why}. ${next}`);
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
      const sessions = this.host.sessions();
      const usage = await this.host.probe().usage(sessions.flatMap((s) => (s.dir ? [s.dir] : [])));
      const measured: { id: string; rssMb: number; pids: number[] }[] = [];
      for (const s of sessions) {
        const u = s.dir ? usage.get(s.dir) : undefined;
        if (!u) continue;
        this.rss.set(s.id, u.rssMb);
        this.peaks.set(s.id, Math.max(this.peaks.get(s.id) ?? 0, u.rssMb));
        if (s.kind !== 'ceo' && !this.stopping.has(s.id) && u.pids.length) measured.push({ id: s.id, ...u });
      }
      const set = this.host.settings();
      const victim = memoryVictim({ memory, headroomMb: set.headroomMb, sessionMaxMb: set.sessionMaxMb, sessions: measured });
      if (victim) {
        this.stopping.set(victim.id, victim.why);
        this.host.log(victim.id, `⚠ Stopping this session: ${victim.why}.`);
        this.host.probe().kill(measured.find((m) => m.id === victim.id)!.pids);
      }
      const wasHeld = this.held;
      if (this.held && !this.refusal(this.held.kind)) this.held = null;
      if (this.held && !this.held.told && Date.now() - this.held.since >= HELD_ALERT_MS) {
        this.held.told = true; // once per wait: sessions starting one after another wait a tick or two as a matter of course
        this.host.alert('Work waits for memory', this.held.why);
      }
      this.retryWaiting();
      this.emit();
      if (wasHeld && !this.held) this.host.schedule();
    } catch (err) {
      console.warn('health: could not read memory', err);
    } finally {
      this.ticking = false;
    }
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
    await this.tick();
    return this.view();
  }

  view(): HealthView {
    return { memory: this.memory, running: this.host.sessions().length, waiting: [...this.waiting.values()].filter((w) => !w.requeue).length, held: this.held?.why ?? null, lastStop: this.lastStop };
  }

  /** Out to the tabs when something they'd see changed: memory in 64 MB steps, not every reading. */
  private emit() {
    const v = this.view();
    const m = v.memory;
    const key = JSON.stringify({ ...v, memory: m && [m.availableMb >> 6, m.swapFreeMb >> 6, Math.round((m.load ?? 0) * 10)] });
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.host.emit(v);
  }
}
