import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addPoint, byAgent, byKind, capPrograms, POINT_MS, TREND_MS, type ProgramUse, type ServerNow, type ServerPoint } from '../shared/serverLoad.ts';
import { cpuShares, groupPrograms, orphanUses, parseCpuTicks, parseLoadavg, parseMeminfo, parseStat, ServerLoad, type LoadContext, type ProcRow } from './serverLoad.ts';

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'proc', name), 'utf8');

describe('/proc parsing (#271)', () => {
  it('reads memory and swap from meminfo, in MB', () => {
    expect(parseMeminfo(fixture('meminfo'))).toEqual({ totalMb: 7745, availableMb: 3379, swapTotalMb: 8192, swapFreeMb: 6349 });
    expect(parseMeminfo('MemTotal: 100 kB\n')).toBeNull(); // no MemAvailable: not a reading
  });

  it('reads the 1-minute load', () => {
    expect(parseLoadavg(fixture('loadavg'))).toBe(7.84);
    expect(parseLoadavg('')).toBeNull();
  });

  it("reads the machine's busy and total ticks (idle and iowait aren't busy)", () => {
    const t = parseCpuTicks(fixture('stat'))!;
    expect(t.total).toBe(48376774 + 594989 + 14919679 + 78298259 + 521602 + 260536);
    expect(t.total - t.busy).toBe(78298259 + 521602);
  });

  it("reads a process's stat line, even with a space in its name", () => {
    expect(parseStat(fixture('pid-stat'))).toEqual({ pid: 4242, comm: 'Web Content', ppid: 4200, pgid: 4200, ticks: 1500, start: 35954496, rssMb: 300 });
    expect(parseStat('garbage')).toBeNull();
  });

  it('turns tick deltas into a share of one core, from zero for a new or reused pid', () => {
    const now = [
      { pid: 1, comm: 'a', ppid: 0, pgid: 1, ticks: 1150, start: 5, rssMb: 1 },
      { pid: 2, comm: 'b', ppid: 0, pgid: 2, ticks: 900, start: 9, rssMb: 1 },
      { pid: 3, comm: 'c', ppid: 0, pgid: 3, ticks: 50, start: 1, rssMb: 1 },
    ];
    const prev = new Map([
      [1, { ticks: 1000, start: 5 }],
      [2, { ticks: 100, start: 8 }], // the pid was reused since
    ]);
    expect([...cpuShares(now, prev, 15_000)]).toEqual([
      [1, 10],
      [2, 0],
      [3, 0],
    ]);
  });
});

// A small computer: the office and its keeper, Ada (live) with her CLI, its MCP server and browser, a demo office she
// started through a shell and its headless browser, Bo (session ended) with a demo office left running, the CEO, a
// preview, Postgres and the rest.
const M = path.join(path.sep, 'm');
const work = (machine: string) => path.join(M, machine, 'work', 'o__r');
const previewDir = path.join(path.sep, 'w', 'o__r', 'desks', 'preview');
const ctx: LoadContext = {
  officePids: [100, 200],
  machinesDir: M,
  agents: [
    { id: 'ada-1', name: 'Ada', machine: 'ada1', dirs: [path.join(M, 'ada1')], live: true },
    { id: 'bo-2', name: 'Bo', machine: 'bo2', dirs: [path.join(M, 'bo2')], live: false },
    { id: 'ceo', name: 'Mimoun', machine: null, dirs: [path.join(path.sep, 'h', 'ceo')], live: true },
  ],
  previews: [{ key: 'o/r#main', dir: previewDir, name: 'Preview · floor 1', ref: 'preview: floor 1' }],
};
const p = (pid: number, ppid: number, comm: string, cwd: string | null, rssMb = 100, pgid = pid): ProcRow => ({ pid, ppid, pgid, comm, rssMb, cpuPct: 1, cwd });
const procs: ProcRow[] = [
  p(100, 1, 'node', path.join(path.sep, 'src', 'office'), 250),
  p(101, 100, 'chrome', path.join(path.sep, 'src', 'office'), 300), // the test lab's browser
  p(200, 1, 'node', path.sep, 50), // the terminal keeper
  p(300, 200, 'claude', work('ada1'), 300),
  p(301, 300, 'node', work('ada1'), 80), // an MCP server
  p(302, 301, 'chrome', path.join(path.sep, 'tmp'), 400), // the MCP's browser: its folder is elsewhere
  p(303, 300, 'bash', work('ada1'), 5),
  p(304, 303, 'node', work('ada1'), 200), // a demo office
  p(305, 1, 'headless_shell', null, 150, 304), // its browser, reparented, in the demo office's group
  p(400, 1, 'node', work('bo2'), 180), // left by Bo's ended session
  p(401, 400, 'esbuild', work('bo2'), 20),
  p(500, 200, 'claude', path.join(path.sep, 'h', 'ceo'), 260),
  p(600, 1, 'node', previewDir, 160),
  p(700, 1, 'postgres', null, 240),
  p(800, 1, 'sshd', null, 10),
];

