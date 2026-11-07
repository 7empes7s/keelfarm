import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { ServerEvent } from '../shared/types.ts';

// Its own folder: the saved key (and its trouble) live in the demo's cloud secrets file, which cloudSignIn.test.ts
// reads in the shared one.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-cloudcredit-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

// Cloud agents whose Anthropic key runs out of credit (#258): in a demo office the fake sessions fail as Anthropic's
// would, the agents switch to their own login in their Box and wait for it, the manager gets one card and one
// notification for the burst, and the key comes back when it's topped up.

const KEY = 'sk-ant-api03-secret-test-key-1234';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Insides {
  broadcast(ev: ServerEvent): void;
  notifier: { notify(event: string, title: string, body: string): void };
}

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const insides = swarm as unknown as Insides;
  const events: ServerEvent[] = [];
  const broadcast = insides.broadcast.bind(swarm);
  insides.broadcast = (ev) => {
    events.push(ev);
    broadcast(ev);
  };
  const notify = vi.spyOn(insides.notifier, 'notify');
  const connecting = swarm.connectRepo('demo-co/pixel-todo');
  await vi.advanceTimersByTimeAsync(2_000);
  const repo = await connecting;
  await swarm.setCloudKey('demo-key');
  await swarm.setCloudToken('anthropic', KEY);
  const agent = (id: string) => swarm.snapshot().agents.find((a) => a.id === id)!;
  return { swarm, repo, agent, events, notify };
}

function viewer() {
  const on: Record<string, (raw: unknown) => void> = {};
  const ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: () => undefined, close: () => undefined, on: (ev: string, fn: (raw: unknown) => void) => void (on[ev] = fn) };
  return { ws: ws as unknown as WebSocket, type: (data: string) => on.message?.(JSON.stringify({ t: 'input', data })) };
}

describe('a cloud key out of credit', () => {
  it('holds the task without a round, tells the manager once per burst, and switches back when the key is topped up', async () => {
    const { swarm, repo, agent, events, notify } = await office();
    const ada = swarm.hireAgent(repo.id, { name: 'Ada', host: 'box', strict: true });
    const ken = swarm.hireAgent(repo.id, { name: 'Ken', host: 'box', strict: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(agent(ada.id).needsSignIn).toBe(false); // on the key: no sign-in needed
    const [one, two] = swarm.snapshot().repos.find((r) => r.id === repo.id)!.issues;
    void swarm.assign(ada.id, one.number);
    void swarm.assign(ken.id, two.number);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(agent(ada.id).status).toBe('working');
    expect(agent(ken.id).status).toBe('working');
    const qaBefore = swarm.snapshot().qa.length;
    notify.mockClear();

    await swarm.simulateOutOfCredit();
    await vi.advanceTimersByTimeAsync(30_000);

    // Both wait for their own sign-in, still on their issue: not failed, not a round, not the manager's problem.
    for (const [a, issue] of [[ada, one], [ken, two]] as const) {
      expect(agent(a.id)).toMatchObject({ status: 'preparing', needsSignIn: true, signInWhy: 'out-of-credit', issueNumber: issue.number });
      expect(agent(a.id).branch).toBeTruthy();
    }
    expect(swarm.snapshot().qa.length).toBe(qaBefore);
    expect(swarm.snapshot().cloud?.claude.trouble?.kind).toBe('out-of-credit');

    // One card and one notification for the pair.
    const cards = swarm.snapshot().messages.filter((m) => m.signIn);
    expect(cards).toHaveLength(1);
    expect(cards[0].signIn).toMatchObject({ why: 'out-of-credit', cli: 'claude', agents: [{ name: 'Ada' }, { name: 'Ken' }] });
    expect(cards[0].text).toMatch(/2 cloud agents need signing in/);
    expect(notify.mock.calls.filter(([event]) => event === 'needsHuman')).toHaveLength(1);

    // The key never shows: not in an event, the snapshot, a card or a notification.
    expect(JSON.stringify(events)).not.toContain(KEY);
    expect(JSON.stringify(swarm.snapshot())).not.toContain(KEY);
    expect(JSON.stringify(notify.mock.calls)).not.toContain(KEY);

    // Ken is signed in by the manager and carries on with his own login.
    const v = viewer();
    swarm.attachTerminal(ken.id, v.ws);
    await vi.advanceTimersByTimeAsync(100);
    v.type('code\r');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(agent(ken.id)).toMatchObject({ status: 'working', needsSignIn: false, issueNumber: two.number });

    // Credit topped up: Ada goes back on the key and back to work without signing in.
    await swarm.useKeyAgain('anthropic');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(agent(ada.id)).toMatchObject({ status: 'working', needsSignIn: false, issueNumber: one.number });
    expect(swarm.snapshot().cloud?.claude.trouble).toBeUndefined();
  });

  it('a new key puts an idle agent back on it at their next task', async () => {
    const { swarm, repo, agent } = await office();
    const ada = swarm.hireAgent(repo.id, { name: 'Ada', host: 'box', strict: true });
    await vi.advanceTimersByTimeAsync(10_000);
    await swarm.simulateOutOfCredit(); // idle: switched at once
    await vi.advanceTimersByTimeAsync(6_000);
    expect(agent(ada.id)).toMatchObject({ needsSignIn: true, signInWhy: 'out-of-credit' });

    await swarm.setCloudToken('anthropic', 'sk-ant-api03-a-new-key-5678');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(agent(ada.id).needsSignIn).toBe(false);
    const issue = swarm.snapshot().repos.find((r) => r.id === repo.id)!.issues[0];
    void swarm.assign(ada.id, issue.number);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(agent(ada.id)).toMatchObject({ status: 'working', needsSignIn: false });
  });

  it('only simulates in the demo, and checks a sign-in on request', async () => {
    const { swarm, repo } = await office();
    const lin = swarm.hireAgent(repo.id, { name: 'Lin', host: 'local', strict: true });
    await expect(swarm.recheckSignIn(lin.id)).rejects.toThrow(/this computer/);
    expect(() => swarm.signInLinkOf(lin.id)).toThrow(/doesn't need signing in/);
  });
});
