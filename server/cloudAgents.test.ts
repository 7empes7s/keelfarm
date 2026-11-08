import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { DEFAULT_HYBRID } from '../shared/cloud.ts';
import { Swarm } from './swarm.ts';

// Cloud agents (docs/cloud.md) in a demo office: its fake Upstash account takes any key. Agents work on this computer
// unless the manager connects Upstash and asks for the cloud; then they each get a Box.

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const repo = await swarm.connectRepo('demo-co/pixel-todo'); // with its first agent
  const agents = () => swarm.snapshot().agents.filter((a) => a.repoId === repo.id);
  return { swarm, repo, agents };
}

describe('where agents work', () => {
  it('starts on this computer, and the cloud needs an Upstash key first', async () => {
    const { swarm, repo, agents } = await office();
    expect(swarm.snapshot().settings.cloud.machineKind).toBe('local');
    expect(agents()[0].host).toBe('local');
    expect(() => swarm.updateSettings({ cloud: { machineKind: 'box', boxSize: 'small', boxLimit: 10, hybrid: DEFAULT_HYBRID } })).toThrow(/Upstash Box API key/);
    expect(() => swarm.hireAgent(repo.id, { host: 'box', strict: true })).toThrow(/Upstash Box API key/);
  });

  it('hires cloud agents once Upstash is connected, each with a Box of their own', async () => {
    const { swarm, repo, agents } = await office();
    await swarm.setCloudKey('demo-key');
    swarm.updateSettings({ cloud: { machineKind: 'box', boxSize: 'medium', boxLimit: 10, hybrid: DEFAULT_HYBRID } });
    const ada = swarm.hireAgent(repo.id, { name: 'Ada', strict: true });
    expect(ada.host).toBe('box');
    expect(ada.cloud).toMatch(/none|creating/);
    const local = swarm.hireAgent(repo.id, { name: 'Lin', host: 'local', strict: true });
    expect(local.host).toBe('local');
    expect(agents().filter((a) => a.host === 'box').map((a) => a.name)).toEqual(['Ada']);
    // The key itself never reaches a tab.
    expect(JSON.stringify(swarm.snapshot())).not.toContain('demo-key');
  });

  it("keeps OpenCode agents and agents past the plan's Box limit on this computer, saying why", async () => {
    const { swarm, repo } = await office();
    await swarm.setCloudKey('demo-key');
    expect(() => swarm.hireAgent(repo.id, { host: 'box', cli: 'opencode', strict: true })).toThrow(/OpenCode/);
    swarm.updateSettings({ cloud: { machineKind: 'box', boxSize: 'small', boxLimit: 1, hybrid: DEFAULT_HYBRID } });
    swarm.hireAgent(repo.id, { name: 'Ada', strict: true });
    expect(() => swarm.hireAgent(repo.id, { name: 'Bo', strict: true })).toThrow(/Box limit \(1\)/);
    // A floor's own first agent isn't refused: they work on this computer instead.
    expect(swarm.hireAgent(repo.id, { name: 'Cy' }).host).toBe('local');
  });

  it('moves an idle agent to the cloud and back, starting their next session fresh', async () => {
    const { swarm, agents } = await office();
    await swarm.setCloudKey('demo-key');
    const first = agents()[0];
    swarm.updateAgent(first.id, { host: 'box' });
    expect(agents()[0].host).toBe('box');
    expect(() => swarm.updateAgent(first.id, { cli: 'opencode' })).toThrow(/OpenCode/);
    swarm.updateAgent(first.id, { host: 'local' });
    expect(agents()[0].host).toBe('local');
  });

  it('turns the cloud default off when the key is removed', async () => {
    const { swarm } = await office();
    await swarm.setCloudKey('demo-key');
    swarm.updateSettings({ cloud: { machineKind: 'box', boxSize: 'small', boxLimit: 10, hybrid: DEFAULT_HYBRID } });
    await swarm.setCloudKey('');
    expect(swarm.snapshot().settings.cloud.machineKind).toBe('local');
    expect(swarm.snapshot().cloud?.keySet).toBe(false);
  });
});

