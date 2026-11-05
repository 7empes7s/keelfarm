import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionOptions } from './agentRunner.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// The test lab in a demo office (#56): builders get the lab's tools instead of a browser of their own, the fake lab
// answers them, and the lab desk's view says what it did.

async function firstSession(enabled: boolean) {
  const backend = createDemoBackend();
  const seen: SessionOptions[] = [];
  const start = backend.startSession;
  backend.startSession = (opts, cb) => (seen.push(opts), start(opts, cb));
  const swarm = new Swarm(backend);
  swarm.updateSettings({ testLab: { enabled, browserJobs: 1, heavyJobs: 1 } });
  await swarm.connectRepo('demo-co/pixel-todo');
  let issue: number | undefined;
  for (let i = 0; i < 100 && !issue; i++) {
    await new Promise((r) => setTimeout(r, 100));
    issue = swarm.snapshot().repos[0].issues[0]?.number;
  }
  const agent = swarm.snapshot().agents.find((a) => a.role !== 'ceo')!;
  await swarm.assign(agent.id, issue!);
  for (let i = 0; i < 100 && !seen.some((o) => o.role !== 'ceo'); i++) await new Promise((r) => setTimeout(r, 100));
  return { swarm, opts: seen.find((o) => o.role !== 'ceo')! };
}

describe('a demo office with the test lab', () => {
  it("gives builders the lab's tools and no browser of their own, and the fake lab answers", async () => {
    const { swarm, opts } = await firstSession(true);
    expect(opts.browserTesting).toBe(false);
    expect(opts.systemAppend).toMatch(/lab_screenshot and lab_browser_check/);
    const report = await opts.office!.call('lab_screenshot', { url: 'http://localhost:5678/', viewports: [390, 1280] });
    expect(report).toMatch(/^2 screenshots/);
    const file = report.split('\n')[1].split(': ')[1];
    expect(file.startsWith(path.join(opts.cwd, '.lab'))).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(path.join(opts.cwd, '.lab', '.gitignore'), 'utf8')).toBe('*\n');
    const lab = swarm.snapshot().testLab!;
    expect(lab.recent[0]).toMatchObject({ kind: 'screenshot', ok: true, shot: true });
    expect(swarm.testLab.shotFile(lab.recent[0].id)).toBe(file);
    expect(await opts.office!.call('lab_run', { command: 'npm run deploy' })).toMatch(/^Refused: "npm run deploy" isn't on this floor's lab allowlist/);
    await swarm.testLab.close();
  }, 20_000);

  it('keeps the Playwright browser when the lab is off', async () => {
    const { opts } = await firstSession(false);
    expect(opts.browserTesting).toBe(true);
    expect(opts.office).toBeUndefined();
    expect(opts.systemAppend).toMatch(/mcp__playwright__browser_navigate/);
  }, 20_000);
});
