import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { PRACTICES_OFF } from '../shared/practices.ts';

// The version-control practices (#24) in a demo office: Every project's defaults and a floor's overrides, the lab's
// one tap to make a variant the default, what agents are told, and leases holding back an overlapping issue.

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const repo = await swarm.connectRepo('demo-co/pixel-todo');
  await swarm.syncRepo(repo.id);
  const floor = () => swarm.snapshot().repos.find((r) => r.id === repo.id)!;
  return { swarm, repo, floor };
}

describe('version-control practices in the office', () => {
  it('starts with every switch off, and a floor inherits Every project unless it overrides it', async () => {
    const { swarm, repo, floor } = await office();
    expect(floor().practices).toEqual(PRACTICES_OFF);
    swarm.updateSettings({ everyProject: { practices: { ...PRACTICES_OFF, upToDate: true, diffBudget: 400 } } });
    expect(floor().practices).toMatchObject({ upToDate: true, diffBudget: 400 });
    swarm.updateRepo(repo.id, { practices: { upToDate: false } });
    expect(floor().practices).toMatchObject({ upToDate: false, diffBudget: 400 });
    expect(floor().practiceOverrides).toEqual({ upToDate: false });
    swarm.updateRepo(repo.id, { practices: { upToDate: null } });
    expect(floor().practices?.upToDate).toBe(true);
    expect(() => swarm.updateRepo(repo.id, { practices: { leases: 'yes' } })).toThrow(/true or false/);
  });

  it('tells agents what the switches add, and nothing with them off', async () => {
    const { swarm, repo } = await office();
    const agent = swarm.snapshot().agents.find((a) => a.repoId === repo.id)!;
    const text = () => swarm.agentPrompt(agent.id).parts.map((p) => p.text).join('\n');
    const before = text();
    expect(before).not.toMatch(/Diff budget|Generated files/);
    swarm.updateSettings({ everyProject: { practices: { ...PRACTICES_OFF, diffBudget: 300, generated: ['docs/coverage.md'] } } });
    expect(text()).toMatch(/Diff budget: 300 lines/);
    expect(text()).toMatch(/diff budget is 300 lines/); // QA's line
    expect(text()).toMatch(/Generated files: docs\/coverage\.md/);
    swarm.updateSettings({ everyProject: { practices: PRACTICES_OFF } });
    expect(text()).toBe(before);
  });

  it("makes a stopped experiment's variant every project's default, only when asked and with the evidence", async () => {
    const { swarm, floor } = await office();
    swarm.lab.act('small-prs', 'start');
    expect(() => swarm.adoptPractices('small-prs', 'b')).toThrow(/Stop it/);
    swarm.lab.act('small-prs', 'stop');
    swarm.adoptPractices('small-prs', 'b');
    expect(swarm.snapshot().settings.everyProject.practices.diffBudget).toBe(400);
    expect(floor().practices?.diffBudget).toBe(400);
    expect(swarm.snapshot().messages.at(-1)?.text).toMatch(/400-line PR budget[\s\S]*evidence/);
  });

  it('holds back an issue whose files overlap work in flight, and shows the lease', async () => {
    const { swarm, repo, floor } = await office();
    swarm.hireAgent(repo.id, { name: 'Bo' });
    swarm.updateRepo(repo.id, { practices: { leases: true }, autoAssign: true });
    await swarm.syncRepo(repo.id);
    (swarm as unknown as { schedule(): void }).schedule();
    const busy = swarm.snapshot().agents.filter((a) => a.repoId === repo.id && a.issueNumber != null).map((a) => a.issueNumber);
    // #1 (src/App.tsx) and #2 (src/App.tsx) overlap: only one of them starts, and the other one waits for it.
    expect(busy).toContain(1);
    expect(busy).not.toContain(2);
    expect(floor().leases?.find((l) => l.issue === 1)?.files).toEqual(['src/App.tsx', 'src/styles.css']);
    expect(floor().leaseHolds?.find((h) => h.issue === 2)).toMatchObject({ by: { issue: 1 }, files: ['src/App.tsx'] });
  });

  it('with leases off, hands out issues in order as before', async () => {
    const { swarm, repo } = await office();
    swarm.hireAgent(repo.id, { name: 'Bo' });
    swarm.updateRepo(repo.id, { autoAssign: true });
    await swarm.syncRepo(repo.id);
    (swarm as unknown as { schedule(): void }).schedule();
    const busy = swarm.snapshot().agents.filter((a) => a.repoId === repo.id && a.issueNumber != null).map((a) => a.issueNumber);
    expect(busy.sort((x, y) => x! - y!)).toEqual([1, 2]);
  });
});
