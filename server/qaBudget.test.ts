import { mkdir } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import type { SessionResult } from './agentRunner.ts';
import { HOME_DIR } from './config.ts';
import { createDemoBackend } from './demo.ts';
import { MAX_MERGE_FIXES } from './mergeGate.ts';
import { MAX_QA_ROUNDS } from './qaOutcome.ts';
import { Swarm } from './swarm.ts';
import type { PersistedAgent, PersistedRepo, QaRecord } from './swarm/model.ts';

// Exercise the QA/fix callbacks together so their real record patches cannot silently lose or double-charge the budget.
interface Inside {
  state: { repos: PersistedRepo[]; agents: PersistedAgent[]; qa: QaRecord[] };
  sendBack(repo: PersistedRepo, rec: QaRecord, reason: 'conflict', instructions: string, needsHuman: boolean): boolean;
  schedule(): void;
  ensureCeo(interrupted: PersistedAgent[]): void;
  queueQa(repo: PersistedRepo, number: number, dev: PersistedAgent, issue: number | null): void;
  onQaFinished(agent: PersistedAgent, repo: PersistedRepo, result: SessionResult): Promise<void>;
  onFixFinished(agent: PersistedAgent, repo: PersistedRepo, result: SessionResult): Promise<void>;
}

const success: SessionResult = { ok: true, text: '', errors: [], turns: 1, costUsd: 0 };

it('bounds failed QA with conflicts while keeping conflict-only maintenance free', async () => {
  await mkdir(HOME_DIR, { recursive: true });
  const backend = createDemoBackend();
  const swarm = new Swarm(backend);
  const inside = swarm as unknown as Inside;
  inside.ensureCeo([]);
  vi.spyOn(inside, 'schedule').mockImplementation(() => {}); // no sessions: the callbacks below supply completed rounds
  const view = await swarm.connectRepo('demo-co/pixel-todo');
  await vi.waitFor(() => expect(swarm.snapshot().repos.find((r) => r.id === view.id)?.lastSync).not.toBeNull());
  const repo = inside.state.repos.find((r) => r.id === view.id)!;
  repo.autoAssign = false;
  const pull = swarm.snapshot().repos.find((r) => r.id === view.id)!.pulls.find((p) => p.state === 'OPEN' && !p.untrusted)!;
  const details = await backend.prDetails(repo.fullName, pull.number);
  let head = details.headSha;
  vi.spyOn(backend, 'prDetails').mockImplementation(async () => ({ ...details, headSha: head, mergeable: 'CONFLICTING', mergeState: 'DIRTY' }));
  swarm.hireAgent(repo.id, { name: 'Developer' });
  swarm.hireAgent(repo.id, { name: 'Tester' });
  const dev = inside.state.agents.find((a) => a.repoId === repo.id && a.name === 'Developer')!;
  const tester = inside.state.agents.find((a) => a.repoId === repo.id && a.name === 'Tester')!;
  inside.queueQa(repo, pull.number, dev, null);
  const rec = inside.state.qa.find((q) => q.repoId === repo.id && q.prNumber === pull.number)!;
  for (let attempt = 0; attempt < 20; attempt++) inside.sendBack(repo, rec, 'conflict', 'Merge main.', false);
  expect(rec).toMatchObject({ status: 'failed', mergeFixes: 0, round: 1 });
  const failed: SessionResult = { ...success, structured: { verdict: 'fail', cause: 'bug', summary: 'The button still fails.', checks: [{ name: 'Button works', result: 'fail', details: 'Click has no effect.' }], commands: [], screenshots: [], fixInstructions: 'Wire the button.' } };
  const statuses = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    Object.assign(tester, { prNumber: pull.number, task: 'qa', status: 'working' });
    Object.assign(rec, { status: 'testing', testedSha: head });
    await inside.onQaFinished(tester, repo, failed);
    statuses.push(rec.status);
    if (rec.status === 'needs-human') break;
    expect(rec.passedSha).toBeNull();
    head = `fixed-head-${attempt}`;
    Object.assign(dev, { prNumber: pull.number, task: 'fix', status: 'working' });
    rec.status = 'fixing';
    await inside.onFixFinished(dev, repo, success);
    expect(rec.status).toBe('queued');
  }
  expect(statuses).toEqual([...Array(MAX_QA_ROUNDS + MAX_MERGE_FIXES - 1).fill('failed'), 'needs-human']);
  expect(rec).toMatchObject({ round: MAX_QA_ROUNDS + MAX_MERGE_FIXES, mergeFixes: MAX_MERGE_FIXES, retests: 0, passedSha: null });
  expect(rec.stuckWhy).toContain('failed QA');
});
