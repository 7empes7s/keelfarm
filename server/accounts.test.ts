import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { Accounts, type AccountsDeps } from './accounts.ts';
import { UsageBoard } from './usageSources.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { cliEnv, keyHelperCommand } from './unblock.ts';
import { ACCOUNT_KEY_ENV } from '../shared/accounts.ts';
import type { AccountsView } from '../shared/types.ts';

const KEY = 'sk-ant-api03-supersecretkey-0123456789';
const dirs: string[] = [];
const made: Accounts[] = [];
afterEach(async () => {
  for (const a of made.splice(0)) await a.flushed();
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true, maxRetries: 3 });
});

async function office(over: Partial<AccountsDeps> = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-accounts-'));
  dirs.push(home);
  const events: AccountsView[] = [];
  const signIns: Record<string, string>[] = [];
  const agents = [{ id: 'ada', account: 'max' }, { id: 'ceo' }];
  const accounts = new Accounts({
    secretsFile: path.join(home, 'secrets.json'),
    file: path.join(home, 'accounts.json'),
    home,
    env: { CLAUDE_CONFIG_DIR: '/manager/.claude' },
    homedir: '/manager',
    check: async (a, _dir, secret) => ({ signedIn: a.kind !== 'api-key' || secret.startsWith('sk-ant-'), readings: [], note: 'checked' }),
    signIn: (o, exited) => {
      signIns.push(o.env);
      setTimeout(() => exited(0), 0);
      return { stop: () => undefined };
    },
    spend: () => [],
    agents: () => agents,
    builtInUsage: () => [],
    changed: (v) => events.push(v),
    ...over,
  });
  made.push(accounts);
  await accounts.init();
  return { accounts, home, events, signIns };
}

