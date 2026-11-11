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
  it('an expired token to refresh (#442): signed in and in the rotation, until a session really fails to sign in; its real plan on the card', async () => {
    const { accounts } = await office({
      rotation: () => ({ on: true, apiLast: true, ceoClis: [], agentsSwitchCli: false }),
      check: async (a) => (a.builtIn ? { signedIn: true, readings: [], note: 'ok' } : { signedIn: true, readings: [], refresh: true, plan: 'Pro', note: 'refreshes' }),
    });
    const ultra = await accounts.add({ cli: 'claude', kind: 'subscription-login', label: 'Claude Ultra' });
    await accounts.test(ultra.id);
    const card = () => accounts.view().accounts.find((a) => a.id === ultra.id)!;
    expect(card()).toMatchObject({ status: 'ready', tokenRefresh: true, loginPlan: 'Pro', planWarning: 'Signed in with a Pro account, not Ultra' });
    accounts.limited('claude-login', Date.now() + 3600_000);
    expect(accounts.use(undefined, 'claude')?.id).toBe(ultra.id);
    accounts.signedOut(ultra.id); // its session couldn't sign in
    expect(await accounts.test(ultra.id)).toMatch(/couldn't sign in/);
    expect(card().status).toBe('signed-out');
    expect(card().tokenRefresh).toBeUndefined();
  });

  it('notes two logins on the same subscription, never sending who owns them (#460)', async () => {
    const { accounts } = await office({ check: async () => ({ signedIn: true, readings: [], plan: 'Pro', who: 'me@example.com', note: 'ok' }) });
    const main = await accounts.add({ cli: 'claude', kind: 'subscription-login', label: 'Main login' });
    const second = await accounts.add({ cli: 'claude', kind: 'subscription-login', label: 'Pro secondary' });
    await accounts.test(main.id);
    const card = (id: string) => accounts.view().accounts.find((a) => a.id === id)!;
    expect(card(main.id).sameAs).toBeUndefined(); // the other one isn't read yet
    await accounts.test(second.id);
    expect(card(main.id).sameAs).toBe('Pro secondary');
    expect(card(second.id).sameAs).toBe('Main login');
    expect(JSON.stringify(accounts.view())).not.toContain('me@example.com');
  });

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

  it("a new Claude login shares this computer's login's set (#377): on the card, Repair heals it, removing it leaves the set", async () => {
    const shared = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-shared-'));
    dirs.push(shared);
    await fs.mkdir(path.join(shared, 'projects', '-root', 'memory'), { recursive: true });
    await fs.writeFile(path.join(shared, 'projects', '-root', 'memory', 'MEMORY.md'), 'remember\n');
    await fs.writeFile(path.join(shared, 'settings.json'), '{}');
    const { accounts } = await office({ shareFrom: shared });
    const { id } = await accounts.add({ cli: 'claude', kind: 'subscription-login', label: 'Pro' });
    const dir = accounts.dirOf(accounts.list().find((a) => a.id === id)!);
    const card = () => accounts.view().accounts.find((a) => a.id === id)!;
    expect(card().shareMissing).toEqual([]);
    expect(await fs.readFile(path.join(dir, 'projects', '-root', 'memory', 'MEMORY.md'), 'utf8')).toBe('remember\n');
    expect(accounts.sharesConversations(id)).toBe(true);
    expect(accounts.sharesConversations('claude-login')).toBe(true); // the built-in login is the set
    expect(accounts.view().accounts.find((a) => a.id === 'claude-login')?.shareMissing).toBeUndefined();
    await fs.unlink(path.join(dir, 'settings.json'));
    expect(accounts.repairShare(id)).toMatch(/^✓ Repaired/);
    await accounts.remove(id);
    expect(await fs.readFile(path.join(shared, 'projects', '-root', 'memory', 'MEMORY.md'), 'utf8')).toBe('remember\n');
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

  it('a failed sign-in names the CLI’s status even when a phone narrowed its terminal and the line wrapped (#350)', async () => {
    const { accounts } = await office({
      signIn: (o, exited) => {
        o.term.write('Paste code here if prompted > ');
        o.term.bind({
          write: () => {
            o.term.write('\r\nLogin failed: Request failed with status code 400\r\n');
            o.term.bind(null);
            exited(1);
          },
          resize: () => undefined,
        });
        return { stop: () => o.term.bind(null) };
      },
    });
    const { id } = await accounts.add({ cli: 'claude', kind: 'subscription-login', label: 'Pro secondary' });
    accounts.terminal(id)!.resize(40, 20);
    accounts.signIn(id);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    accounts.signInCodeIn(id, 'abc#1');
    spy.mockRestore();
    await vi.waitFor(() => expect(accounts.view().accounts.find((a) => a.id === id)?.signIn).toMatchObject({ running: false, note: expect.stringMatching(/^Sign-in failed \(400\)/) }));
    accounts.terminal(id)!.dispose();
  });

  it('the guided sign-in (#350): answers the login menu, reads the link off the real output, sends exactly the pasted code', async () => {
    const URL_ = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile&code_challenge=hhuUE_dFmZsg-B2VkqAw6DsYoqxyL71ICyyl2k7uhcw&code_challenge_method=S256&state=JqzKsMJrwWFRbVCJe098AtKRjuOp4eNrchRoSyEHvaI';
    const got: string[] = [];
    const { accounts } = await office({
      signIn: (o) => {
        o.term.note('── Signing Claude Code in ──');
        o.term.write(' Select login method:\r\n\r\n ❯ 1. Claude account with subscription · Pro, Max\r\n   2. Anthropic Console account · API usage billing\r\n');
        o.term.bind({
          write: (d) => {
            got.push(d);
            // As `claude auth login` prints it: the link as an OSC 8 hyperlink, wider than the terminal; bracketed paste on.
            if (d === '\r' && got.length === 1) o.term.write(`\x1b[4A\r\x1b[0J\x1b[?2004hOpening browser to sign in…\r\nIf the browser didn't open, visit: \x1b]8;;${URL_}\x07${URL_}\x1b]8;;\x07\r\nPaste code here if prompted > `);
          },
          resize: () => undefined,
        });
        return { stop: () => o.term.bind(null) };
      },
    });
    const { id } = await accounts.add({ cli: 'claude', kind: 'subscription-login', label: 'Pro secondary' });
    accounts.signIn(id);
    const run = () => accounts.view().accounts.find((a) => a.id === id)?.signIn;
    await vi.waitFor(() => expect(run()).toMatchObject({ running: true, url: URL_, waiting: true }));
    expect(got[0]).toBe('\r'); // the subscription login, chosen by the office
    expect(run()?.question).toBeUndefined();
    expect(() => accounts.signInCodeIn(id, URL_)).toThrow(/web address/);
    expect(() => accounts.signInCodeIn(id, 'two words')).toThrow(/spaces/);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    accounts.signInCodeIn(id, '  abc123#state456\n');
    spy.mockRestore();
    expect(got.slice(1)).toEqual(['\x1b[200~abc123#state456\x1b[201~', '\r']);
    accounts.terminal(id)!.bind(null);
    expect(() => accounts.signInCodeIn(id, 'abc#1')).toThrow(/has ended/);
    accounts.terminal(id)!.dispose();
  });

  it('the guided sign-in asks a menu it does not know, and Codex’s one-time code is on the run (#350)', async () => {
    const got: string[] = [];
    const { accounts } = await office({
      signIn: (o) => {
        o.term.note('── Signing Codex in ──');
        o.term.write(' Pick a workspace\r\n ❯ 1. Personal\r\n   2. Acme\r\n');
        o.term.bind({
          write: (d) => {
            got.push(d);
            o.term.write('\x1b[3A\r\x1b[0J1. Open this link in your browser and sign in to your account\r\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\r\n\r\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\r\n   \x1b[94mB0VZ-0ZW5L\x1b[0m\r\n');
          },
          resize: () => undefined,
        });
        return { stop: () => o.term.bind(null) };
      },
    });
    const { id } = await accounts.add({ cli: 'codex', kind: 'subscription-login', label: 'ChatGPT Plus' });
    accounts.signIn(id);
    const run = () => accounts.view().accounts.find((a) => a.id === id)?.signIn;
    await vi.waitFor(() => expect(run()?.question).toEqual({ text: 'Pick a workspace', options: ['Personal', 'Acme'] }));
    expect(got).toEqual([]);
    expect(() => accounts.signInAnswer(id, 5)).toThrow(/has gone/);
    accounts.signInAnswer(id, 1);
    expect(got).toEqual(['\x1b[B\r']);
    await vi.waitFor(() => expect(run()).toEqual({ mode: 'login', running: true, ok: false, note: '', url: 'https://auth.openai.com/codex/device', deviceCode: 'B0VZ-0ZW5L' }));
    accounts.terminal(id)!.dispose();
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
    });
    const board = new UsageBoard({ api: { elevenLabs: async () => ({}), costs: async () => ({}) }, keys: () => ({ elevenlabs: '', anthropic: '', openai: '' }), boxes: () => null, spend: () => [], alertsFile: '', changed: () => undefined });
    const sources = () => board.sources(accounts.view().accounts);
    await accounts.add({ cli: 'claude', kind: 'api-key', key: KEY });
    await vi.waitFor(() => expect(sources().find((s) => s.id === 'codex-login')?.windows).toEqual([{ name: '5-hour', usedPct: 40, resetsAt: reading.resetsAt }]));
    const view = accounts.view();
    expect(view.accounts.find((a) => a.id === 'codex-login')?.status).toBe('ready'); // the poll's "no login file" doesn't sign it out
    expect(sources().find((s) => s.provider === 'claude' && s.plan === 'API')?.windows[0]).toMatchObject({ name: 'Today', unit: '$' });
    expect(JSON.stringify(sources())).not.toContain(KEY);
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
