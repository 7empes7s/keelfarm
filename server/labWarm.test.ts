import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// The office's start-up browser install (#189) must never take the office down: playwright-core exports its
// package.json but not cli.js, and whatever warm() throws, the office still starts.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-lab-warm-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
const { playwrightCli } = await import('./testLabRunner.ts');

afterAll(() => {
  vi.useRealTimers();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
});

describe("the lab's start-up browser install", () => {
  it("finds playwright-core's CLI through the path its package exports", () => {
    expect(fs.existsSync(playwrightCli())).toBe(true);
    expect(playwrightCli((id) => (id === 'playwright-core/package.json' ? path.join('x', 'playwright-core', 'package.json') : ''))).toBe(path.join('x', 'playwright-core', 'cli.js'));
  });

  it('lets the office start when warm() throws', { timeout: 60_000 }, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    const backend = createDemoBackend({ floors: 1, agents: 2 });
    let called = false;
    backend.testLab.warm = () => {
      called = true;
      throw new Error('Package subpath ./cli.js is not defined by "exports"');
    };
    const init = new Swarm(backend).init();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(init).resolves.toBeUndefined();
    expect(called).toBe(true);
  });
});
