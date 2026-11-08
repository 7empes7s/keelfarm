import { describe, expect, it } from 'vitest';
import { connectionSource, keyProblem, mcpProblem, providerCards, providersLine, sessionMcpServers, splitCommand, testNote, testUsage, type CardInput } from './providers.ts';
import { EMPTY_CLOUD } from './cloud.ts';
import type { AccountView, McpServerConfig } from './types.ts';

const account = (over: Partial<AccountView>): AccountView => ({
  id: 'claude-login',
  cli: 'claude',
  kind: 'subscription-login',
  label: 'Claude login',
  tags: [],
  priority: 0,
  enabled: true,
  status: 'ready',
  until: null,
  usage: [],
  keyHint: '',
  configDir: '/home/m/.claude',
  todayUsd: 0,
  todaySessions: 0,
  limitHits7d: 0,
  agents: [],
  running: 0,
  signIn: null,
  ...over,
});

const input = (over: Partial<CardInput> = {}): CardInput => ({
  accounts: [],
  voiceKeySet: false,
  voiceKeyHint: '',
  cloud: EMPTY_CLOUD,
  providers: { connections: [], mcp: [] },
  clis: [],
  agentName: (id) => ({ ada: 'Ada', ceo: 'Mimoun' })[id] ?? id,
  cloudAgents: 0,
  ...over,
});

describe('the providers page shows what the old stores hold', () => {
  it('keeps every account, the ElevenLabs key and the Upstash key as cards, with only their hints', () => {
    const cards = providerCards(
      input({
        accounts: [account({ builtIn: true, plan: 'Max', agents: ['ceo'] }), account({ id: 'api', kind: 'api-key', label: 'Backup key', keyHint: '6789', agents: ['ada'], status: 'limited' }), account({ id: 'codex', cli: 'codex', label: 'ChatGPT', status: 'signed-out' })],
        voiceKeySet: true,
        voiceKeyHint: 'ab12',
        cloud: { ...EMPTY_CLOUD, keySet: true, keyHint: 'cd34' },
        cloudAgents: 2,
      }),
    );
    expect(cards.map((c) => [c.key, c.category, c.status, c.keyHint])).toEqual([
      ['account:claude-login', 'coding', 'ready', ''],
      ['account:api', 'coding', 'limited', '6789'],
      ['account:codex', 'coding', 'signed-out', ''],
      ['voice', 'audio', 'ready', 'ab12'],
      ['cloud', 'cloud', 'ready', 'cd34'],
    ]);
    expect(cards.find((c) => c.key === 'account:api')?.uses).toEqual(['Ada']);
    expect(cards.find((c) => c.key === 'voice')).toMatchObject({ uses: ['Voice'], usageId: 'elevenlabs', settings: 'voice' });
    expect(cards.find((c) => c.key === 'cloud')).toMatchObject({ uses: ['Cloud agents (2)'], usageId: 'upstash', settings: 'cloud-agents' });
  });

  it('adds keys from the page and MCP servers, sorted by category', () => {
    const mcp: McpServerConfig = { id: 'm1', name: 'github', command: 'npx', args: ['server-github'], envKeys: [], on: true, agents: [], test: null };
    const cards = providerCards(
      input({
        providers: { connections: [{ id: 'h1', provider: 'hetzner', label: 'Hetzner', addedAt: 1, keyHint: 'zz99', test: { at: 2, ok: false, note: 'Turned away (401): check the key' } }, { id: 'o1', provider: 'openai', label: 'OpenAI API', addedAt: 1, keyHint: 'ff00', test: null }], mcp: [mcp] },
        clis: [{ id: 'opencode', label: 'OpenCode', installed: true, version: '1', integrated: false }],
      }),
    );
    expect(cards.map((c) => [c.key, c.status])).toEqual([
      ['cli:opencode', 'ready'],
      ['connection:o1', 'untested'],
      ['connection:h1', 'error'],
      ['mcp:m1', 'untested'],
    ]);
    expect(cards.at(-1)?.uses).toEqual(['Every agent']);
    expect(providersLine(cards)).toBe('Providers: OpenCode, OpenAI API, Hetzner Cloud "Hetzner" (failed test) · MCP: github');
  });
});

