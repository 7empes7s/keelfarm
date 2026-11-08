// The demo's server load (#271): made-up programs for the agents and previews the demo office has, one process left
// over from an idle agent's ended session (for "Stop it"), and a made-up day for the 24 h trend.
import { capPrograms, POINT_MS, TREND_MS, type ProgramUse, type ServerNow, type ServerPoint } from '../shared/serverLoad.ts';
import { HttpError } from './httpError.ts';
import type { LoadContext } from './serverLoad.ts';

/** A stable number in [0, 1) per name, so a demo agent's programs don't jump between readings. */
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) / 2 ** 32;
const wobble = () => 0.9 + Math.random() * 0.2;

export function demoServerLoad(memory: () => Promise<{ totalMb: number; availableMb: number; cpus: number }>) {
  const stopped = new Set<number>();
  return {
    server: async (ctx: LoadContext): Promise<ServerNow> => {
      const m = await memory();
      const programs: ProgramUse[] = [];
      const live = ctx.agents.filter((a) => a.live);
      for (const [i, a] of live.entries()) {
        const who = { agentId: a.id, ref: `@${a.name}` };
        programs.push({ kind: 'agent', name: `Claude Code · ${a.name}`, ...who, rssMb: Math.round((260 + hash(a.id) * 100) * wobble()), cpuPct: Math.round(hash(a.name) * 40 * wobble()), procs: 4 });
        if (i % 2 === 0) programs.push({ kind: 'browser', name: `Test browser · ${a.name}`, ...who, rssMb: Math.round(420 * wobble()), cpuPct: Math.round(30 * wobble()), procs: 6 });
        if (i % 3 === 0) programs.push({ kind: 'runner', name: `Demo office & tests · ${a.name}`, ...who, rssMb: Math.round(190 * wobble()), cpuPct: Math.round(55 * wobble()), procs: 3 });
      }
      for (const v of ctx.previews) programs.push({ kind: 'preview', name: v.name, previewKey: v.key, ...(v.ref && { ref: v.ref }), rssMb: Math.round(160 * wobble()), cpuPct: 2, procs: 2 });
      programs.push({ kind: 'office', name: 'This office', rssMb: Math.round(250 * wobble()), cpuPct: 4, procs: 3 }, { kind: 'db', name: 'Postgres & Docker', rssMb: 310, cpuPct: 1, procs: 12 }, { kind: 'other', name: 'Other', rssMb: 600, cpuPct: 3, procs: 140 });
      const idle = ctx.agents.find((a) => !a.live && a.machine);
      const orphan = idle && !stopped.has(41_000) ? [{ pid: 41_000, name: 'node', agentId: idle.id, agent: idle.name, rssMb: 140 }] : [];
      const load = Math.min(m.cpus * 1.5, 0.6 + live.length * 0.9) * wobble();
      return { at: Date.now(), cpus: m.cpus, load: Math.round(load * 100) / 100, cpuPct: Math.min(100, Math.round((load / m.cpus) * 800) / 10), totalMb: m.totalMb, availableMb: m.availableMb, swapTotalMb: 8192, swapFreeMb: 6350, disks: [{ label: 'System disk', totalMb: 153_600, freeMb: 63_400 }], programs: capPrograms(programs), orphans: orphan, measured: true };
    },
    stopOrphan: async (pid: number) => {
      if (pid !== 41_000 || stopped.has(pid)) throw new HttpError(409, `Process ${pid} is gone or no longer left over from an ended session.`);
      stopped.add(pid);
    },
    /** A made-up day: memory climbing through the working hours, swap behind it, load with the sessions. */
    serverSeed: (): ServerPoint[] => {
      const now = Date.now();
      const out: ServerPoint[] = [];
      for (let at = now - TREND_MS + POINT_MS; at < now; at += POINT_MS) {
        const h = ((at / 3_600_000) % 24) / 24;
        const day = Math.max(0, Math.sin((h - 0.25) * Math.PI * 2));
        const noise = Math.sin(at / 420_000) * 3;
        out.push({ at, memPct: Math.round(38 + day * 30 + noise), swapPct: Math.round(14 + day * 12), loadPct: Math.round(25 + day * 120 + noise * 4) });
      }
      return out;
    },
  };
}