describe('Hybrid (#260)', () => {
  const hybrid = (boxLimit = 10) => ({ cloud: { machineKind: 'hybrid' as const, boxSize: 'small' as const, boxLimit, hybrid: DEFAULT_HYBRID } });

  it('needs the Upstash key, like the cloud', async () => {
    const { swarm } = await office();
    expect(() => swarm.updateSettings(hybrid())).toThrow(/Upstash Box API key/);
  });

  it('hires on this computer while it has room, in a Box once it has none, and says both reasons when neither has', async () => {
    const { swarm, repo } = await office();
    await swarm.setCloudKey('demo-key');
    swarm.updateSettings(hybrid(1));
    expect(swarm.hireAgent(repo.id, { name: 'Ada', strict: true }).host).toBe('local');
    await swarm.health.simulate(true); // the demo's computer: 0.9 GB free
    expect(swarm.hireAgent(repo.id, { name: 'Bo', strict: true }).host).toBe('box');
    expect(() => swarm.hireAgent(repo.id, { name: 'Cy', strict: true })).toThrow(/No room on this computer \(0\.9 GB free, [\d.]+ GB needed\)\. .*Box limit \(1\)/);
    expect(swarm.hireAgent(repo.id, { name: 'Di' }).host).toBe('local'); // a floor's own first agent is never refused
    await swarm.health.simulate(false);
  });

  it('counts "most agents on this computer"', async () => {
    const { swarm, repo } = await office();
    await swarm.setCloudKey('demo-key');
    swarm.updateSettings({ cloud: { ...hybrid().cloud, hybrid: { ...DEFAULT_HYBRID, localMax: 1 } } }); // the floor's first agent is here already
    expect(swarm.hireAgent(repo.id, { name: 'Ada', strict: true }).host).toBe('box');
  });

  it('never moves or stops agents when the mode changes', async () => {
    const { swarm, repo, agents } = await office();
    await swarm.setCloudKey('demo-key');
    swarm.updateSettings({ cloud: { ...hybrid().cloud, machineKind: 'box' } });
    swarm.hireAgent(repo.id, { name: 'Ada', strict: true });
    const before = agents().map((a) => [a.name, a.host, a.status]);
    for (const machineKind of ['hybrid', 'local', 'box', 'local'] as const) swarm.updateSettings({ cloud: { ...hybrid().cloud, machineKind } });
    expect(agents().map((a) => [a.name, a.host, a.status])).toEqual(before);
  });

  it("lets the CEO's scale_team say where new agents work", async () => {
    const { swarm } = await office();
    type Ceo = { scaleTeam(x: object): string };
    const ceo = swarm as unknown as Ceo;
    swarm.updateSettings({ scaling: 'auto' });
    expect(() => ceo.scaleTeam({ floor: 1, size: 2, reason: 'Busy.', where: 'cloud' })).toThrow(/Upstash Box API key/);
    await swarm.setCloudKey('demo-key');
    ceo.scaleTeam({ floor: 1, size: 2, reason: 'Busy.', where: 'cloud' });
    ceo.scaleTeam({ floor: 1, size: 3, reason: 'Busier.', where: 'local' });
    expect(swarm.snapshot().agents.filter((a) => a.role !== 'ceo').map((a) => a.host)).toEqual(['local', 'box', 'local']);
  });
});

describe('Hybrid burst (#260)', () => {
  it('adds a cloud agent while work waits for memory, and lets it go once this computer has room', async () => {
    const { swarm, repo, agents } = await office();
    await swarm.setCloudKey('demo-key');
    swarm.updateSettings({ cloud: { machineKind: 'hybrid', boxSize: 'small', boxLimit: 10, hybrid: DEFAULT_HYBRID } });
    type Inner = { hybridTick(now?: number): void; schedule(): void; readyIssues(r: unknown): unknown[]; state: { repos: { autoAssign: boolean }[] } };
    const inner = swarm as unknown as Inner;
    await swarm.syncRepo(repo.id);
    inner.state.repos[0].autoAssign = true;
    await swarm.health.simulate(true);
    inner.schedule(); // the floor's free agent can't start: its work waits for memory
    const held = swarm.health.heldFloors();
    expect(held?.floors.has(repo.id)).toBe(true);
    expect(inner.readyIssues(repo).length).toBeGreaterThan(0);
    inner.hybridTick(held!.since + 10_000); // too soon: the demo's simulated wait is 20 s (5 minutes otherwise)
    expect(agents()).toHaveLength(1);
    inner.hybridTick(held!.since + 21_000);
    expect(agents().map((a) => [a.host, !!a.burst])).toEqual([['local', false], ['box', true]]);
    expect(swarm.snapshot().messages.at(-1)?.text).toMatch(/☁️ Added .+ in the cloud on floor 1: this computer is full, \d+ tasks? waiting/);
    inner.hybridTick(held!.since + 30_000);
    expect(agents()).toHaveLength(2); // one at a time: the new one takes the waiting work first
    await swarm.health.simulate(false); // room again, but the added one is on the waiting work now: never leaves mid-task
    const added = agents()[1];
    expect(added.task).toBe('issue');
    inner.hybridTick();
    expect(agents()).toHaveLength(2);
    swarm.stopAgent(added.id);
    swarm.resetAgent(added.id); // their task is over
    inner.hybridTick();
    expect(agents().map((a) => a.host)).toEqual(['local']);
    expect(swarm.snapshot().messages.at(-1)?.text).toMatch(/left the cloud: this computer has room again/);
  });
});
