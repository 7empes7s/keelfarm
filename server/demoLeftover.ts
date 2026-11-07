import http from 'node:http';
import { PREVIEW_PORT } from './config.ts';
import type { ProcInfo } from './previewPids.ts';

// The demo's leftover on a preview port (#225). SWARM_DEMO_LEFTOVER=ours listens on floor 1's preview port as a preview
// the office left running before a restart would (its folder is floor 1's preview worktree), so the next start reclaims
// it; =foreign as someone else's program, so the start names it and offers another port.

const PID = 43_210;
const STARTED = Date.now() - 3_600_000;

let held: { port: number; server: http.Server; cwd: () => string } | null = null;

/** Start the leftover, if SWARM_DEMO_LEFTOVER asks for one. `desk`: floor 1's preview worktree, asked when it's looked at. */
export function holdDemoPort(desk: () => string) {
  const mode = process.env.SWARM_DEMO_LEFTOVER;
  if (mode !== 'ours' && mode !== 'foreign') return;
  const port = PREVIEW_PORT + 1;
  const server = http.createServer((_req, res) => res.end('a leftover app'));
  server.once('error', () => (held = null));
  server.listen(port, '127.0.0.1');
  held = { port, server, cwd: mode === 'ours' ? desk : () => '/home/someone/other-app' };
}

const info = (): ProcInfo | null => (held ? { pid: PID, pgid: PID, command: 'node', startedAt: STARTED, cwd: held.cwd() } : null);

export const demoPortOwner = async (port: number) => (held?.port === port ? info() : null);
export const demoProc = async (pid: number) => (pid === PID ? info() : null);

export async function demoKill(p: Pick<ProcInfo, 'pid'>) {
  if (!held || p.pid !== PID) return;
  const s = held.server;
  held = null;
  s.closeAllConnections();
  await new Promise<void>((resolve) => s.close(() => resolve()));
}
