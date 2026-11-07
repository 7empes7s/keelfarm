import { describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { TRUST_LABEL } from '../shared/trust.ts';
import type { IssueInfo } from '../shared/types.ts';
import type { PersistedRepo, QaRecord } from './swarm/model.ts';

// Public repo safety (#185) in a demo office: pixel-todo has a stranger's issue and a fork's PR (from a swarm/ branch).

interface Inside {
  readyIssues(repo: PersistedRepo): { issue: IssueInfo }[];
  schedule(): void;
  advanceMerges(repo: PersistedRepo): Promise<void>;
  state: { qa: QaRecord[]; repos: PersistedRepo[] };
}

async function office() {
  const backend = createDemoBackend();
  const swarm = new Swarm(backend);
  const repo = await swarm.connectRepo('demo-co/pixel-todo');
  const floor = () => swarm.snapshot().repos.find((r) => r.id === repo.id)!;
  await vi.waitFor(() => expect(floor().lastSync).not.toBeNull()); // connecting started the first sync
  const stranger = floor().issues.find((i) => i.title === 'Add my analytics snippet')!;
  const fork = floor().pulls.find((p) => p.untrusted)!;
  const inside = swarm as unknown as Inside;
  const persisted = inside.state.repos.find((r) => r.id === repo.id)!;
  return { backend, swarm, repo, floor, stranger, fork, inside, persisted };
}

describe('untrusted issues', () => {
  it('are listed as untrusted and never picked by the scheduler or assigned', async () => {
    const { swarm, repo, stranger, inside, persisted } = await office();
    expect(stranger.untrusted).toBe(true);
    expect(inside.readyIssues(persisted).map((r) => r.issue.number)).not.toContain(stranger.number);
    for (let i = 0; i < 8; i++) swarm.hireAgent(repo.id, { name: `Temp${i}` });
    swarm.updateRepo(repo.id, { autoAssign: true });
    await swarm.syncRepo(repo.id);
    inside.schedule();
    const busy = swarm.snapshot().agents.filter((a) => a.repoId === repo.id && a.issueNumber != null).map((a) => a.issueNumber);
    expect(busy.length).toBeGreaterThan(0);
    expect(busy).not.toContain(stranger.number);
    const agent = swarm.snapshot().agents.find((a) => a.repoId === repo.id && a.role !== 'ceo' && a.issueNumber == null)!;
    await expect(swarm.assign(agent.id, stranger.number)).rejects.toThrow(/isn't trusted/);
  });

  it("can be trusted from the floor's allow-list", async () => {
    const { swarm, repo, floor, stranger } = await office();
    expect(stranger.untrusted).toBe(true);
    swarm.updateRepo(repo.id, { trustedAuthors: 'drive-by-dev' } as never); // and syncs
    await vi.waitFor(() => expect(floor().issues.find((i) => i.number === stranger.number)?.untrusted).toBeUndefined());
    expect(() => swarm.updateRepo(repo.id, { trustedAuthors: ['no spaces'] } as never)).toThrow(/not a GitHub login/);
  });

  it("let in by the manager's Trust this issue, which the office's own user labels", async () => {
    const { swarm, repo, floor, stranger, inside, persisted } = await office();
    await swarm.trustIssue(repo.id, stranger.number);
    const now = floor().issues.find((i) => i.number === stranger.number)!;
    expect(now).toMatchObject({ labels: [TRUST_LABEL], trustedBy: 'demo-manager' });
    expect(now.untrusted).toBeUndefined();
    expect(inside.readyIssues(persisted).map((r) => r.issue.number)).toContain(stranger.number);
    expect(swarm.snapshot().messages.at(-1)?.text).toMatch(/trusted #\d+ .* by @drive-by-dev/);
  });
});

describe('PRs from outside', () => {
  it('are never queued for QA, sent to QA, sent back, previewed or merged', async () => {
    const { swarm, repo, fork, inside } = await office();
    expect(fork).toMatchObject({ untrusted: true, headRefName: expect.stringMatching(/^swarm\//) });
    expect(inside.state.qa.some((q) => q.prNumber === fork.number)).toBe(false);
    await expect(swarm.sendToQa(repo.id, fork.number)).rejects.toThrow(/from outside/);
    await expect(swarm.sendBackToDev(repo.id, fork.number)).rejects.toThrow(/from outside/);
    await expect(swarm.mergePull(repo.id, fork.number)).rejects.toThrow(/from outside/);
    expect(() => swarm.startPrPreview(repo.id, fork.number)).toThrow(/from outside/);
  });

  it('are never auto-merged, even with a passed QA record', async () => {
    const { backend, swarm, repo, fork, inside, persisted } = await office();
    inside.state.qa.push({ repoId: repo.id, prNumber: fork.number, status: 'passed', round: 1, updatedAt: 0, passedSha: fork.headSha, testedSha: fork.headSha, mergeFixes: 0, retests: 0 } as unknown as QaRecord);
    const merge = vi.spyOn(backend, 'mergePull');
    swarm.updateRepo(repo.id, { autoMerge: true });
    await inside.advanceMerges(persisted);
    expect(merge).not.toHaveBeenCalled();
  });
});
