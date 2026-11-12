import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentPreviewBase, LAB_PREVIEW_PORT } from './portLanes.ts';
import { createLabRunner } from './testLabRunner.ts';
import { heldPorts, killPlan, orphans, parseListeners, parseProcs, protectedPids, sessionLeftovers, sweepOrphans, type Proc } from './procSweep.ts';
import { MACHINES_DIR, machineDesk, releaseDirs, releaseMachine } from './workspace.ts';

// #227: nothing an agent starts outlives its session.

const machines = path.join(os.tmpdir(), 'home', 'machines');
const work = (machine: string, ...rest: string[]) => path.join(machines, machine, 'work', 'acme__keel', ...rest);
const proc = (pid: number, cwd: string | null, o: Partial<Proc> = {}): Proc => ({ pid, ppid: 1, pgid: pid, cwd, ports: [], ...o });

describe('parsing', () => {
  it('reads ps and lsof listings', () => {
    const ports = parseListeners('p10\nf3\nn127.0.0.1:5300\nn[::1]:5300\np11\nn*:16301\n');
    expect([...ports]).toEqual([
      [10, [5300]],
      [11, [16301]],
    ]);
    const procs = parseProcs('   10     1    10\n 11 10 10\nbad line\n', (pid) => (pid === 10 ? '/w' : null), ports);
    expect(procs).toEqual([proc(10, '/w', { ports: [5300] }), proc(11, null, { ppid: 10, pgid: 10, ports: [16301] })]);
  });
});

describe('sessionLeftovers', () => {
  it("takes what listens from the worktree or on the agent's ports, never the office's", () => {
    const procs = [
      proc(1, work('m1'), { ports: [16301] }), // a demo office the session started
      proc(2, work('m1', 'client'), { ports: [5555] }), // a dev server in a subfolder
      proc(3, work('m1')), // listens on nothing: a kept CLI's MCP server
      proc(4, '/elsewhere', { ports: [5300] }), // on the agent's reserved port
      proc(5, '/elsewhere', { ports: [6301] }), // someone else's
      proc(6, work('m1'), { ports: [7000] }), // the CLI itself
      proc(7, work('m2'), { ports: [5301] }), // a teammate's
    ];
    expect(sessionLeftovers(procs, [work('m1')], [5300], [6]).map((p) => p.pid)).toEqual([1, 2, 4]);
  });
});

describe('orphans', () => {
  it('selects only orphaned machine-worktree processes', () => {
    const procs = [
      proc(100, '/'), // the office's keeper
      proc(101, work('m1'), { ppid: 100 }), // a live CLI kept at its prompt
      proc(102, work('m1'), { ppid: 101 }), // ... and its MCP server
      proc(103, work('m1', 'server'), { ports: [16301] }), // an old demo office nobody owns now
      proc(104, work('m2')), // a teammate mid-session
      proc(105, path.join(machines, 'm1', 'tmp')), // a machine's temp folder, not its worktree
      proc(106, '/root/Projects/keelfarm', { ports: [4317] }), // the live office
      proc(107, path.join(machines, 'm3', 'work')), // the work folder itself, no repo
      proc(108, '/lab/desks/testlab'), // left by a lab run before a crash
      proc(109, null), // cwd unknown
    ];
    expect(orphans(procs, machines, ['m2'], ['/lab/desks/testlab'], [100]).map((p) => p.pid)).toEqual([103, 108]);
    expect(protectedPids(procs, [100])).toEqual(new Set([100, 101, 102]));
  });
});

describe('heldPorts', () => {
  it("counts the reserved port whoever holds it, and a preview-block port only when it's held from the worktree", () => {
    const procs = [
      proc(1, work('m1'), { ports: [16301] }), // the agent's own demo office, still up
      proc(2, '/usr/bin', { ports: [16302] }), // a system service in the shared block (the tunnel)
      proc(3, work('m2'), { ports: [16303] }), // a teammate's demo office sharing the block
      proc(4, '/elsewhere', { ports: [5300] }), // on the reserved port
    ];
    expect(heldPorts(procs, [5300], [16301, 16302, 16303], [work('m1')], [])).toEqual([5300, 16301]);
  });
});

