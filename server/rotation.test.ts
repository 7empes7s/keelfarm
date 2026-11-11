import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionCallbacks, SessionHandle, SessionOptions } from './agentRunner.ts';
import type { AgentStatus, PhoneMessage, ServerEvent } from '../shared/types.ts';
import { limitedBy } from '../shared/accounts.ts';

// Its own folder: the accounts' limits are saved in the demo's accounts file.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-rotation-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
const { SWITCHED_NOTE } = await import('./swarm/rotation.ts');
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
    cb.sessionId(opts.resumeSessionId ?? 'conversation-1'); // a conversation the next account can resume (#377)
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

  it("shows the account a session really started on, apart from its pin, on the agent and the CEO's thread (#376)", async () => {
    const { swarm, ceo } = await office(['claude-login']);
    (ceo() as { account?: string }).account = 'claude-login';
    await swarm.messageCeo('Which account are you on?'); // a chat: the thread's own session
    await wait(3_000);
    const run = swarm.snapshot().agents.find((a) => a.id === 'ceo')!.run;
    expect(run).toMatchObject({ account: 'claude-keelop', label: 'Max · keelops', pinned: 'Claude login on this computer', why: 'limited' });
    const thread = swarm.snapshot().chat?.conversations.find((c) => c.id === swarm.snapshot().chat?.current);
    expect(thread?.run).toMatchObject({ account: 'claude-keelop', pinned: 'Claude login on this computer' });
  });

  it("the CEO's next Claude login resumes the same conversation, and sees the shared memory (#377)", async () => {
    const { swarm, runs, i } = await office(['claude-login']);
    swarm.requestReview();
    await wait(3_000);
    expect(runs.filter((r) => r.role === 'ceo')).toMatchObject([
      { account: 'claude-login', role: 'ceo', resume: undefined },
      { account: 'claude-keelop', role: 'ceo', resume: 'conversation-1' },
    ]);
    const pill = i.state.messages.find((m) => m.switch)!;
    expect(pill.text).toMatch(/Memory and conversation carried over\.$/);
    const memory = path.join(home, 'accounts', 'claude-keelop', 'claude', 'projects', 'demo-ceo', 'memory', 'MEMORY.md');
    expect(fs.readFileSync(memory, 'utf8')).toContain('Manager prefers short replies');
    expect(swarm.accounts.view().accounts.find((a) => a.id === 'claude-keelop')?.shareMissing).toEqual([]);
  });

  it("in the demo, the CEO on a second login moves to the next one mid-job and resumes the same conversation (#377)", async () => {
    const { swarm, runs, ceo, i } = await office([]);
    (ceo() as { account?: string }).account = 'claude-keelop';
    swarm.requestReview();
    await wait(1_500);
    expect(runs.filter((r) => r.role === 'ceo').map((r) => r.account)).toEqual(['claude-keelop']);
    swarm.simulateAccountLimit('claude-keelop');
    await wait(1_000);
    expect(runs.filter((r) => r.role === 'ceo').at(-1)).toMatchObject({ account: 'claude-login', resume: expect.stringMatching(/^demo-ceo-/) });
    expect(i.state.messages.find((m) => m.switch)?.text).toMatch(/Memory and conversation carried over\.$/);
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

  it("a Codex limit as its narrow terminal shows it rests the Codex login until the time it names; new Codex tasks start on the next coding agent (#400)", async () => {
    const { swarm, repo, i, runs } = await office([]);
    (swarm as unknown as { clis: unknown[] }).clis = ['claude', 'codex'].map((id) => ({ id, label: id, installed: true, version: 'demo', integrated: id === 'claude' }));
    const ada = swarm.hireAgent(repo.id, { name: 'Ada', cli: 'codex', strict: true });
    const bob = swarm.hireAgent(repo.id, { name: 'Bob', cli: 'codex', strict: true });
    await wait(10_000);
    const [first, second] = swarm.snapshot().repos.find((r) => r.id === repo.id)!.issues;
    void swarm.assign(ada.id, first.number);
    await wait(5_000);
    expect(runs.filter((r) => r.role !== 'ceo').at(-1)).toMatchObject({ cli: 'codex' });

    swarm.simulateAccountLimit('codex-login');
    await wait(1_000);
    const reset = new Date(Date.now() + 3 * 60_000 - 1_000).setSeconds(0, 0); // "try again at" names the minute
    expect(swarm.accounts.view().accounts.find((a) => a.id === 'codex-login')).toMatchObject({ status: 'limited', until: reset });
    expect(runs.filter((r) => r.role !== 'ceo').at(-1)).toMatchObject({ cli: 'claude' });
    expect(swarm.snapshot().agents.find((a) => a.id === ada.id)).toMatchObject({ status: 'working', issueNumber: first.number, lastError: null });
    expect(i.issueFailures.size).toBe(0);

    const before = runs.length;
    void swarm.assign(bob.id, second.number);
    await wait(5_000);
    expect(runs.slice(before).filter((r) => r.role !== 'ceo').map((r) => r.cli)).toEqual(['claude']);
  });

  // #383: limits are per account. A warning or a full window on one login rests that login, not the office.
  /** The CEO's sessions report `report` as they start (the demo's own session runs on). */
  function reporting(i: Internals, report: (cb: SessionCallbacks) => void) {
    const start = i.backend.startSession.bind(i.backend);
    i.backend.startSession = (opts, cb) => {
      const h = start(opts, cb);
      if (opts.role === 'ceo') report(cb);
      return h;
    };
  }

  it("a usage warning on one login doesn't pace the office while another has room (#383)", async () => {
    const { swarm, i, runs } = await office([]);
    reporting(i, (cb) => cb.usageWarning?.({ resetsAt: Date.now() + 3600_000, rateLimitType: 'five_hour', utilization: 0.96 }));
    swarm.requestReview();
    await wait(3_000);
    expect(runs.filter((r) => r.role === 'ceo').map((r) => r.account)).toEqual(['claude-login']);
    expect(i.usageNow().state).toBe('normal');
    expect(i.state.messages.filter((m) => /usage is getting high/.test(m.text))).toHaveLength(0);
    const login = swarm.accounts.view().accounts.find((a) => a.id === 'claude-login')!;
    expect(login.usage).toContainEqual(expect.objectContaining({ type: 'five_hour', pct: 96 })); // on its own account
    expect(swarm.accounts.view().next?.claude).toBe('claude-keelop'); // near out: new sessions move on
  });

  it('with rotation off, the same warning paces the office as before', async () => {
    const { swarm, i } = await office([]);
    swarm.updateSettings({ rotation: { on: false, apiLast: true, ceoClis: [], agentsSwitchCli: true } });
    reporting(i, (cb) => cb.usageWarning?.({ resetsAt: Date.now() + 3600_000, rateLimitType: 'five_hour', utilization: 0.96 }));
    swarm.requestReview();
    await wait(3_000);
    expect(i.usageNow().state).toBe('pacing');
  });

  it("a login at 100% weekly rests only it: no pause, the next sessions on another account, its card says weekly, company.usage names the next (#383)", async () => {
    const { swarm, i } = await office([]);
    reporting(i, (cb) => cb.usage?.([{ type: 'five_hour', pct: 30, resetsAt: Date.now() + 3600_000, at: Date.now() }, { type: 'seven_day', pct: 100, resetsAt: Date.now() + 50 * 3600_000, at: Date.now() }]));
    swarm.requestReview();
    await wait(3_000);
    expect(i.usageNow().state).toBe('normal');
    const login = swarm.accounts.view().accounts.find((a) => a.id === 'claude-login')!;
    expect(login.status).toBe('limited');
    expect(limitedBy(login.usage, login.until, Date.now())).toBe('weekly');
    expect(swarm.accounts.view().accounts.find((a) => a.id === 'claude-keelop')!.usage.map((r) => r.pct)).toEqual([18, 63]); // its own numbers, untouched
    expect((i as unknown as { nextUsage(): string }).nextUsage()).toBe('next on Max · keelops: 5h 18% · week 63%');
    expect(swarm.accounts.view().next).toEqual({ claude: 'claude-keelop', ceo: 'claude-keelop' });
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

// #360: a session starts ready to work on any account, and one that opens on a sign-in never sits.
describe('sessions on a fresh login', { timeout: 30_000 }, () => {
  /** Ada, pinned to the second Max, on the floor's first issue; sessions on `signedOut` accounts open on their sign-in. */
  async function pinned(signedOut: string[], rotation = true) {
    const o = await office([]);
    const notify = vi.spyOn(o.i.notifier, 'notify');
    if (!rotation) o.swarm.updateSettings({ rotation: { on: false, apiLast: true, ceoClis: [], agentsSwitchCli: false } });
    const seen: SessionOptions[] = [];
    const start = o.i.backend.startSession.bind(o.i.backend);
    o.i.backend.startSession = (opts, cb) => {
      seen.push(opts);
      if (opts.role === 'ceo' || !signedOut.includes(accountOf(opts))) return start(opts, cb);
      // What cliRunner.ts does on a sign-in screen (cliScreens.ts): the session ends signed out.
      const t = setTimeout(() => cb.finished({ ok: false, text: '', costUsd: 0, turns: 0, errors: ['Claude Code is not signed in on claude-keelop: it showed its sign-in screen, so the task goes back in line.'], signedOut: true }), 10);
      return { send: () => undefined, stop: () => clearTimeout(t) };
    };
    const ada = o.swarm.hireAgent(o.repo.id, { name: 'Ada', strict: true });
    o.swarm.updateAgent(ada.id, { account: 'claude-keelop' });
    await wait(10_000);
    const [issue] = o.swarm.snapshot().repos.find((r) => r.id === o.repo.id)!.issues;
    void o.swarm.assign(ada.id, issue.number);
    await wait(5_000);
    const agent = () => o.swarm.snapshot().agents.find((a) => a.id === ada.id)!;
    const signInNotices = () => notify.mock.calls.filter(([, title]) => /needs signing in/.test(title));
    return { ...o, ada, issue, agent, seen: () => seen.filter((s) => s.agentId === ada.id), signInNotices };
  }

  it("sets up the account's login folder before its first session: onboarding done, the worktree trusted, keys kept", async () => {
    const dir = path.join(home, 'accounts', 'claude-keelop', 'claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' }, theme: 'light' }));
    const { seen, agent } = await pinned([]);
    const first = seen()[0];
    expect(first.account).toBe('claude-keelop');
    const config = JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'));
    expect(config).toMatchObject({ oauthAccount: { emailAddress: 'a@b.c' }, theme: 'light', hasCompletedOnboarding: true });
    expect(config.projects[first.cwd]).toMatchObject({ hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true });
    expect(agent().status).toBe('working');
  });

  it('a sign-in screen ends the session, marks the account signed out, carries on on the next account and tells the manager once', async () => {
    const { swarm, agent, issue, seen, signInNotices, i } = await pinned(['claude-keelop']);
    expect(seen().map(accountOf)).toEqual(['claude-keelop', 'claude-login']);
    expect(agent()).toMatchObject({ status: 'working', issueNumber: issue.number, lastError: null });
    expect(swarm.accounts.view().accounts.find((a) => a.id === 'claude-keelop')?.status).toBe('signed-out');
    expect(signInNotices()).toHaveLength(1);
    expect(i.issueFailures.size).toBe(0);
  });

  it('with rotation off, the task goes back in line without a strike, and a second sign-in on the account adds no notice', async () => {
    const { swarm, agent, signInNotices, i, ada, issue, seen } = await pinned(['claude-keelop'], false);
    expect(agent()).toMatchObject({ issueNumber: null, lastError: null });
    expect(agent().status).not.toBe('error');
    expect(i.issueFailures.size).toBe(0);
    expect(signInNotices()).toHaveLength(1);
    const free = () => (swarm as unknown as { isFree(a: unknown): boolean }).isFree(i.state.agents.find((a) => a.id === ada.id));
    expect(free()).toBe(false); // the scheduler leaves them be until the account is signed in
    expect(seen()).toHaveLength(1);
    void swarm.assign(ada.id, issue.number);
    await wait(5_000);
    expect(signInNotices()).toHaveLength(1);
  });

  it("the demo's session on a login nobody signed in opens on its sign-in and ends the same way", async () => {
    const { demoSignedIn } = await import('./demoAccounts.ts');
    const o = await office([]);
    demoSignedIn.delete('claude-keelop');
    o.swarm.updateSettings({ rotation: { on: false, apiLast: true, ceoClis: [], agentsSwitchCli: false } });
    const notify = vi.spyOn(o.i.notifier, 'notify');
    const ada = o.swarm.hireAgent(o.repo.id, { name: 'Ada', strict: true });
    o.swarm.updateAgent(ada.id, { account: 'claude-keelop' });
    await wait(10_000);
    const [issue] = o.swarm.snapshot().repos.find((r) => r.id === o.repo.id)!.issues;
    void o.swarm.assign(ada.id, issue.number);
    await wait(30_000);
    expect(notify.mock.calls.filter(([, title]) => /needs signing in/.test(title))).toHaveLength(1);
    expect(o.swarm.accounts.view().accounts.find((a) => a.id === 'claude-keelop')?.status).toBe('signed-out');
  });
});

// #375: the CEO on a second account starts ready too, and a stuck CEO shows in the chat instead of going silent.
describe('the CEO on a second account', { timeout: 30_000 }, () => {
  /** The office with the CEO pinned to the second Max (rotation off, so a stuck session stays there), and the notices sent. */
  async function ceoOn(account = 'claude-keelop') {
    const o = await office([]);
    o.swarm.updateSettings({ rotation: { on: false, apiLast: true, ceoClis: [], agentsSwitchCli: false } });
    o.swarm.updateAgent('ceo', { account });
    const notify = vi.spyOn(o.i.notifier, 'notify');
    const cards = () => o.i.state.messages.filter((m) => m.ceoStuck);
    return { ...o, notify, cards };
  }

  it("sets up the account's login folder for the CEO's folder before its first session there", async () => {
    const dir = path.join(home, 'accounts', 'claude-keelop', 'claude');
    fs.rmSync(dir, { recursive: true, force: true });
    const { swarm, runs } = await ceoOn();
    await swarm.messageCeo('Hello?');
    await wait(3_000);
    expect(runs.filter((r) => r.role === 'ceo').at(-1)?.account).toBe('claude-keelop');
    const config = JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'));
    expect(config.hasCompletedOnboarding).toBe(true);
    expect(config.theme).toBeTruthy();
    expect(config.projects[path.join(home, 'ceo')]).toMatchObject({ hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true });
  });

  it('a session on a login nobody signed in shows the stuck card with Switch back, no generic error, and Switch back answers', async () => {
    const { demoSignedIn } = await import('./demoAccounts.ts');
    const { swarm, i, runs, cards, ceo } = await ceoOn();
    swarm.updateSettings({ statusReactions: true });
    await swarm.messageCeo('Before the switch'); // answered on the built-in login: where Switch back goes
    await wait(20_000);
    demoSignedIn.delete('claude-keelop');
    await swarm.messageCeo('Are you there?');
    await wait(10_000);
    expect(cards()).toHaveLength(1);
    expect(cards()[0].ceoStuck).toMatchObject({ kind: 'sign-in', account: 'claude-keelop', back: '' });
    expect(cards()[0].text).toMatch(/is stuck on Max · keelops: sign-in needed/);
    expect(i.state.messages.filter((m) => /hit a problem/.test(m.text))).toHaveLength(0);
    await swarm.messageCeo('Still there?');
    await wait(10_000);
    expect(cards()).toHaveLength(1); // one card however many jobs hit the sign-in
    swarm.ceoSwitchBack('');
    await wait(20_000);
    expect(runs.filter((r) => r.role === 'ceo').at(-1)?.account).toBe('claude-login');
    expect(ceo().status).not.toBe('error');
    const asked = i.state.messages.filter((m) => m.from === 'manager' && m.text.endsWith('there?'));
    expect(asked.map((m) => m.status)).toEqual(['done', 'done']); // both stuck messages answered after Switch back
  });

  it("a session that sits on a setup screen, or says nothing for a minute, shows a card and one notification each", async () => {
    const { swarm, i, cards, notify, ceo } = await ceoOn();
    let cb: SessionCallbacks | null = null;
    i.backend.startSession = (_opts, c) => {
      cb = c;
      return { send: () => undefined, stop: () => c.finished({ ok: false, text: '', costUsd: 0, turns: 0, errors: ['Stopped'], interrupted: true }) };
    };
    await swarm.messageCeo('Anyone?');
    await wait(59_000);
    expect(cards()).toHaveLength(0);
    await wait(2_000);
    expect(cards().map((m) => m.ceoStuck?.kind)).toEqual(['silent']);
    expect(swarm.snapshot().agents.find((a) => a.id === 'ceo')?.blocked).toMatch(/hasn't answered/);
    cb!.blocked?.('needs setup (the theme screen)', 'setup');
    cb!.blocked?.('needs setup (the theme screen)', 'setup'); // read again: still one card
    expect(cards().map((m) => m.ceoStuck?.kind)).toEqual(['silent', 'setup']);
    expect(notify.mock.calls.filter(([, title]) => /is stuck on Max · keelops/.test(title))).toHaveLength(2);
    cb!.text?.('Here.', true); // it answers: no longer shown as stuck
    expect(swarm.snapshot().agents.find((a) => a.id === 'ceo')?.blocked).toBeNull();
    expect(ceo().status).toBe('working');
  });
});

// Make default and task stickiness (#390): an open task's sessions stay on the account it started on; new tasks go to
// the default, which is first again at its reset; Switch now moves open tasks at their next session.
describe('the default and task stickiness', { timeout: 30_000 }, () => {
  type Sticky = Internals & { startOnAccount(a: object, o: SessionOptions, cb: SessionCallbacks): SessionHandle; watchDefaults(): void };
  const HOUR = 60 * 60_000;

  /** An office whose sessions only record where they ran; `run(agent, resume?)` starts one of that agent's task. */
  async function sticky() {
    const o = await office([]);
    const i = o.i as Sticky;
    const seen: { agent: string; account: string; resume?: string; prompt: string }[] = [];
    i.backend.startSession = (opts) => {
      seen.push({ agent: opts.agentId ?? '', account: accountOf(opts), resume: opts.resumeSessionId, prompt: opts.prompt });
      return { send: () => undefined, stop: () => undefined };
    };
    /** A teammate on an issue (no session: run() starts them). */
    const agent = (name: string, issueNumber: number) => {
      const { id } = o.swarm.hireAgent(o.repo.id, { name, strict: true });
      return Object.assign(i.state.agents.find((x) => x.id === id)!, { task: 'issue', issueNumber, prNumber: null }) as unknown as { id: string };
    };
    const cb = { log: () => undefined, tool: () => undefined, sessionId: () => undefined, finished: () => undefined } as unknown as SessionCallbacks;
    const run = (a: ReturnType<typeof agent>, resume?: string) => {
      i.startOnAccount(a, { cwd: home, prompt: 'Carry on.', systemAppend: '', model: 'm', effort: 'medium', browserTesting: false, additionalDirectories: [], role: 'agent', agentId: a.id, resumeSessionId: resume }, cb);
      return seen.at(-1)!;
    };
    return { ...o, i, agent, run };
  }

  it('a resumed session of an open task stays on its account after Make default; a new task starts on the new default', async () => {
    const { swarm, agent, run, i } = await sticky();
    const ada = agent('Ada', 1);
    expect(run(ada).account).toBe('claude-login');
    const text = swarm.makeDefaultAccount('claude-keelop');
    expect(text).toBe('Max · keelops is the default now: new tasks start on it; 1 agent finishes their current task on Claude login on this computer first.');
    expect(i.state.messages.at(-1)?.text).toBe(text);
    expect(run(ada, 'conversation-1')).toMatchObject({ account: 'claude-login', resume: 'conversation-1', prompt: 'Carry on.' });
    expect(run(agent('Bob', 2)).account).toBe('claude-keelop');
  });

  it('a 5-hour limit on the default sends the next session on; at its reset new tasks go back to it, open ones stay put', async () => {
    const { swarm, agent, run, i } = await sticky();
    i.watchDefaults();
    swarm.accounts.limited('claude-login', Date.now() + 5 * HOUR);
    const ada = agent('Ada', 1);
    expect(run(ada).account).toBe('claude-keelop');
    i.watchDefaults(); // the default is out: noted
    vi.setSystemTime(Date.now() + 5 * HOUR + 60_000);
    i.watchDefaults();
    expect(i.state.messages.at(-1)?.text).toBe('Claude login on this computer is back: new tasks start on it again.');
    expect(run(agent('Bob', 2)).account).toBe('claude-login');
    expect(run(ada, 'conversation-1')).toMatchObject({ account: 'claude-keelop', resume: 'conversation-1' });
  });

  it('the same with a weekly limit: Ultra-like default at 100% weekly, the other free (2026-11-08)', async () => {
    const { swarm, agent, run } = await sticky();
    swarm.makeDefaultAccount('claude-keelop');
    const now = Date.now();
    swarm.accounts.readings('claude-keelop', [{ type: 'seven_day', pct: 100, resetsAt: now + 3 * 24 * HOUR, at: now }]);
    const ada = agent('Ada', 1);
    expect(run(ada).account).toBe('claude-login');
    vi.setSystemTime(now + 3 * 24 * HOUR + 60_000);
    expect(run(agent('Bob', 2)).account).toBe('claude-keelop');
    expect(run(ada, 'conversation-1')).toMatchObject({ account: 'claude-login', resume: 'conversation-1' });
  });

  it('Switch now moves an open task at its next session: a fresh one with the switched note, then it stays there', async () => {
    const { swarm, agent, run } = await sticky();
    const ada = agent('Ada', 1);
    expect(run(ada).account).toBe('claude-login');
    swarm.makeDefaultAccount('claude-keelop', true);
    const moved = run(ada, 'conversation-1');
    expect(moved).toMatchObject({ account: 'claude-keelop', resume: undefined });
    expect(moved.prompt).toBe(`${SWITCHED_NOTE}\n\nCarry on.`);
    expect(run(ada, 'conversation-2')).toMatchObject({ account: 'claude-keelop', resume: 'conversation-2', prompt: 'Carry on.' });
  });

  it('counts the tasks left on the old default until they finish', async () => {
    const { swarm, agent, run } = await sticky();
    const a = agent('Ada', 1);
    expect(run(a).account).toBe('claude-login');
    expect(swarm.makeDefaultAccount('claude-keelop')).toBe('Max · keelops is the default now: new tasks start on it; 1 agent finishes their current task on Claude login on this computer first.');
    expect(swarm.accounts.view().switching).toEqual([{ cli: 'claude', to: 'Max · keelops', left: [{ id: 'claude-login', label: 'Claude login on this computer', count: 1 }] }]);
    Object.assign(a, { task: null, issueNumber: null });
    expect(swarm.accounts.view().switching).toBeUndefined();
  });
});