describe('Accounts', () => {
  it('rotation (#248): skips a limited login for the next one, API keys last, and takes the login back once its poll shows room', async () => {
    let reading = { type: 'five_hour', pct: 100, resetsAt: Date.now() + 3600_000, at: Date.now() };
    const { accounts } = await office({
      rotation: () => ({ on: true, apiLast: true, ceoClis: [], agentsSwitchCli: false }),
      check: async (a, _dir, secret) => ({ signedIn: a.kind !== 'api-key' || secret.startsWith('sk-ant-'), readings: a.kind === 'subscription-login' && !a.builtIn ? [reading] : [], note: 'checked' }),
    });
    const key = await accounts.add({ cli: 'claude', kind: 'api-key', key: KEY });
    const max = await accounts.add({ cli: 'claude', kind: 'subscription-login', label: 'Max 2' });
    await accounts.test(max.id); // signed in, at 100% of its 5-hour limit (priorities: the login, the key, Max 2)
    expect(accounts.canRotate('claude', [])).toBe(true);
    expect(accounts.use(undefined, 'claude')?.id).toBe('claude-login');
    accounts.limited('claude-login', Date.now() + 3600_000);
    expect(accounts.use(undefined, 'claude')?.id).toBe(key.id); // Max 2 is full: the key, as a last resort
    expect(accounts.next(undefined, 'claude', ['claude-login', key.id])).toBeNull();
    reading = { ...reading, pct: 40 };
    await accounts.test(max.id);
    expect(accounts.use(undefined, 'claude')?.id).toBe(max.id); // a subscription with room comes before the key
    expect(accounts.firstBack('claude')).toBeGreaterThan(Date.now());
    expect(accounts.view().accounts.find((a) => a.id === 'claude-login')?.limitSpans).toHaveLength(1);
  });

  it('rotation off, or one account per coding agent: nothing to rotate to', async () => {
    const { accounts } = await office();
    expect(accounts.canRotate('claude', [])).toBe(false);
    accounts.limited('claude-login', Date.now() + 3600_000);
    expect(accounts.use(undefined, 'claude')?.id).toBe('claude-login'); // as before: the binding's account
  });

  it('runs every session on the login on this computer until another account is added', async () => {
    const { accounts } = await office();
    const use = accounts.use(undefined, 'claude')!;
    expect(use).toMatchObject({ id: 'claude-login', builtIn: true, env: {}, keyEnv: null });
    expect(accounts.view().accounts.find((a) => a.id === 'claude-login')?.configDir).toBe('/manager/.claude');
    // What the session's CLI gets: today's CLAUDE_CONFIG_DIR, as before accounts.
    expect(cliEnv({ CLAUDE_CONFIG_DIR: '/manager/.claude', PATH: '/bin' }, {}, { machine: use.env }).CLAUDE_CONFIG_DIR).toBe('/manager/.claude');
  });

  it('signs a second Claude subscription in, and runs an agent pinned to it, in its own folder', async () => {
    const { accounts, home, signIns } = await office();
    const { id } = await accounts.add({ cli: 'claude', kind: 'subscription-login', label: 'Max 2', tags: 'max' });
    const dir = path.join(home, 'accounts', id, 'claude');
    expect((await fs.stat(dir)).isDirectory()).toBe(true);
    accounts.signIn(id);
    expect(signIns).toEqual([{ CLAUDE_CONFIG_DIR: dir }]);
    const use = accounts.use('max', 'claude')!;
    expect(use.id).toBe(id);
    const env = cliEnv({ CLAUDE_CONFIG_DIR: '/manager/.claude', ANTHROPIC_API_KEY: 'leak', PATH: '/bin' }, {}, { machine: use.env });
    expect(env.CLAUDE_CONFIG_DIR).toBe(dir);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(accounts.view().accounts.find((a) => a.id === id)).toMatchObject({ agents: ['ada'], running: 1, configDir: dir });
  });

  it('a failed sign-in ends with its reason, input after it is answered, and Try again starts one that takes input (#302)', async () => {
    // A fake PTY: Claude Code's real prompt, which fails with a 400 on Enter, the bytes it got kept.
    const ptys: { got: string[]; fail: () => void }[] = [];
    const { accounts } = await office({
      signIn: (o, exited) => {
        const pty = { got: [] as string[], fail: () => undefined as void };
        pty.fail = () => {
          o.term.write('\r\nLogin failed: Request failed with status code 400\r\n');
          o.term.bind(null);
          exited(1);
        };
        ptys.push(pty);
        o.term.write('Paste code here if prompted > ');
        o.term.bind({ write: (d) => pty.got.push(d), resize: () => undefined });
        return { stop: () => o.term.bind(null) };
      },
    });
    const { id } = await accounts.add({ cli: 'claude', kind: 'subscription-login', label: 'Pro secondary' });
    accounts.signIn(id);
    const term = accounts.terminal(id)!;
    const viewer = Object.assign(new EventEmitter(), { readyState: 1, OPEN: 1, send: () => undefined, close: () => undefined });
    term.attach(viewer as unknown as WebSocket);
    const type = (data: string) => viewer.emit('message', JSON.stringify({ t: 'input', data }));
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m: string) => void logs.push(m));
    type('abc123#state456');
    type('\r');
    spy.mockRestore();
    expect(ptys[0].got.join('')).toBe('abc123#state456\r');
    expect(logs).toEqual([`account ${id}: sign-in code sent (15 characters, with #state)`]); // its shape, never the code
    expect(accounts.view().accounts.find((a) => a.id === id)?.signIn).toMatchObject({ running: true });
    ptys[0].fail();
    await vi.waitFor(() => expect(accounts.view().accounts.find((a) => a.id === id)?.signIn).toMatchObject({ running: false, ok: false, note: expect.stringMatching(/^Sign-in failed \(400\)/) }));
    type('x');
    await term.flush();
    expect(term.tail(3).join('\n')).toMatch(/This sign-in has ended: tap Try again/);
    accounts.signIn(id); // Try again: a fresh login in the same terminal
    expect(accounts.view().accounts.find((a) => a.id === id)?.signIn).toMatchObject({ running: true });
    type('def#789\r');
    expect(ptys[1].got.join('')).toBe('def#789\r');
    term.dispose();
  });

  it('a sign-in whose CLI ends the moment Enter arrives logs the code by shape and is not told it ended (#302)', async () => {
    // Like the demo's fake CLI: Enter finishes the login at once, inside the write.
    const { accounts } = await office({
      signIn: (o, exited) => {
        o.term.write('Paste code here if prompted > ');
        o.term.bind({
          write: (d) => {
            if (!d.includes('\r')) return;
            o.term.write('\r\nLogin successful.\r\n');
            o.term.bind(null);
            exited(0);
          },
          resize: () => undefined,
        });
        return { stop: () => o.term.bind(null) };
      },
    });
    const { id } = await accounts.add({ cli: 'claude', kind: 'subscription-login', label: 'Pro secondary' });
    accounts.signIn(id);
    const term = accounts.terminal(id)!;
    const viewer = Object.assign(new EventEmitter(), { readyState: 1, OPEN: 1, send: () => undefined, close: () => undefined });
    term.attach(viewer as unknown as WebSocket);
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m: string) => void logs.push(m));
    viewer.emit('message', JSON.stringify({ t: 'input', data: 'abc123#state456\r' }));
    spy.mockRestore();
    expect(logs).toEqual([`account ${id}: sign-in code sent (15 characters, with #state)`]);
    await term.flush();
    expect(term.tail(5).join('\n')).not.toMatch(/This sign-in has ended/);
    term.dispose();
  });

  it('keeps an API key out of the registry, the views and events; the session gets it through apiKeyHelper only', async () => {
    const { accounts, home, events } = await office();
    await expect(accounts.add({ cli: 'claude', kind: 'api-key', key: 'nope' })).rejects.toThrow(/sk-ant-/);
    const { id } = await accounts.add({ cli: 'claude', kind: 'api-key', key: ` ${KEY} `, tags: ['api'] });
    await accounts.flushed();
    expect(await fs.readFile(path.join(home, 'accounts.json'), 'utf8')).not.toContain(KEY);
    expect(JSON.parse(await fs.readFile(path.join(home, 'secrets.json'), 'utf8'))[`account:${id}`]).toBe(KEY);
    expect(JSON.stringify(accounts.view())).not.toContain(KEY);
    expect(JSON.stringify(events)).not.toContain(KEY);
    expect(accounts.view().accounts.find((a) => a.id === id)?.keyHint).toBe(KEY.slice(-4));
    expect(accounts.secretValues()).toContain(KEY);
    const use = accounts.use('api', 'claude')!;
    expect(use.keyEnv).toBe(ACCOUNT_KEY_ENV);
    expect(use.env).toEqual({ [ACCOUNT_KEY_ENV]: KEY });
    expect(keyHelperCommand(use.keyEnv!)).not.toContain(KEY);
    // A restart reads it back from secrets.json.
    const again = await office({ secretsFile: path.join(home, 'secrets.json'), file: path.join(home, 'accounts.json') });
    expect(again.accounts.use(id, 'claude')?.env[ACCOUNT_KEY_ENV]).toBe(KEY);
  });

  it('usage for every account (#361): the built-in Codex login polled for its rate limits, an API key as spend, never the key', async () => {
    const reading = { type: 'five_hour', pct: 40, resetsAt: Date.now() + 3600_000, at: Date.now() };
    const { accounts } = await office({
      poll: true,
      check: async (a) => ({ signedIn: a.kind === 'api-key', readings: a.builtIn && a.cli === 'codex' ? [reading] : [], note: 'checked' }),
      sources: (list, now) => new UsageBoard({ api: { elevenLabs: async () => ({}), costs: async () => ({}) }, keys: () => ({ elevenlabs: '', anthropic: '', openai: '' }), boxes: () => null, spend: () => [], alertsFile: '', changed: () => undefined }).sources(list, now),
    });
    await accounts.add({ cli: 'claude', kind: 'api-key', key: KEY });
    await vi.waitFor(() => expect(accounts.view().sources?.find((s) => s.id === 'codex-login')?.windows).toEqual([{ name: '5-hour', usedPct: 40, resetsAt: reading.resetsAt }]));
    const view = accounts.view();
    expect(view.accounts.find((a) => a.id === 'codex-login')?.status).toBe('ready'); // the poll's "no login file" doesn't sign it out
    expect(view.sources?.find((s) => s.provider === 'claude' && s.plan === 'API')?.windows[0]).toMatchObject({ name: 'Today', unit: '$' });
    expect(JSON.stringify(view.sources)).not.toContain(KEY);
  });

  it('waits for running sessions before removing an account, and keeps the built-in login', async () => {
    const { accounts, home } = await office();
    const { id } = await accounts.add({ cli: 'claude', kind: 'subscription-login' });
    const use = accounts.use(id, 'claude')!;
    expect(await accounts.remove(id)).toBe('waiting');
    expect(accounts.view().accounts.find((a) => a.id === id)).toMatchObject({ removing: true, status: 'paused' });
    expect(accounts.use(id, 'claude')?.id).toBe('claude-login'); // no new sessions on it
    use.release();
    await accounts.flushed();
    expect(accounts.list().some((a) => a.id === id)).toBe(false);
    await expect(fs.stat(path.join(home, 'accounts', id))).rejects.toThrow();
    await expect(accounts.remove('claude-login')).rejects.toThrow(/stays/);
  });

  it('seeds the demo’s accounts once', async () => {
    const seed = () => ({ accounts: [{ id: 'claude-demo', cli: 'claude' as const, kind: 'api-key' as const, label: 'Demo', tags: ['api'], priority: 1, enabled: true }], keys: { 'claude-demo': KEY } });
    const { accounts } = await office({ seed });
    expect(accounts.view().accounts.find((a) => a.id === 'claude-demo')).toMatchObject({ status: 'ready', keyHint: KEY.slice(-4) });
  });
});

describe('pinning agents in the office', () => {
  it('pins an agent to an account or tag, refuses unknown ones, and shows it on their card and the account', async () => {
    const swarm = new Swarm(createDemoBackend());
    const repo = await swarm.connectRepo('demo-co/pixel-todo');
    const ada = swarm.snapshot().agents.find((a) => a.repoId === repo.id)!;
    expect(() => swarm.updateAgent(ada.id, { account: 'gold' })).toThrow(/No account or tag "gold"/);
    swarm.updateAgent(ada.id, { account: 'claude-login' });
    expect(swarm.snapshot().agents.find((a) => a.id === ada.id)?.account).toBe('claude-login');
    expect(swarm.snapshot().accounts?.accounts.find((a) => a.id === 'claude-login')?.agents).toContain(ada.id);
    swarm.updateAgent(ada.id, { account: 'rotation' });
    expect(swarm.snapshot().agents.find((a) => a.id === ada.id)?.account).toBeUndefined();
  });
});
