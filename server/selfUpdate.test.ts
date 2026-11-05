import { afterEach, describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import type { LastUpdate } from './officeUpdate.ts';
import { Swarm } from './swarm.ts';

// The office's own update without the freeze (#74), in a demo office: a run of merges settles into one hand-over,
// work keeps starting while the launcher runs the preflight, and agents whose CLIs the terminal keeper holds are
// neither stopped nor sent back to the queue.

type Internals = {
  schedule(): void;
  setOfficeBehind(behind: number): void;
  officeHead: string | null;
  officeUpdate: { pendingSince: number | null; lastCommitAt: number | null; holding: boolean };
  agentRt: Map<string, { session: unknown }>;
};

const FROM = 'a'.repeat(40);
let open: Swarm[] = [];
afterEach(() => {
  for (const s of open) for (const a of s.snapshot().agents) if (a.status === 'working' || a.status === 'preparing') s.stopAgent(a.id);
  open = [];
});

async function office(runtime: 'terminal' | 'sdk' = 'terminal') {
  const backend = createDemoBackend();
  const handOvers: string[] = [];
  let finish: (r: LastUpdate) => void = () => undefined;
  // The launcher: it takes the update and runs the preflight until the test says how it went.
  backend.office = { ...backend.office, launcher: true, update: (from) => (handOvers.push(from), new Promise<LastUpdate>((r) => (finish = r))) };
  const swarm = new Swarm(backend);
  open.push(swarm);
  swarm.updateSettings({ runtime });
  const repo = await swarm.connectRepo('demo-co/pixel-todo');
  swarm.hireAgent(repo.id, { name: 'Bo' });
  swarm.updateRepo(repo.id, { autoAssign: true });
  await swarm.syncRepo(repo.id);
  const i = swarm as unknown as Internals;
  i.officeHead = FROM;
  const workers = () => swarm.snapshot().agents.filter((a) => a.role !== 'ceo');
  i.schedule();
  for (let n = 0; n < 300 && !workers().every((a) => a.status === 'working' && i.agentRt.get(a.id)?.session); n++) await new Promise((r) => setTimeout(r, 10));
  expect(workers().map((a) => a.status)).toEqual(['working', 'working']);
  /** The settle window passing: as if the commits had landed minutes ago. */
  const settle = () => Object.assign(i.officeUpdate, { pendingSince: Date.now() - 10 * 60_000, lastCommitAt: Date.now() - 4 * 60_000 });
  return { swarm, repo, i, workers, handOvers, settle, done: (r: Partial<LastUpdate> = {}) => finish({ from: FROM, to: 'b'.repeat(40), ok: true, installed: false, built: true, at: Date.now(), ...r }) };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
/** Wait for the hand-over, which saves the state first. */
const until = async (ok: () => boolean) => {
  for (let n = 0; n < 200 && !ok(); n++) await tick();
};

describe("the office's own update with the terminal keeper", () => {
  it('turns several merges into one hand-over, keeps agents working through it and starts new work during the preflight', async () => {
    const { swarm, repo, i, workers, handOvers, settle, done } = await office();
    const before = workers().map((a) => ({ id: a.id, issue: a.issueNumber, session: i.agentRt.get(a.id)?.session }));

    for (const behind of [1, 2, 3]) {
      i.setOfficeBehind(behind);
      i.schedule();
    }
    expect(handOvers).toEqual([]); // settling: more merges may come
    expect(swarm.snapshot().officeUpdate).toMatchObject({ state: 'settling', behind: 3, holds: false });

    settle();
    i.schedule();
    expect(swarm.snapshot().officeUpdate?.state).toBe('updating');
    await until(() => handOvers.length > 0);
    expect(handOvers).toEqual([FROM]); // at once: nothing it would have to wait for
    expect(swarm.snapshot().messages.at(-1)?.text).toBe('⬆️ Updating the office (3 new commits). Agents keep working; the office restarts for a few seconds once the update passes its checks.');
    i.setOfficeBehind(4); // a merge during the preflight is the next update's
    i.schedule();
    expect(handOvers).toHaveLength(1);

    // The preflight runs: the kept sessions carry on, and new work starts as usual.
    for (const b of before) expect(i.agentRt.get(b.id)?.session).toBe(b.session);
    expect(i.officeUpdate.holding).toBe(false);
    const newcomer = swarm.hireAgent(repo.id, { name: 'Cy' });
    i.schedule();
    expect(swarm.snapshot().agents.find((a) => a.id === newcomer.id)?.status).toMatch(/preparing|working/);

    done(); // the demo's update restarts nothing: the office carries on
    await until(() => swarm.snapshot().officeUpdate?.state !== 'updating');
    for (const b of before) {
      const a = workers().find((x) => x.id === b.id)!;
      expect(a).toMatchObject({ status: 'working', issueNumber: b.issue, lastError: null });
      expect(i.agentRt.get(b.id)?.session).toBe(b.session);
    }
    expect(swarm.snapshot().messages.some((m) => /updated itself while/.test(m.text))).toBe(false);
  });

  it('a refused preflight leaves the kept sessions running', async () => {
    const { swarm, i, workers, handOvers, settle, done } = await office();
    i.setOfficeBehind(1);
    settle();
    i.schedule();
    await until(() => handOvers.length > 0);
    expect(handOvers).toHaveLength(1);
    done({ ok: false, stage: 'preflight', error: 'tests failed', to: FROM, target: 'b'.repeat(40) });
    await until(() => swarm.snapshot().officeUpdate?.state !== 'updating');
    expect(workers().map((a) => [a.status, a.lastError])).toEqual([
      ['working', null],
      ['working', null],
    ]);
  });
});

describe("the office's own update without the keeper", () => {
  it('drains the sessions a restart would stop, starting nothing new meanwhile', async () => {
    const { swarm, repo, i, handOvers, settle } = await office('sdk');
    i.setOfficeBehind(1);
    settle();
    i.schedule();
    await tick();
    expect(handOvers).toEqual([]);
    expect(swarm.snapshot().officeUpdate).toMatchObject({ state: 'draining', running: 2, holds: true });
    expect(swarm.snapshot().messages.at(-1)?.text).toMatch(/Nothing new starts.*while 2 running sessions finish/);
    const newcomer = swarm.hireAgent(repo.id, { name: 'Cy' });
    i.schedule();
    expect(swarm.snapshot().agents.find((a) => a.id === newcomer.id)?.status).not.toMatch(/preparing|working/);
  });
});
