import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionCallbacks, SessionHandle, SessionOptions } from './agentRunner.ts';
import type { AgentStatus, PhoneMessage, ServerEvent } from '../shared/types.ts';

// Its own folder: the accounts' limits are saved in the demo's accounts file.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-rotation-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

// Account rotation (#248) in a demo office: a session that ends on a usage limit starts again on the next account
// within seconds, the CEO's switch shows as a chat pill, nothing counts against an agent's task, and when every
// account is out there's one message and no loop.

const KEY = 'sk-ant-demo-0000000000000000demo'; // the demo's seeded Anthropic key
const LIMIT = 'Claude Code stopped: rate limit (5-hour limit reached ∙ resets 4pm)';

type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  usageNow(): { state: string };
  broadcast(ev: ServerEvent): void;
  backend: { startSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle };
  notifier: { notify(event: string, title: string, body: string): void };
  issueFailures: Map<string, number>;
  state: { ceo: { queue: unknown[] }; messages: PhoneMessage[]; agents: { id: string; status: AgentStatus; lastError: string | null }[] };
};

beforeEach(() => {
  fs.rmSync(path.join(home, 'demo-accounts.json'), { force: true });
  fs.rmSync(path.join(home, 'demo-state.json'), { force: true });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 7, 12, 0)); // midday: "today" doesn't roll over mid-test
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
let last: InstanceType<typeof Swarm> | null = null;
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await last?.accounts.flushed(); // its last write lands before the next test clears the file
});

const realTimeout = globalThis.setTimeout; // before the fake timers

/** Fake time moves in steps, with a moment of real time for real I/O (the CEO's folder, the accounts file) between them. */
async function wait(ms: number) {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(100);
    await new Promise((r) => realTimeout(r, 2));
  }
}

/** The account a session ran on, from its environment: a login's folder, the API key, or the built-in login. */
const accountOf = (o: SessionOptions) => (o.env?.CLAUDE_CONFIG_DIR?.includes('claude-keelop') ? 'claude-keelop' : o.apiKeyEnv ? 'claude-apikey' : 'claude-login');

/** A demo office whose Claude sessions on the accounts in `out` end at once on a usage limit. */
async function office(out: string[]) {
  const swarm = (last = new Swarm(createDemoBackend()));
  const i = swarm as unknown as Internals;
  const events: ServerEvent[] = [];
  const broadcast = i.broadcast.bind(swarm);
  i.broadcast = (ev) => {
    events.push(ev);
    broadcast(ev);
  };
  const connecting = swarm.connectRepo('demo-co/pixel-todo');
  await vi.advanceTimersByTimeAsync(2_000);
  const repo = await connecting;
  await swarm.accounts.init(); // the demo's seeded accounts
  const testing = swarm.accounts.test('claude-keelop'); // its second Max is signed in
  await vi.advanceTimersByTimeAsync(500);
  await testing;
  i.state.ceo.queue = []; // no onboarding
  i.ensureCeo([]);
  const runs: { account: string; role?: string; resume?: string; cli?: string }[] = [];
  const start = i.backend.startSession.bind(i.backend);
  i.backend.startSession = (opts, cb) => {
    const account = accountOf(opts);
    runs.push({ account, role: opts.role, resume: opts.resumeSessionId, cli: opts.cli });
    if (!out.includes(account)) return start(opts, cb);
    const t = setTimeout(() => cb.finished({ ok: false, text: '', costUsd: 0.01, turns: 0, errors: [LIMIT] }), 10);
    return { send: () => undefined, stop: () => clearTimeout(t) };
  };
  const ceo = () => i.state.agents.find((a) => a.id === 'ceo')!;
  return { swarm, repo, i, runs, ceo, events };
}

