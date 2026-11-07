import fs from 'node:fs';
import path from 'node:path';
import { run } from './exec.ts';

// Nothing an agent starts outlives its session (#227). A demo office an agent boots for QA, a dev server it forgot:
// when the session ends, whatever listens from its worktree goes with its process group; and every upkeep tick, any
// process still working in a machine's worktree that no live session owns is stopped. Always by pid or process group,
// never by name; never the office's own processes (the keeper, the CLIs in agents' terminals) or anything under them.
// A process's folder comes from /proc, so the cwd rules work on Linux only (elsewhere the port and command-line
// clean-up in workspace.ts releaseDirs still runs).

export interface Proc {
  pid: number;
  ppid: number;
  pgid: number;
  /** Its working folder; null where the OS doesn't say. */
  cwd: string | null;
  /** The TCP ports it listens on. */
  ports: number[];
}

/** What to kill: whole process groups (kill -pgid), and single processes. */
export interface KillPlan {
  groups: number[];
  pids: number[];
}

const inside = (dir: string, p: string) => {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** `ps -A -o pid=,ppid=,pgid=` lines, with each pid's folder and listening ports. */
export function parseProcs(listing: string, cwdOf: (pid: number) => string | null, ports: ReadonlyMap<number, number[]>): Proc[] {
  const out: Proc[] = [];
  for (const line of listing.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    out.push({ pid, ppid: Number(m[2]), pgid: Number(m[3]), cwd: cwdOf(pid), ports: ports.get(pid) ?? [] });
  }
  return out;
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpn` output: pid → the ports it listens on. */
export function parseListeners(lsof: string): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let pid = 0;
  for (const line of lsof.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid) {
      const port = Number(line.slice(line.lastIndexOf(':') + 1));
      if (Number.isInteger(port) && port > 0) out.set(pid, [...new Set([...(out.get(pid) ?? []), port])]);
    }
  }
  return out;
}

/** The office's processes and everything under them (a kept CLI's MCP servers and shells): never touched. */
export function protectedPids(procs: readonly Proc[], keep: readonly number[]): Set<number> {
  const safe = new Set(keep);
  const children = new Map<number, number[]>();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  const todo = [...keep];
  while (todo.length) {
    for (const c of children.get(todo.pop()!) ?? []) {
      if (safe.has(c)) continue;
      safe.add(c);
      todo.push(c);
    }
  }
  return safe;
}

/**
 * What an ended session left running: processes that listen from its worktree (`dirs`) or on one of its ports.
 * The office's own and their children are spared: a CLI kept at its prompt keeps its tools.
 */
export function sessionLeftovers(procs: readonly Proc[], dirs: readonly string[], ports: readonly number[], keep: readonly number[]): Proc[] {
  const safe = new Set(keep);
  return procs.filter((p) => !safe.has(p.pid) && p.ports.length > 0 && (p.ports.some((x) => ports.includes(x)) || (!!p.cwd && dirs.some((d) => inside(d, p.cwd!)))));
}

/** The worktree root a folder is in: `<machines>/<machine>/work/<repo>`, or one of the extra idle folders. */
function rootOf(cwd: string, machinesDir: string, idle: readonly string[]): { machine: string | null } | null {
  if (idle.some((d) => inside(d, cwd))) return { machine: null };
  if (!inside(machinesDir, cwd)) return null;
  const [machine, work, repo] = path.relative(machinesDir, cwd).split(/[\\/]/);
  return machine && work === 'work' && repo ? { machine } : null;
}

/**
 * The sweep's picks: processes working in a machine's worktree whose machine has no live session (`live`), or in one
 * of the `idle` folders (the lab's checkouts while it runs nothing), except the office's processes and their trees.
 */
export function orphans(procs: readonly Proc[], machinesDir: string, live: readonly string[], idle: readonly string[], keep: readonly number[]): Proc[] {
  const safe = protectedPids(procs, keep);
  return procs.filter((p) => {
    if (safe.has(p.pid) || !p.cwd) return false;
    const root = rootOf(p.cwd, machinesDir, idle);
    return !!root && (root.machine === null || !live.includes(root.machine));
  });
}

/**
 * How to stop the picks: a pick that leads its own process group takes the whole group (what it started, wherever
 * that runs); any other only itself, so a group shared with the office, or with something not picked, is never killed.
 */
export function killPlan(picks: readonly Proc[], procs: readonly Proc[], keep: readonly number[], self = process.pid): KillPlan {
  const safe = protectedPids(procs, keep);
  const sparedGroups = new Set([...procs.filter((p) => safe.has(p.pid) || p.pid === self).map((p) => p.pgid), self]);
  const groups = [...new Set(picks.filter((p) => p.pgid === p.pid && !sparedGroups.has(p.pgid)).map((p) => p.pgid))];
  const pids = picks.filter((p) => !groups.includes(p.pgid)).map((p) => p.pid);
  return { groups, pids };
}

/** Every process on this machine with its folder and ports; empty off Linux (no cwd to go by) or when ps fails. */
export async function readProcs(): Promise<Proc[]> {
  if (process.platform !== 'linux') return [];
  const [listing, lsof] = await Promise.all([run('ps', ['-A', '-o', 'pid=,ppid=,pgid=']).catch(() => ''), listeners()]);
  const cwdOf = (pid: number) => {
    try {
      return fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return null; // gone, or not ours to read
    }
  };
  return parseProcs(listing, cwdOf, lsof);
}

/** pid → listening TCP ports (lsof; on Linux and macOS). */
export async function listeners(): Promise<Map<number, number[]>> {
  if (process.platform === 'win32') return new Map();
  return parseListeners(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']).catch(() => ''));
}

/**
 * Which ports are still taken after a clean-up: `ports` (the agent's reserved one) by anything but `spare`, and `block`
 * (their preview block, which teammates and system services may share) only by a process in `dirs`.
 */
export function heldPorts(procs: readonly Proc[], ports: readonly number[], block: readonly number[], dirs: readonly string[], spare: readonly number[]): number[] {
  const busy = procs
    .filter((p) => !spare.includes(p.pid))
    .flatMap((p) => p.ports.filter((x) => ports.includes(x) || (block.includes(x) && !!p.cwd && dirs.some((d) => inside(d, p.cwd!)))));
  return [...new Set(busy)].sort((a, b) => a - b);
}

/** The port-free check (heldPorts), retried a moment: a killed process's socket can take a while to close. */
export async function stillHeld(ports: readonly number[], spare: readonly number[], block: readonly number[] = [], dirs: readonly string[] = []): Promise<number[]> {
  let busy: number[] = [];
  for (let i = 0; i < 10; i++) {
    const procs = process.platform === 'linux' ? await readProcs() : [...(await listeners())].map(([pid, ps]) => ({ pid, ppid: 0, pgid: pid, cwd: null, ports: ps }));
    busy = heldPorts(procs, ports, block, dirs, spare);
    if (!busy.length) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return busy;
}

/**
 * Stop processes working in a machine's worktree (under `machinesDir`) that no live session owns (`live`), or in an
 * `idle` folder; never the office's (`keep`) or anything under them. Returns a line per process stopped, for the log.
 */
export async function sweepOrphans(machinesDir: string, live: string[], idle: string[], keep: readonly number[]): Promise<string[]> {
  const procs = await readProcs();
  const spare = [process.pid, ...keep];
  const picks = orphans(procs, machinesDir, live, idle, spare);
  if (picks.length) kill(killPlan(picks, procs, spare));
  return picks.map((p) => `pid ${p.pid} in ${p.cwd}${p.ports.length ? ` on port ${p.ports.join(', ')}` : ''}`);
}

/** Carry a plan out: groups first, then single processes. */
export function kill(plan: KillPlan) {
  for (const g of plan.groups) {
    try {
      process.kill(-g, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  for (const pid of plan.pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}
