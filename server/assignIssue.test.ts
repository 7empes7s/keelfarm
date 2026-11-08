import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CEO_ID, type ManagerChange } from '../shared/types.ts';
import { createDemoBackend } from './demo.ts';
import { ceoSession } from './demo/ceo.ts';
import type { SessionOptions } from './agentRunner.ts';
import { Swarm } from './swarm.ts';

// Assign to… (#265): a free agent starts the issue now; a busy one gets it as their next task, and keeps working.

type Agent = { id: string; name: string; role: string; status: string; task: string | null; issueNumber: number | null; nextIssue?: number | null; repoId: string; startedAt: number | null };
type Internals = {
  state: { agents: Agent[]; repos: { id: string; floor: number; autoAssign: boolean }[]; ceo: { queue: unknown[]; changes: { list: ManagerChange[] } } };
  repoRt: Map<string, { issues: { number: number }[]; pulls: { state: string; closesIssues: number[] }[] }>;
  startQueuedWork(repo: unknown): boolean;
  readyIssues(repo: unknown): { issue: { number: number } }[];
  officeTools(): { call(name: string, args: Record<string, unknown>): Promise<string> };
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
  const [first, second, third] = rt.issues.map((x) => x.number).filter((n) => !rt.pulls.some((p) => p.state === 'OPEN' && p.closesIssues.includes(n)));
  const worker = i.state.agents.find((a) => a.role !== 'ceo' && a.repoId === repo.id)!;
  const r = i.state.repos.find((x) => x.id === repo.id)!;
  r.autoAssign = false;
  return { swarm, i, repo: r, worker, first, second, third };
}

const busy = (a: Agent, issue: number) => Object.assign(a, { status: 'working', task: 'issue', issueNumber: issue, startedAt: Date.now() });

describe('Assign to… (#265)', () => {
  it('a free agent starts the issue now, and the CEO hears of it as a change that touched no running work', async () => {
    const { swarm, i, repo, worker, first } = await office();
    worker.status = 'idle';
    const out = await swarm.assignIssue(repo.id, first, worker.name);
    expect(out.started).toBe(true);
    expect(worker).toMatchObject({ status: 'preparing', issueNumber: first });
    expect(worker.nextIssue ?? null).toBeNull();
    expect(i.state.ceo.changes.list.at(-1)).toMatchObject({ kind: 'assign', issue: first, affects: [] });
    expect(i.state.ceo.changes.list.at(-1)?.detail).toContain('starts now');
  });

  it("a busy agent keeps working and gets it as their next task, which nobody else is given, and starts it once free", async () => {
    const { swarm, i, repo, worker, first, second } = await office();
    busy(worker, first);
    const out = await swarm.assignIssue(repo.id, second, worker.id);
    expect(out.started).toBe(false);
    expect(worker).toMatchObject({ status: 'working', issueNumber: first, nextIssue: second }); // running work isn't stopped
    expect(swarm.snapshot().agents.find((a) => a.id === worker.id)?.nextIssue).toBe(second);
    expect(i.state.ceo.changes.list.at(-1)?.detail).toContain(`next, after issue #${first}`);
    expect(i.readyIssues(repo).map((r) => r.issue.number)).not.toContain(second); // auto-assign leaves it for them
    expect(i.startQueuedWork(repo)).toBe(false); // still busy
    worker.status = 'done';
    expect(i.startQueuedWork(repo)).toBe(true);
    expect(worker).toMatchObject({ status: 'preparing', issueNumber: second, nextIssue: null });
  });

  it('a next task someone else started meanwhile is dropped, not built twice', async () => {
    const { swarm, i, repo, worker, first, second } = await office();
    busy(worker, first);
    await swarm.assignIssue(repo.id, second, worker.name);
    const hired = swarm.hireAgent(repo.id, { name: 'Zed', strict: true });
    const other = i.state.agents.find((a) => a.id === hired.id)!;
    busy(other, second);
    worker.status = 'done';
    expect(i.startQueuedWork(repo)).toBe(false);
    expect(worker.nextIssue).toBeNull();
    expect(worker.status).toBe('done');
  });

  it('assign_issue: the CEO puts the next free agent on an issue, or queues it, with clear refusals', async () => {
    const { i, repo, worker, first, second, third } = await office();
    busy(worker, first);
    const tools = i.officeTools();
    expect(await tools.call('assign_issue', { floor: repo.floor, number: second })).toBe(`${worker.name} takes #${second} after issue #${first}.`);
    expect(worker.nextIssue).toBe(second);
    expect(await tools.call('assign_issue', { floor: repo.floor, number: third, agent: worker.name })).toBe(`${worker.name} takes #${third} after issue #${first}, instead of #${second}.`);
    expect(i.state.ceo.changes.list.filter((c) => c.kind === 'assign')).toEqual([]); // the CEO's own act isn't a manager's change
    expect(await tools.call('assign_issue', { floor: repo.floor, number: first, agent: 'next free' })).toBe(`Refused: ${worker.name} is already working on #${first}.`);
    expect(await tools.call('assign_issue', { floor: repo.floor, number: second, agent: 'Nobody' })).toMatch(/^Refused: No agent "Nobody" on this floor\. Agents here: .*"next free"\.$/);
    expect(await tools.call('assign_issue', { floor: repo.floor, number: 99999 })).toBe('Refused: Issue #99999 is not open on demo-co/pixel-todo.');
    expect(await tools.call('assign_issue', { floor: 42, number: second })).toMatch(/^Refused: There is no floor 42\./);
    expect(await tools.call('assign_issue', { floor: repo.floor, number: -1 })).toMatch(/^Refused|error|Invalid/i);
  });

  it("the demo CEO's chat puts an agent on an issue through assign_issue, even with the seeded chat's attachment", { timeout: 30_000 }, async () => {
    const { i, worker, first, second } = await office();
    busy(worker, first);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-ceo-assign-')); // where a wrong turn's PDF would land
    const tools = i.officeTools() as SessionOptions['office'];
    const prompt = `The manager says:\nput the freed agent on #${second}\n\nAttached:\n- /store/abc (brief.pdf, application/pdf, 2 KB)`;
    const reply = await new Promise<string>((resolve, reject) =>
      ceoSession({ cwd, prompt, systemAppend: '', model: 'demo', effort: 'low', browserTesting: false, additionalDirectories: [], role: 'ceo', office: tools }, {
        log: () => undefined,
        tool: () => undefined,
        finished: (r: { ok: boolean; text: string; errors: string[] }) => (r.ok ? resolve(r.text) : reject(new Error(r.errors.join(' ')))),
      } as unknown as Parameters<typeof ceoSession>[1]),
    );
    expect(reply).toBe(`Done: ${worker.name} takes #${second} after issue #${first}.`); // not the demo's PDF
    expect(worker.nextIssue).toBe(second);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