describe('account rotation', { timeout: 30_000 }, () => {
  it("reruns the CEO's job on the next account within seconds, with a switch pill in the chat", async () => {
    const { swarm, runs, ceo, i, events } = await office(['claude-login']);
    swarm.requestReview();
    await wait(3_000);
    expect(runs.filter((r) => r.role === 'ceo').map((r) => r.account)).toEqual(['claude-login', 'claude-keelop']);
    expect(ceo().status).toBe('working'); // no failure in between
    const pills = i.state.messages.filter((m) => m.switch);
    expect(pills).toHaveLength(1);
    expect(pills[0].switch).toMatchObject({ from: 'Claude login on this computer', to: 'Max · keelops' });
    expect(pills[0].text).toMatch(/^🔀 Switched to Max · keelops: Claude login on this computer is limited until \d/);
    expect(i.usageNow().state).toBe('normal'); // the office isn't paused: the next account took over
    const login = swarm.accounts.view().accounts.find((a) => a.id === 'claude-login')!;
    expect(login).toMatchObject({ status: 'limited', limitHits7d: 1 });
    expect(swarm.accounts.view().rotation).toMatchObject({ switchesToday: 1 });
    // The next session on the rotation skips the limited login.
    await wait(60_000);
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it('posts one message when every account is out, pauses, and keeps the job without looping', async () => {
    const { swarm, runs, ceo, i } = await office(['claude-login', 'claude-keelop', 'claude-apikey']);
    swarm.requestReview();
    await wait(3_000);
    expect(runs.filter((r) => r.role === 'ceo').map((r) => r.account)).toEqual(['claude-login', 'claude-keelop', 'claude-apikey']);
    const allOut = i.state.messages.filter((m) => m.switch && m.switch.to === null);
    expect(allOut).toHaveLength(1);
    expect(allOut[0].text).toMatch(/^⏸ Every Claude Code account is out\. The first one is back at/);
    expect(i.state.messages.filter((m) => /hit a problem|usage limit was reached/.test(m.text))).toHaveLength(0);
    expect(i.usageNow().state).toBe('paused');
    expect(ceo().status).toBe('idle');
    expect(i.state.ceo.queue).toHaveLength(1); // the job waits for the first account back
    await wait(30_000);
    expect(runs.filter((r) => r.role === 'ceo')).toHaveLength(3); // no loop
  });

  it("offers a paused API key when every account is out, and Use API key carries on there", async () => {
    const { swarm, runs, i } = await office(['claude-login', 'claude-keelop']);
    swarm.accounts.update('claude-apikey', { enabled: false });
    swarm.requestReview();
    await wait(3_000);
    const allOut = i.state.messages.filter((m) => m.switch && m.switch.to === null);
    expect(allOut).toHaveLength(1);
    expect(allOut[0].switch?.useKey).toBe('claude-apikey');
    expect(allOut[0].text).toContain('Use API key');
    swarm.useAccountNow('claude-apikey');
    await wait(3_000);
    expect(i.usageNow().state).toBe('normal');
    expect(runs.filter((r) => r.role === 'ceo').at(-1)?.account).toBe('claude-apikey');
  });

  it("restarts an agent's task on the next account: no failure, no round, no needs-human, same branch", async () => {
    const { swarm, repo, i, runs } = await office([]);
    const notify = vi.spyOn(i.notifier, 'notify');
    const ada = swarm.hireAgent(repo.id, { name: 'Ada', strict: true });
    await wait(10_000);
    const [issue] = swarm.snapshot().repos.find((r) => r.id === repo.id)!.issues;
    void swarm.assign(ada.id, issue.number);
    await wait(5_000);
    const agent = () => swarm.snapshot().agents.find((a) => a.id === ada.id)!;
    expect(agent()).toMatchObject({ status: 'working', issueNumber: issue.number });
    const branch = agent().branch;
    const qa = swarm.snapshot().qa.length;
    const before = runs.filter((r) => r.role !== 'ceo').length;

    swarm.simulateAccountLimit('claude-login');
    await wait(1_000);

    const mine = runs.filter((r) => r.role !== 'ceo');
    expect(mine.length).toBe(before + 1);
    expect(mine.at(-1)).toMatchObject({ account: 'claude-keelop', resume: undefined });
    expect(agent()).toMatchObject({ status: 'working', issueNumber: issue.number, branch, lastError: null });
    expect(i.issueFailures.size).toBe(0);
    expect(swarm.snapshot().qa.length).toBe(qa);
    expect(notify.mock.calls.filter(([event]) => event === 'needsHuman' || event === 'error')).toHaveLength(0);
    expect(i.state.messages.filter((m) => m.switch)).toHaveLength(0); // an agent's switch isn't a chat pill
  });

  it("never moves an agent's task onto Gemini CLI, which isn't a builder (#365)", async () => {
    const { swarm, repo, runs } = await office(['claude-login', 'claude-keelop', 'claude-apikey']);
    const testing = swarm.accounts.test('gemini-plus'); // signed in, and ready
    await vi.advanceTimersByTimeAsync(500);
    await testing;
    swarm.accounts.update('codex-login', { enabled: false }); // no Codex to go to either
    (swarm as unknown as { clis: unknown[] }).clis = ['claude', 'codex', 'gemini'].map((id) => ({ id, label: id, installed: true, version: 'demo', integrated: id === 'claude' }));
    const ada = swarm.hireAgent(repo.id, { name: 'Ada', strict: true });
    await wait(10_000);
    const [issue] = swarm.snapshot().repos.find((r) => r.id === repo.id)!.issues;
    void swarm.assign(ada.id, issue.number);
    await wait(5_000);
    expect(runs.filter((r) => r.role !== 'ceo').length).toBeGreaterThan(0);
    expect(runs.filter((r) => r.cli === 'gemini')).toEqual([]);
  });

  it('with rotation off, a limit stays on its account as before', async () => {
    const { swarm, runs, i } = await office(['claude-login']);
    swarm.updateSettings({ rotation: { on: false, apiLast: true, ceoClis: [], agentsSwitchCli: true } });
    swarm.requestReview();
    await wait(3_000);
    expect(runs.filter((r) => r.role === 'ceo').map((r) => r.account)).toEqual(['claude-login']);
    expect(i.state.messages.filter((m) => m.switch)).toHaveLength(0);
  });
});
