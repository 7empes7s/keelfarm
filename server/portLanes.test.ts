import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionOptions } from './agentRunner.ts';
import type { Backend } from './backend.ts';
import { createDemoBackend } from './demo.ts';
import { agentPortEnv, agentPorts, agentPreviewBase, DEMO_PREVIEW_PORT, inLiveLanes, LAB_PREVIEW_PORT, liveLaneRefusal, PREVIEW_BLOCK } from './portLanes.ts';
import { Previews, type PreviewFloor } from './previews.ts';
import { MAX_PR_PREVIEWS, prPortCandidates } from './prTheatre.ts';
import { Swarm } from './swarm.ts';

// #227: an agent's (or the lab's) demo office never takes the live office's preview ports.

/** Every port a demo office with this preview base listens on for previews: floors 1-20, then every PR slot's lane. */
const derived = (base: number) => [
  ...Array.from({ length: 20 }, (_, i) => base + 1 + i),
  ...Array.from({ length: MAX_PR_PREVIEWS }, (_, slot) => prPortCandidates(base, slot)).flat(),
];

describe('agent port env', () => {
  it("puts the office and every preview port it derives inside the agent's range, off the live lanes", () => {
    for (let port = 5200; port < 5900; port++) {
      const env = agentPortEnv(port);
      const range = new Set(agentPorts(port));
      expect(Number(env.SWARM_PORT)).toBe(port);
      const base = Number(env.SWARM_PREVIEW_PORT);
      for (const p of derived(base)) {
        expect(range.has(p)).toBe(true);
        expect(inLiveLanes(p)).toBe(false);
        expect(p).toBeLessThan(32_768); // below Linux's ephemeral ports
      }
    }
  });

  it("gives teammates' ports blocks of their own", () => {
    expect(agentPreviewBase(5200)).toBe(10_000);
    expect(agentPreviewBase(5201)).toBe(10_000 + PREVIEW_BLOCK);
    expect(agentPreviewBase(5201)).not.toBe(agentPreviewBase(5202));
  });

  it("keeps the demo's and the lab's own defaults off the live lanes", () => {
    for (const base of [DEMO_PREVIEW_PORT, LAB_PREVIEW_PORT]) for (const p of derived(base)) expect(inLiveLanes(p)).toBe(false);
  });
});

describe("an agent's session", () => {
  it('runs with their reserved port and preview block, so a demo office they start stays on them', async () => {
    const backend = createDemoBackend();
    const seen: SessionOptions[] = [];
    const start = backend.startSession;
    backend.startSession = (opts, cb) => (seen.push(opts), start(opts, cb));
    const swarm = new Swarm(backend);
    await swarm.connectRepo('demo-co/pixel-todo');
    let issue: number | undefined;
    for (let i = 0; i < 100 && !issue; i++) {
      await new Promise((r) => setTimeout(r, 100));
      issue = swarm.snapshot().repos[0].issues[0]?.number;
    }
    const agent = swarm.snapshot().agents.find((a) => a.role !== 'ceo')!;
    await swarm.assign(agent.id, issue!);
    for (let i = 0; i < 100 && !seen.some((o) => o.role !== 'ceo'); i++) await new Promise((r) => setTimeout(r, 100));
    const opts = seen.find((o) => o.role !== 'ceo')!;
    const reserved = Number(opts.systemAppend!.match(/on port (\d+) \(reserved for you/)![1]);
    expect(opts.env).toMatchObject(agentPortEnv(reserved));
  }, 20_000);
});

describe('liveLaneRefusal', () => {
  it('refuses the live lanes in a demo office', () => {
    for (const p of [6300, 6301, 6420, 6499]) expect(liveLaneRefusal(p, true)).toMatch(/live office's preview ports \(6300-6499\)/);
  });

  it('allows other ports, and the live office its own lanes', () => {
    expect(liveLaneRefusal(6299, true)).toBeNull();
    expect(liveLaneRefusal(6500, true)).toBeNull();
    expect(liveLaneRefusal(DEMO_PREVIEW_PORT + 1, true)).toBeNull();
    expect(liveLaneRefusal(6301, false)).toBeNull();
  });
});

describe('a demo office on a live lane', () => {
  let root = '';
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('fails the preview loudly and never starts it', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-'));
    const pidFile = path.join(root, 'previews.json');
    // The floor's port as "Use another port" remembers it: one of the live lanes.
    fs.writeFileSync(pidFile, JSON.stringify({ entries: [], ports: { 'acme/keel': 6488 } }));
    const started: number[] = [];
    const backend = {
      demo: true,
      deskDir: (fullName: string, slug: string) => path.join(root, fullName.replace('/', '__'), 'desks', slug),
      releaseDesk: async () => undefined,
      previews: {
        hasDefault: async () => true,
        start: (job: { port: number }) => {
          started.push(job.port);
          return { stop: async () => undefined };
        },
        portOwner: async () => null,
        proc: async () => null,
        kill: async () => undefined,
      },
    } as unknown as Backend;
    const keel: PreviewFloor = { id: 'acme/keel', fullName: 'acme/keel', defaultBranch: 'main', floor: 1, preview: { command: 'node server.js', env: {} } };
    const p = new Previews(backend, { emit: () => undefined, pulls: () => [], emitPr: () => undefined, prRemoved: () => undefined, note: () => undefined, floors: () => [keel], pidFile });
    const view = await p.start(keel, 'KEEL');
    expect(started).toEqual([]);
    expect(view.status).toBe('error');
    expect(view.error).toMatch(/never uses the live office's preview ports/);
  });
});
