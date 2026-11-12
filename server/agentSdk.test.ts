import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SdkRelease } from '../shared/agentSdk.ts';
import { HOME_DIR } from './config.ts';
import { createDemoBackend } from './demo.ts';
import type { Backend } from './backend.ts';
import type { SessionResult } from './agentRunner.ts';
import { Swarm } from './swarm.ts';

// The daily Agent SDK check (#569) with a faked registry and the demo's fake GitHub: one bump issue on the office's
// own floor when behind, none when up to date, in flight or when the registry can't be read; a session failing for
// want of a newer Claude Code starts it and tells the manager once.

const OLD: SdkRelease = { version: '0.3.283', claudeCode: '2.1.283' };
const NEW: SdkRelease = { version: '0.3.330', claudeCode: '2.1.330' };
const OWN = 'demo-co/pixel-todo'; // the demo's own floor (server/demo/office.ts)

type Agent = { id: string; role: string; repoId: string; model: string; task: string | null; issueNumber: number | null };
type Internals = {
  state: { agents: Agent[]; messages: { from: string; text: string }[] };
  repoRt: Map<string, { issues: { number: number; title: string }[] }>;
  sdkRun: Promise<unknown>;
  onFinished(a: Agent, repo: unknown, ran: SessionResult): Promise<void>;
};

// The demo's fake GitHub lives as long as the test file: each test closes the bump issues it filed.
const cleanup: (() => Promise<void>)[] = [];
beforeEach(() => fs.rmSync(path.join(HOME_DIR, 'agent-sdk.json'), { force: true }));
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c();
  vi.restoreAllMocks();
});

async function office(registry: () => Promise<SdkRelease>, installed: SdkRelease = OLD) {
  const backend = createDemoBackend();
  const filed: string[] = [];
  const fake: Backend = {
    ...backend,
    agentSdk: { installed: () => installed, latest: registry },
    createIssue: async (fullName, title, body, labels) => {
      filed.push(`${fullName}: ${title}`);
      const n = await backend.createIssue(fullName, title, body, labels);
      cleanup.push(() => backend.closeIssue(fullName, n, 'test done'));
      return n;
    },
  };
  const swarm = new Swarm(fake);
  const repo = await swarm.connectRepo(OWN);
  const i = swarm as unknown as Internals;
  for (let n = 0; n < 100 && !i.repoRt.get(repo.id)?.issues.length; n++) await new Promise((r) => setTimeout(r, 100)); // the first sync
  return { swarm, i, repo, filed };
}

describe('the daily Agent SDK check (#569)', () => {
  it('behind: one bump issue on the office floor, and a second check files no duplicate', async () => {
    const { swarm, i, repo, filed } = await office(async () => NEW);
    const view = await swarm.checkAgentSdk();
    expect(filed).toEqual([`${OWN}: Bump the Agent SDK to 0.3.330 (Claude Code 2.1.330)`]);
    expect(view).toMatchObject({ behind: true, latest: NEW, error: null, alarm: null, bump: { floor: repo.floor } });
    expect(i.repoRt.get(repo.id)!.issues.some((x) => x.number === view.bump!.issue)).toBe(true);
    await swarm.checkAgentSdk();
    expect(filed).toHaveLength(1);
  });

  it('up to date: nothing filed', async () => {
    const { swarm, filed } = await office(async () => NEW, NEW);
    expect(await swarm.checkAgentSdk()).toMatchObject({ behind: false, bump: null, alarm: null });
    expect(filed).toEqual([]);
  });

  it('a registry error: no issue, and the reason logged and shown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.writeFileSync(path.join(HOME_DIR, 'agent-sdk.json'), JSON.stringify({ checkedAt: 1, latest: NEW })); // yesterday's check saw a newer one
    const { swarm, filed } = await office(async () => {
      throw new Error('the npm registry answered 503');
    });
    expect(await swarm.checkAgentSdk()).toMatchObject({ error: 'the npm registry answered 503', bump: null });
    expect(filed).toEqual([]);
    expect(warn).toHaveBeenCalledWith('agent SDK check: the npm registry answered 503; no bump filed');
  });

  it('a session failing because its model needs a newer Claude Code starts the bump, and the manager hears it once', async () => {
    const { i, repo, filed } = await office(async () => NEW);
    const worker = i.state.agents.find((a) => a.role !== 'ceo' && a.repoId === repo.id)!;
    worker.model = 'claude-fable-5-2';
    const failed: SessionResult = { ok: false, text: '', costUsd: 0, turns: 1, errors: ['API Error: 400 Claude Code 2.1.283 does not support this model; version 2.1.290 or newer is required.'] };
    const r = (swarm: Internals) => swarm.state.messages.filter((m) => m.from === 'office' && m.text === 'Fable 5.2 needs a newer built-in Claude; updating.');
    await i.onFinished({ ...worker, task: 'issue', issueNumber: null }, repo, failed).catch(() => {});
    await i.sdkRun;
    expect(filed).toHaveLength(1);
    expect(r(i)).toHaveLength(1);
    await i.onFinished({ ...worker, task: 'issue', issueNumber: null }, repo, failed).catch(() => {});
    await i.sdkRun;
    expect(filed).toHaveLength(1);
    expect(r(i)).toHaveLength(1);
  });
});
