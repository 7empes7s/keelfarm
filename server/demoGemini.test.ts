import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// A fresh demo office has an agent on Gemini CLI (#365), on the demo's Google AI Plus login.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-demo-gemini-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');

afterAll(() => {
  vi.useRealTimers();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
});

describe('a fresh demo office', () => {
  it('boots with a Gemini CLI agent on floor 1 and a Gemini login for it', { timeout: 60_000 }, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    const swarm = new Swarm(createDemoBackend());
    const init = swarm.init();
    await vi.advanceTimersByTimeAsync(5_000);
    await init;
    const snap = swarm.snapshot();
    const floor1 = snap.repos.find((r) => r.floor === 1)!;
    const gemini = snap.agents.filter((a) => a.cli === 'gemini');
    expect(gemini.map((a) => a.repoId)).toEqual([floor1.id]);
    expect(gemini[0].host).not.toBe('box');
    expect(snap.clis.find((c) => c.id === 'gemini')).toMatchObject({ label: 'Gemini CLI', installed: true });
    expect(snap.accounts?.accounts.find((a) => a.cli === 'gemini')).toMatchObject({ id: 'gemini-plus', kind: 'subscription-login' });
    swarm.updateSettings({ defaultCli: 'gemini' }); // never everyone's default
    expect(swarm.snapshot().settings.defaultCli).toBe('claude');
  });
});