describe('killPlan', () => {
  it('kills a group its leader heads, but only the process when the group is shared with the office', () => {
    const procs = [
      proc(1, '/', { pgid: 1 }), // the office
      proc(20, work('m1'), { ppid: 1, pgid: 20 }), // a CLI (a session leader)
      proc(21, work('m1'), { ppid: 20, pgid: 20, ports: [5300] }), // in the CLI's group
      proc(30, work('m1'), { ppid: 900, pgid: 30, ports: [16301] }), // a detached demo office
      proc(31, work('m1'), { ppid: 30, pgid: 30 }), // ... and what it started
    ];
    expect(killPlan([procs[2], procs[3]], procs, [20], 1)).toEqual({ groups: [30], pids: [21] });
  });
});

// ---------- the real thing ----------

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });

/**
 * A fake session: it starts a server in `cwd` in a process group of its own (like a demo office booted in the
 * background, which starts a helper of its own), writes their pids to `pidFile`, and ends. The server outlives it.
 */
function fakeSession(cwd: string, port: number, pidFile: string) {
  const server = `const http=require('http');const {spawn}=require('child_process');const h=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});http.createServer((q,s)=>s.end('demo')).listen(${port},'127.0.0.1',()=>require('fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,h.pid])));`;
  const session = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(server)}],{cwd:${JSON.stringify(cwd)},detached:true,stdio:'ignore'}).unref();`;
  return new Promise<void>((resolve) => spawn(process.execPath, ['-e', session], { cwd, stdio: 'ignore' }).once('exit', () => resolve()));
}

async function started(pidFile: string): Promise<number[]> {
  for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await tick(50);
  return JSON.parse(fs.readFileSync(pidFile, 'utf8')) as number[];
}

async function freePort(from: number): Promise<number> {
  for (let p = from; p < from + 50; p++) if (!(await listening(p))) return p;
  throw new Error(`no free port from ${from}`);
}

// The cwd rules read /proc: Linux only (elsewhere the existing port and command-line clean-up runs).
describe.runIf(process.platform === 'linux')('a session that leaves a server running', () => {
  const left: number[] = [];
  afterEach(() => {
    for (const pid of left.splice(0)) if (alive(pid)) process.kill(pid, 'SIGKILL');
  });

  it("is cleaned up when it ends: its server's whole group goes and the agent's ports are free", async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'session-'));
    // Where its demo office's floor-1 preview goes. Only that port is passed in: the others in the range may be teammates'.
    const port = await freePort(agentPreviewBase(5200 + Math.floor(Math.random() * 700)) + 1);
    const pids = path.join(worktree, 'pids.json');
    await fakeSession(worktree, port, pids);
    const [server, helper] = await started(pids);
    left.push(server, helper);
    expect(await listening(port)).toBe(true);

    const busy = await releaseDirs([worktree], [port], { pids: [], markers: [] });
    expect(busy).toEqual([]);
    expect(await listening(port)).toBe(false);
    for (let i = 0; i < 20 && alive(helper); i++) await tick(50);
    expect(alive(helper)).toBe(false); // in the server's group, though it listens on nothing
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  it('is swept up when its machine has no live session, and spared while it has one', async () => {
    const worktree = path.join(MACHINES_DIR, 'feed0001', 'work', 'acme__keel');
    fs.mkdirSync(worktree, { recursive: true });
    const port = await freePort(20_000 + Math.floor(Math.random() * 5000));
    const pids = path.join(worktree, 'pids.json');
    await fakeSession(worktree, port, pids);
    const [server, helper] = await started(pids);
    left.push(server, helper);

    expect(await sweepOrphans(MACHINES_DIR, ['feed0001'], [], [])).toEqual([]);
    expect(alive(server)).toBe(true);

    const stopped = await sweepOrphans(MACHINES_DIR, [], [], []);
    expect(stopped.some((l) => l.startsWith(`pid ${server} `))).toBe(true);
    for (let i = 0; i < 20 && (alive(server) || alive(helper)); i++) await tick(50);
    expect(alive(server)).toBe(false);
    expect(alive(helper)).toBe(false);
    expect(await listening(port)).toBe(false);
    fs.rmSync(path.join(MACHINES_DIR, 'feed0001'), { recursive: true, force: true });
  });

  it("tears a lab run's leftovers down when the run ends, and keeps its demo office off the live lanes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-'));
    const port = await freePort(20_000 + Math.floor(Math.random() * 5000));
    const pids = path.join(dir, 'pids.json');
    // A suite that boots a server in its own process group and exits without stopping it.
    const server = `require('http').createServer((q,s)=>s.end()).listen(${port},'127.0.0.1',()=>require('fs').writeFileSync(${JSON.stringify(pids)},JSON.stringify([process.pid])))`;
    const suite = `const fs=require('fs');require('child_process').spawn(process.execPath,['-e',${JSON.stringify(server)}],{stdio:'ignore'}).unref();const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(pids)})){clearInterval(t);console.log('preview base '+process.env.SWARM_PREVIEW_PORT)}},20)`;
    const r = await createLabRunner().run({ dir, argv: ['node', '-e', suite], timeoutMs: 20_000, silenceMs: null, maxMb: 4096 });
    const [leftover] = JSON.parse(fs.readFileSync(pids, 'utf8')) as number[];
    left.push(leftover);
    expect(r.tail).toContain(`preview base ${LAB_PREVIEW_PORT}`);
    for (let i = 0; i < 20 && alive(leftover); i++) await tick(50);
    expect(alive(leftover)).toBe(false);
    expect(await listening(port)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.runIf(process.platform === 'linux')('stops a lab run whose processes grow past its memory limit (#578)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-'));
    // A suite whose child (like an e2e run's browser) holds 300 MB and never ends.
    const hog = "const b=Buffer.alloc(300*1024*1024,1);console.log('holding '+b.length);setInterval(()=>b[0]++,1000)";
    const suite = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(hog)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
    const r = await createLabRunner().run({ dir, argv: ['node', '-e', suite], timeoutMs: 30_000, silenceMs: null, maxMb: 200 });
    expect(r.timedOut).toBe(false);
    expect(r.oomMb).toBeGreaterThan(200);
    expect(r.ms).toBeLessThan(20_000);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 40_000);

  it("leaves alone what listens on the agent's preview block from outside their worktree (a tunnel, a teammate)", async () => {
    // A reserved port nothing listens on, so the by-port kill touches nobody's process.
    let agentPort = 5200 + Math.floor(Math.random() * 700);
    while (await listening(agentPort)) agentPort = 5200 + ((agentPort - 5200 + 1) % 700);
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-'));
    const port = await freePort(agentPreviewBase(agentPort) + 150);
    const pids = path.join(elsewhere, 'pids.json');
    await fakeSession(elsewhere, port, pids);
    const [server, helper] = await started(pids);
    left.push(server, helper);
    fs.mkdirSync(machineDesk('feed0002', 'acme/keel'), { recursive: true });

    const busy = await releaseMachine('feed0002', 'acme/keel', agentPort);
    expect(busy).toEqual([]); // not the agent's: no "still in use" warning either
    expect(alive(server)).toBe(true);
    expect(await listening(port)).toBe(true);
    fs.rmSync(elsewhere, { recursive: true, force: true });
    fs.rmSync(path.join(MACHINES_DIR, 'feed0002'), { recursive: true, force: true });
  });
});