describe('grouping processes into programs (#271)', () => {
  const programs = groupPrograms(procs, ctx);
  const find = (name: string) => programs.find((x) => x.name === name);

  it("puts an agent's CLI and what it starts directly into their session", () => {
    expect(find('Claude Code · Ada')).toMatchObject({ kind: 'agent', agentId: 'ada-1', ref: '@Ada', rssMb: 380, procs: 2 });
    expect(find('Claude Code · Mimoun')).toMatchObject({ kind: 'agent', agentId: 'ceo', rssMb: 260 });
  });

  it('attributes test browsers to the agent through their parents or their process group', () => {
    expect(find('Test browser · Ada')).toMatchObject({ kind: 'browser', agentId: 'ada-1', rssMb: 550, procs: 2 });
  });

  it('counts what a shell started in a worktree as demo offices and tests, by agent', () => {
    expect(find('Demo office & tests · Ada')).toMatchObject({ kind: 'runner', rssMb: 205 });
    expect(find('Demo office & tests · Bo')).toMatchObject({ kind: 'runner', agentId: 'bo-2', rssMb: 200 });
  });

  it('names previews by their key, the office and its lab browser, Postgres, and the rest', () => {
    expect(find('Preview · floor 1')).toMatchObject({ kind: 'preview', previewKey: 'o/r#main', ref: 'preview: floor 1', rssMb: 160 });
    expect(find('This office')).toMatchObject({ kind: 'office', rssMb: 300, procs: 2 });
    expect(find('Test lab browser')).toMatchObject({ kind: 'browser', rssMb: 300 });
    expect(find('Postgres & Docker')?.rssMb).toBe(240);
    expect(find('Other')?.rssMb).toBe(10);
    expect(programs.reduce((n, x) => n + x.procs, 0)).toBe(procs.length);
  });

  it('sums memory by kind and by agent', () => {
    expect(byKind(programs).slice(0, 2)).toEqual([
      { kind: 'browser', rssMb: 850 },
      { kind: 'agent', rssMb: 640 },
    ]);
    expect(byAgent(programs).map((a) => [a.name, a.rssMb])).toEqual([
      ['Ada', 380 + 550 + 205],
      ['Mimoun', 260],
      ['Bo', 200],
    ]);
  });
});

describe('orphans (#271)', () => {
  it('flags what an ended session left in its worktree, once per tree with its memory, never a live agent or the office', () => {
    expect(orphanUses(procs, ctx)).toEqual([{ pid: 400, name: 'node', agentId: 'bo-2', agent: 'Bo', rssMb: 200 }]);
  });

  it('flags nothing once their session is live again', () => {
    expect(orphanUses(procs, { ...ctx, agents: ctx.agents.map((a) => ({ ...a, live: true })) })).toEqual([]);
  });
});

describe('the 24 h trend (#271)', () => {
  const pt = (at: number): ServerPoint => ({ at, memPct: 50, swapPct: 10, loadPct: 80 });

  it('keeps a point a minute for 24 hours, nothing older', () => {
    let trend: ServerPoint[] = [];
    const end = 25 * 3_600_000;
    for (let at = 0; at <= end; at += 15_000) trend = addPoint(trend, pt(at));
    expect(trend.length).toBe(TREND_MS / POINT_MS);
    expect(trend[0].at).toBeGreaterThan(end - TREND_MS);
    expect(trend.every((x, i) => i === 0 || x.at - trend[i - 1].at >= POINT_MS)).toBe(true);
  });
});

describe('capPrograms', () => {
  it('keeps the biggest and sums the rest into Other', () => {
    const many: ProgramUse[] = Array.from({ length: 30 }, (_, i) => ({ kind: 'runner', name: `p${i}`, rssMb: 100 + i, cpuPct: 1, procs: 1 }));
    const capped = capPrograms(many, 24);
    expect(capped.length).toBe(24);
    expect(capped[0].name).toBe('p29');
    expect(capped[23]).toMatchObject({ name: 'Other', procs: 7, rssMb: [100, 101, 102, 103, 104, 105, 106].reduce((a, b) => a + b) });
  });
});

describe('ServerLoad', () => {
  it('sends each reading out and adds it to the trend', async () => {
    const sent: ServerNow[] = [];
    const reading: ServerNow = { at: 1_000_000, cpus: 4, load: 2, cpuPct: 50, totalMb: 8000, availableMb: 2000, swapTotalMb: 1000, swapFreeMb: 500, disks: [], programs: [], orphans: [], measured: true };
    const load = new ServerLoad({ read: async () => reading, seed: () => [], context: () => ctx, emit: (n) => sent.push(n) });
    await load.tick();
    expect(sent).toEqual([reading]);
    expect(load.view()).toBe(reading);
    expect(load.points()).toEqual([{ at: 1_000_000, memPct: 75, swapPct: 50, loadPct: 50 }]);
  });
});
