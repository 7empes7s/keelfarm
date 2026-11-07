import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CEO_ID, type ManagerChange } from '../shared/types.ts';
import { CHANGES_DEBOUNCE_MS } from '../shared/managerChanges.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// The manager acts, the CEO decides (#207): board actions happen at once but never stop a running agent themselves.

type Agent = { id: string; role: string; status: string; task: string | null; issueNumber: number | null; prNumber: number | null; branch: string | null; repoId: string };
type Internals = {
  state: { agents: Agent[]; ceo: { queue: { kind: string }[]; changes: { list: ManagerChange[]; wakeAt: number | null } } };
  repoRt: Map<string, { issues: { number: number }[]; pulls: { state: string; closesIssues: number[] }[] }>;
  maybeChanges(): void;
  takeChanges(job: { kind: string }): string;
  ensureCeo(interrupted: unknown[]): void;
};

let open: Swarm[] = [];
afterEach(() => {
  for (const s of open) s.stopAgent(CEO_ID);
  open = [];
});

async function office() {
  const swarm = new Swarm(createDemoBackend());
  open.push(swarm);
  const repo = await swarm.connectRepo('demo-co/pixel-todo');
  const i = swarm as unknown as Internals;
  for (let n = 0; n < 100 && !i.repoRt.get(repo.id)?.issues.length; n++) await new Promise((r) => setTimeout(r, 100)); // the first sync
  i.ensureCeo([]);
  i.state.ceo.queue = [];
  const rt = i.repoRt.get(repo.id)!;
  const [first, second] = rt.issues.map((x) => x.number).filter((n) => !rt.pulls.some((p) => p.state === 'OPEN' && p.closesIssues.includes(n)));
  const worker = i.state.agents.find((a) => a.role !== 'ceo')!;
  Object.assign(worker, { status: 'working', task: 'issue', issueNumber: first, prNumber: null, branch: `swarm/issue-${first}-x` });
  return { swarm, i, repo, worker, first, second };
}

describe("the manager's board actions", () => {
  it("closing an issue someone is building doesn't stop them: a change with affects=[them] wakes the CEO", async () => {
    const { swarm, i, repo, worker, first } = await office();
    await swarm.closeIssueByManager(repo.id, first);
    expect(worker.status).toBe('working');
    expect(worker.issueNumber).toBe(first);
    expect(i.state.ceo.changes.list).toMatchObject([{ kind: 'close-issue', issue: first, affects: [worker.id], verdict: null }]);
    expect(swarm.snapshot().agents.find((a) => a.id === worker.id)?.reviewedBy).toBeTruthy(); // "… is reviewing your change"
    expect(i.state.ceo.changes.wakeAt).not.toBeNull();
  });

  it('a burst of changes that touched running work is one CEO job, after the debounce', async () => {
    const { swarm, i, repo, worker, first, second } = await office();
    const hired = swarm.hireAgent(repo.id, { name: 'Zed', strict: true });
    const other = i.state.agents.find((a) => a.id === hired.id)!;
    Object.assign(other, { status: 'working', task: 'issue', issueNumber: second, repoId: worker.repoId });
    await swarm.closeIssueByManager(repo.id, first);
    await swarm.closeIssueByManager(repo.id, second);
    i.maybeChanges();
    expect(i.state.ceo.queue).toEqual([]); // still within 60 s of the last one
    i.state.ceo.changes.wakeAt = Date.now() - 1; // the debounce ran out
    i.maybeChanges();
    i.maybeChanges();
    expect(i.state.ceo.queue.map((j) => j.kind)).toEqual(['changes']);
    expect(i.takeChanges({ kind: 'review' })).toBe(''); // another job never decides for the changes job
    const block = i.takeChanges({ kind: 'changes' });
    expect(block).toContain(`closed #${first}`);
    expect(block).toContain(`closed #${second}`);
    expect(CHANGES_DEBOUNCE_MS).toBe(60_000);
  });

  it("changes that touched no running work wake nobody and go into the CEO's next job", async () => {
    const { swarm, i, repo, worker, second } = await office();
    worker.status = 'idle';
    await swarm.closeIssueByManager(repo.id, second);
    expect(i.state.ceo.changes.wakeAt).toBeNull();
    i.maybeChanges();
    expect(i.state.ceo.queue).toEqual([]);
    expect(i.takeChanges({ kind: 'review' })).toContain(`Your changes since last time`);
    expect(i.takeChanges({ kind: 'review' })).toBe(''); // told once
  });

  it("the agent's own Stop still stops at once", async () => {
    const { swarm, worker } = await office();
    swarm.stopAgent(worker.id);
    expect(worker.status).toBe('stopped');
  });

  it('no board or preview route calls stopAgent: only the agent\'s own Stop does', () => {
    const index = fs.readFileSync(path.join(import.meta.dirname, 'index.ts'), 'utf8');
    expect(index.split('\n').filter((l) => /stopAgent\(/.test(l))).toEqual([expect.stringContaining("'/api/agents/:id/stop'")]);
    for (const file of ['repos.ts', 'qa.ts']) {
      const src = fs.readFileSync(path.join(import.meta.dirname, 'swarm', file), 'utf8');
      expect(src, file).not.toMatch(/stopAgent\(|stopForClosure\(/);
    }
  });
});
