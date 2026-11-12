// The server's load by program (#271, server/serverLoad.ts): who's who for the grouping (agents' folders and whether
// their session is live, the previews running, the office's own processes), the reading every 15 s out to the tabs,
// the 24 h trend behind GET /api/server/trend, and Mission control's "Stop it" for a process an ended session left.
import path from 'node:path';
import { SAMPLE_MS, type ServerPoint } from '../../shared/serverLoad.ts';
import type { WorldSnapshot } from '../../shared/types.ts';
import { HttpError } from '../httpError.ts';
import { keeperPid } from '../ptyClient.ts';
import { ServerLoad, type LoadContext } from '../serverLoad.ts';
import { MACHINES_DIR } from '../workspace.ts';
import { BUSY, CEO_DIR } from './model.ts';
import { SwarmVoices } from './voices.ts';

export abstract class SwarmServerLoad extends SwarmVoices {
  readonly serverLoad = new ServerLoad({
    read: (ctx) => this.backend.resources.server(ctx),
    seed: () => this.backend.resources.serverSeed(),
    context: () => this.loadContext(),
    emit: (serverLoad) => this.broadcast({ type: 'serverLoad', serverLoad }),
    save: (points) => this.backend.resources.serverSave?.(points),
  });

  override snapshot(): WorldSnapshot {
    return { ...super.snapshot(), serverLoad: this.serverLoad.view() };
  }

  /** Started with the usage readings, once from init. */
  protected override async startUsage() {
    void this.serverLoad.tick();
    setInterval(() => void this.serverLoad.tick(), SAMPLE_MS).unref();
    await super.startUsage();
  }

  protected loadContext(): LoadContext {
    const launcher = process.env.SWARM_LAUNCHER === '1' ? [process.ppid] : [];
    const agents = this.state.agents
      .filter((a) => a.host !== 'box') // a cloud agent's processes run in their Box
      .map((a) => {
        const repo = this.state.repos.find((r) => r.id === a.repoId); // none for the CEO
        const dirs = a.role === 'ceo' ? [CEO_DIR] : a.machine ? [path.join(MACHINES_DIR, a.machine)] : repo ? [this.deskOf(a, repo)] : [];
        return { id: a.id, name: a.name, machine: a.machine ?? null, dirs, live: BUSY.includes(a.status) || !!this.agentRt.get(a.id)?.session };
      });
    const previews = this.previews.running().flatMap((p) => {
      const [repoId, which] = [p.key.slice(0, p.key.lastIndexOf('#')), p.key.slice(p.key.lastIndexOf('#') + 1)];
      const floor = this.state.repos.find((r) => r.id === repoId)?.floor;
      if (floor === undefined) return [];
      const pr = which === 'main' ? '' : ` #${which}`;
      return [{ key: p.key, dir: p.dir, name: `Preview · floor ${floor}${pr && ` PR${pr}`}`, ref: `preview: floor ${floor}${pr}` }];
    });
    return { officePids: [process.pid, keeperPid(), ...launcher].filter((p) => p > 0), machinesDir: MACHINES_DIR, agents, previews };
  }

  /** The 24 h trend, 1-minute points (kept on disk every 10 minutes). */
  serverTrend(): ServerPoint[] {
    return this.serverLoad.points();
  }

  /** Mission control's "Stop it": a process left in an agent's worktree after their session ended, and what it started. */
  async stopOrphan(pid: unknown) {
    if (!Number.isInteger(pid) || (pid as number) <= 1) throw new HttpError(400, 'Which process? Send its pid.');
    await this.backend.resources.stopOrphan(pid as number, this.loadContext());
    console.log(`server load: stopped pid ${pid}, left by an ended session`);
    await this.serverLoad.tick();
  }
}