describe('test calls', () => {
  it('reads what a status says, and OpenRouter credit', () => {
    expect(testNote({ status: 200 })).toEqual({ ok: true, note: 'Key works' });
    expect(testNote({ status: 401 }).ok).toBe(false);
    expect(testNote({ status: 0 }).note).toMatch(/reach/);
    expect(testUsage('openrouter', { data: { usage: 2.5, limit: 10 } })).toEqual([{ name: 'Credit', usedPct: 25, used: 2.5, limit: 10, unit: '$', resetsAt: null }]);
    expect(testUsage('openai', { data: { usage: 1 } })).toEqual([]);
  });

  it('refuses a key for the wrong provider or one kept elsewhere', () => {
    expect(keyProblem('openai', 'sk-ant-api03-x')).toMatch(/not an OpenAI/);
    expect(keyProblem('openrouter', 'sk-proj-x')).toMatch(/sk-or-/);
    expect(keyProblem('elevenlabs', 'sk_abc')).toMatch(/Pick a provider/);
    expect(keyProblem('gemini', 'AIzaSyabc')).toBeNull();
  });

  it("puts a key's credit on the usage card", () => {
    const row = connectionSource({ id: 'r1', provider: 'openrouter', label: 'OpenRouter', addedAt: 1, keyHint: '', test: { at: 5, ok: true, note: 'Key works', windows: [{ name: 'Credit', usedPct: 90, used: 9, limit: 10, unit: '$', resetsAt: null }] } });
    expect(row).toMatchObject({ id: 'provider:r1', provider: 'openrouter', category: 'text', status: 'near', checkedAt: 5 });
  });
});

describe('MCP servers', () => {
  const base = { envKeys: [], on: true, agents: [], test: null };
  const list: McpServerConfig[] = [
    { ...base, id: 'a', name: 'github', command: 'npx', args: ['-y', 'server-github'], envKeys: ['GITHUB_TOKEN'] },
    { ...base, id: 'b', name: 'docs', url: 'https://mcp.example.com', envKeys: ['Authorization'], agents: ['ada'] },
    { ...base, id: 'c', name: 'off', command: 'x', on: false },
    { ...base, id: 'd', name: 'office', command: 'evil' },
  ];
  const secret = (id: string, name: string) => `${id}:${name}`;

  it('gives a session the ones on for it, secrets as env or headers, never the office’s own names', () => {
    expect(sessionMcpServers(list, 'ada', secret)).toEqual({
      github: { command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: 'a:GITHUB_TOKEN' } },
      docs: { type: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'b:Authorization' } },
    });
    expect(Object.keys(sessionMcpServers(list, 'bob', secret))).toEqual(['github']);
  });

  it('checks what is added', () => {
    expect(mcpProblem({ name: 'playwright', command: 'x' }, [])).toMatch(/office's own/);
    expect(mcpProblem({ name: 'github', command: 'x' }, ['GitHub'])).toMatch(/already/);
    expect(mcpProblem({ name: 'a', command: 'x', url: 'https://x' }, [])).toMatch(/one of them/);
    expect(mcpProblem({ name: 'a', url: 'ftp://x' }, [])).toMatch(/https/);
    expect(mcpProblem({ name: 'a', command: 'x', envKeys: ['BAD KEY'] }, [])).toMatch(/Secret names/);
    expect(mcpProblem({ name: 'a', command: 'npx' }, [])).toBeNull();
    expect(splitCommand(`npx -y "my server" --x 'a b'`)).toEqual({ command: 'npx', args: ['-y', 'my server', '--x', 'a b'] });
  });
});
