import { describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { repos } from './demo/world.ts';
import { Swarm } from './swarm.ts';
import type { PullInfo } from '../shared/types.ts';
import type { PersistedAgent, PersistedRepo, QaRecord } from './swarm/model.ts';

// #632 in a demo office: the manager's own PR on a fix/ branch (seeded on weather-api) goes through QA, its fix rounds
// push to that branch, and it merges once it passed; drafts, forks, untrusted authors and `manual` ones are left alone.

const FULL = 'demo-co/weather-api';
interface Inside {
  state: { qa: QaRecord[]; repos: PersistedRepo[]; agents: PersistedAgent[] };
  repoRt: Map<string, { syncing?: boolean; pulls: PullInfo[] }>;
  advanceMerges(repo: PersistedRepo): Promise<void>;
  runFix(dev: PersistedAgent, repo: PersistedRepo, rec: QaRecord): Promise<void>;
}

async function office() {
  const backend = createDemoBackend();
  const merges = vi.spyOn(backend, 'mergePull');
  const desks = vi.spyOn(backend.machines, 'prepareDesk');
  const sessions = vi.spyOn(backend, 'startSession');
  const swarm = new Swarm(backend);
  const repo = await swarm.connectRepo(FULL);
  const inside = swarm as unknown as Inside;
  await vi.waitFor(() => expect(swarm.snapshot().repos.find((r) => r.id === repo.id)?.lastSync).not.toBeNull());
  const pulls = repos.get(FULL)!.pulls;
  const pull = (head: string) => pulls.find((p) => p.headRefName === head && p.state === 'OPEN')!;
  const qa = (n: number) => inside.state.qa.find((q) => q.repoId === repo.id && q.prNumber === n);
  const persisted = () => inside.state.repos.find((r) => r.id === repo.id)!;
  const rt = () => inside.repoRt.get(repo.id)!;
  // A sync of its own (not one already running), and proof it saw the PR as it is now.
  const sync = async (pr: PullInfo) => {
    await vi.waitFor(() => expect(rt().syncing).toBeFalsy());
    await swarm.syncRepo(repo.id);
    const seen = rt().pulls.find((p) => p.number === pr.number)!;
    expect([seen.isDraft, seen.isCrossRepository, !!seen.manual]).toEqual([pr.isDraft, pr.isCrossRepository, !!pr.manual]);
  };
  const drop = (n: number) => (inside.state.qa = inside.state.qa.filter((q) => q.prNumber !== n));
  return { swarm, repo, inside, pull, qa, persisted, rt, sync, drop, merges, desks, sessions };
}

describe("the office owns every trusted PR, not only swarm/ branches (#632)", () => {
  it('queues a trusted fix/ PR for QA, but not a draft or a fork', async () => {
    const { pull, qa, sync, drop } = await office();
    const fix = pull('fix/unknown-city-404');
    expect(qa(fix.number)).toBeDefined();
    drop(fix.number);
    fix.isDraft = true;
    await sync(fix);
    expect(qa(fix.number)).toBeUndefined();
    Object.assign(fix, { isDraft: false, isCrossRepository: true }); // a fork's (#185)
    await sync(fix);
    expect(qa(fix.number)).toBeUndefined();
    fix.isCrossRepository = false;
    await sync(fix);
    expect(qa(fix.number)).toBeDefined();
  });

  it("leaves a manual-labelled PR alone, every non-swarm PR when the floor says so, and an untrusted author's", async () => {
    const { swarm, repo, pull, qa, rt, sync, drop } = await office();
    const fix = pull('fix/unknown-city-404');
    drop(fix.number);
    fix.manual = true;
    await sync(fix);
    expect(qa(fix.number)).toBeUndefined();
    delete fix.manual;
    swarm.updateRepo(repo.id, { leaveOwnPrs: true });
    await sync(fix);
    expect(qa(fix.number)).toBeUndefined();
    expect(swarm.snapshot().repos.find((r) => r.id === repo.id)?.leaveOwnPrs).toBe(true);
    swarm.updateRepo(repo.id, { leaveOwnPrs: false });
    fix.author = 'drive-by-dev'; // an untrusted author on a branch of the repo itself (#185)
    await sync(fix);
    expect(rt().pulls.find((p) => p.number === fix.number)?.untrusted).toBe(true);
    expect(qa(fix.number)).toBeUndefined();
    fix.author = 'demo-manager'; // back to the manager's: the next sync queues it
    await sync(fix);
    expect(qa(fix.number)).toBeDefined();
  });

  it("sends a fix round to the PR's own fix/ branch, never a new PR", async () => {
    const { inside, pull, qa, persisted, desks, sessions } = await office();
    const fix = pull('fix/unknown-city-404');
    const rec = Object.assign(qa(fix.number)!, { status: 'failed', round: 1, summary: 'An unknown city still gets a 500', fixInstructions: 'Return 404 when the city lookup finds nothing.', fixReason: 'qa' });
    const dev = inside.state.agents.find((a) => a.repoId === persisted().id && a.role !== 'ceo' && a.status === 'idle')!;
    await inside.runFix(dev, persisted(), rec);
    expect(desks).toHaveBeenCalledWith(expect.any(String), FULL, expect.objectContaining({ pr: fix.number }), 'fix/unknown-city-404', expect.any(Function));
    const prompt = sessions.mock.calls.at(-1)![0].prompt;
    expect(prompt).toContain('git push origin HEAD:fix/unknown-city-404');
    expect(prompt).toContain('Do not open a new pull request');
  });

  it('auto-merges a fix/ PR once QA passed it with green checks, but never a manual one', async () => {
    const { inside, pull, qa, persisted, merges } = await office();
    const fix = pull('fix/unknown-city-404');
    const rec = qa(fix.number)!;
    fix.manual = true;
    const pass = () => Object.assign(rec, { status: 'passed', passedSha: fix.headSha, updatedAt: 0, qaAgentId: null, ciOutage: null });
    // The office's view of the PR is what the sync saw: mark it there too.
    const listed = () => inside.repoRt.get(persisted().id)!.pulls.find((p) => p.number === fix.number)!;
    pass();
    listed().manual = true;
    await inside.advanceMerges(persisted());
    expect(merges).not.toHaveBeenCalled();
    delete fix.manual;
    delete listed().manual;
    pass();
    await inside.advanceMerges(persisted());
    expect(merges).toHaveBeenCalledWith(FULL, fix.number, expect.anything(), fix.headSha);
  });
});
