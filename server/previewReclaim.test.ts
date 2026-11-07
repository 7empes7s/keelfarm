import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Backend } from './backend.ts';
import { PREVIEW_PORT } from './config.ts';
import type { ProcInfo } from './previewPids.ts';
import type { PreviewCallbacks, PreviewJob } from './previewRunner.ts';
import { Previews, type PreviewFloor } from './previews.ts';

// An office restart with a preview still running (#225): the next run of the office reclaims its own leftover from
// previews.json and starts on the floor's own port; a program that isn't the office's is named, left alone, and the
// floor can move to the next port in its lane. The apps are real sockets on real ports; the processes are pretend.

let root: string;
let pidFile: string;
let apps: Map<number, { server: http.Server; info: ProcInfo }>; // pid -> app
let nextPid: number;

const listen = (port: number) =>
  new Promise<http.Server>((resolve, reject) => {
    const s = http.createServer((_req, res) => res.end('app'));
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });

const close = async (pid: number) => {
  const app = apps.get(pid);
  if (!app) return;
  apps.delete(pid);
  app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
};

const deskDir = (fullName: string, slug: string) => path.join(root, fullName.replace('/', '__'), 'desks', slug);

const backend = {
  deskDir,
  mainDir: (fullName: string) => path.join(root, fullName.replace('/', '__'), 'main'),
  releaseDesk: async () => undefined,
  previews: {
    hasDefault: async () => true,
    start(job: PreviewJob, cb: PreviewCallbacks) {
      const pid = nextPid++;
      void listen(job.port).then(
        (server) => {
          apps.set(pid, { server, info: { pid, pgid: pid, command: 'node', startedAt: Date.now(), cwd: deskDir(job.fullName, job.slug) } });
          cb.spawned?.(pid);
          cb.status('running');
        },
        (err: Error) => cb.failed(err.message),
      );
      return { stop: () => close(pid) };
    },
    portOwner: async (port: number) => [...apps.values()].find((a) => (a.server.address() as { port: number } | null)?.port === port)?.info ?? null,
    proc: async (pid: number) => apps.get(pid)?.info ?? null,
    kill: async (p: { pid: number }) => close(p.pid),
  },
} as unknown as Backend;

const FLOOR = 91; // a port (6391 by default) nothing else in the tests uses
const PORT = PREVIEW_PORT + FLOOR;
const keel: PreviewFloor = { id: 'acme/keel', fullName: 'acme/keel', defaultBranch: 'main', floor: FLOOR, preview: { command: 'node server.js', env: {} } };

const office = () => new Previews(backend, { emit: () => undefined, pulls: () => [], emitPr: () => undefined, prRemoved: () => undefined, note: () => undefined, floors: () => [keel], pidFile });

const settled = async (p: Previews) => {
  for (let i = 0; i < 100 && !['running', 'error'].includes(p.view(keel).status); i++) await new Promise((r) => setTimeout(r, 20));
  return p.view(keel);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'reclaim-'));
  pidFile = path.join(root, 'previews.json');
  apps = new Map();
  nextPid = 50_000;
});

afterEach(async () => {
  for (const pid of apps.keys()) await close(pid);
});

describe('an office restart with a preview still running', () => {
  it('reclaims its own leftover at boot and starts on the floor\'s own port', async () => {
    const before = office();
    await before.start(keel, 'keel app');
    expect((await settled(before)).status).toBe('running');
    const leftover = [...apps.keys()][0];

    const after = office(); // the restart: the old run never stopped its preview
    await after.clearOrphans([keel]);
    expect(apps.has(leftover)).toBe(false);
    await after.start(keel, 'keel app');
    const v = await settled(after);
    expect(v).toMatchObject({ status: 'running', port: PORT, error: null });
  });

  it('reclaims it on the next start too, saying so in the log', async () => {
    const before = office();
    await before.start(keel, 'keel app');
    await settled(before);
    fs.rmSync(pidFile); // not recorded (the first restart after an update): the worktree it runs in still says it's ours

    const after = office();
    await after.start(keel, 'keel app');
    const v = await settled(after);
    expect(v.status).toBe('running');
    expect(v.logTail.join('\n')).toContain(`Port ${PORT} was held by the office's own leftover preview (pid 50000): stopped it.`);
  });

  it("names a program that isn't the office's, leaves it running, and moves to the next free port in the lane", async () => {
    const server = await listen(PORT);
    apps.set(777, { server, info: { pid: 777, pgid: 777, command: 'python3', startedAt: Date.parse('2026-11-07T11:02:00'), cwd: path.join(root, 'someone-else') } });

    const p = office();
    const v = await p.start(keel, 'keel app');
    expect(v.status).toBe('error');
    expect(v.error).toBe(`Port ${PORT} is in use by pid 777 \`python3\`, started 11:02, not the office's. The office won't stop it: use another port, or free this one and try again.`);
    expect(v.portOwner).toMatchObject({ pid: 777, command: 'python3' });
    expect(apps.has(777)).toBe(true);

    await p.start(keel, 'keel app', null, true);
    expect(await settled(p)).toMatchObject({ status: 'running', port: PORT + 100, portOwner: null });
    expect(office().portFor(keel)).toBe(PORT + 100); // remembered across restarts
  });
});
