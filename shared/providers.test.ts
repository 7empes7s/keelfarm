import { describe, expect, it } from 'vitest';
import { connectionSource, geminiVideoModels, IMAGE_MODELS, imageModels, keyProblem, mcpProblem, PROVIDERS, providerCards, providersLine, sessionMcpServers, splitCommand, testNote, testPlan, testRequest, testUsage, type CardInput } from './providers.ts';
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

  it("shows a login's real plan, a token to refresh and a plan warning (#442)", () => {
    const [card] = providerCards(input({ accounts: [account({ id: 'ultra', label: 'Claude Ultra', plan: 'Ultra', loginPlan: 'Pro', planWarning: 'This login is Pro, not Ultra: sign in with the Ultra account.', tokenRefresh: true })] }));
    expect(card).toMatchObject({ plan: 'Ultra · login is Pro · token refreshes on its next session', warning: 'This login is Pro, not Ultra: sign in with the Ultra account.' });
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

// Recorded answers (keys and ids made up), as the providers document them.
const RUNWAY_ORG = {
  creditBalance: 1250,
  tier: { maxMonthlyCreditSpend: 10000, models: { gen4_turbo: { maxConcurrentGenerations: 2, maxDailyGenerations: 50 }, gen4_aleph: { maxConcurrentGenerations: 1, maxDailyGenerations: 20 } } },
  usage: { models: { gen4_turbo: { dailyGenerations: 12 }, gen4_aleph: { dailyGenerations: 0 } } },
};
const KLING_COSTS = {
  code: 0,
  message: 'SUCCEED',
  request_id: 'r-1',
  data: {
    code: 0,
    msg: 'SUCCEED',
    resource_pack_subscribe_infos: [
      { resource_pack_name: 'Video Generation - 1000 units', resource_pack_id: 'p1', resource_pack_type: 'decreasing_total', total_quantity: 1000, remaining_quantity: 640.5, purchase_time: 1, effective_time: 1, invalid_time: 2_000_000_000_000, status: 'online' },
      { resource_pack_name: 'Old pack', resource_pack_id: 'p0', resource_pack_type: 'decreasing_total', total_quantity: 100, remaining_quantity: 100, purchase_time: 1, effective_time: 1, invalid_time: 1_000, status: 'expired' },
    ],
  },
};
const NOW = 1_800_000_000_000;

describe('video providers (#364)', () => {
  it('lists Runway, Google video, Luma and Kling under Video, and never Sora (its API is gone)', () => {
    expect(PROVIDERS.filter((p) => p.category === 'video').map((p) => p.id)).toEqual(['runway', 'gemini-video', 'luma', 'kling']);
    expect(PROVIDERS.some((p) => /sora/i.test(p.id) || /sora/i.test(p.name))).toBe(false);
  });

  it('tests every video key with a read: the organisation, the models list, the credits, the account costs', () => {
    const urls = ['runway', 'gemini-video', 'luma', 'kling'].map((id) => {
      const r = testRequest(id, 'k', NOW);
      expect(r).toMatchObject({ kind: 'http' });
      expect(Object.keys(r!).sort()).toEqual(['headers', 'kind', 'url']); // no method, no body: a GET
      return r!.kind === 'http' ? r!.url : '';
    });
    expect(urls).toEqual([
      'https://api.dev.runwayml.com/v1/organization',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      'https://api.lumalabs.ai/dream-machine/v1/credits',
      `https://api-singapore.klingai.com/account/costs?start_time=${NOW - 30 * 86_400_000}&end_time=${NOW}`,
    ]);
    expect(testRequest('runway', 'k')).toMatchObject({ headers: { Authorization: 'Bearer k', 'X-Runway-Version': '2024-11-06' } });
  });

  it("reads Runway's credit balance, each model's generations today and its monthly cap", () => {
    expect(testUsage('runway', RUNWAY_ORG)).toEqual([
      { name: 'Balance', usedPct: null, used: 1250, unit: 'credits', resetsAt: null },
      { name: 'gen4_turbo today', usedPct: 24, used: 12, limit: 50, unit: 'videos', resetsAt: null },
    ]);
    expect(testPlan('runway', RUNWAY_ORG)).toBe('Up to 10,000 credits a month');
    expect(testUsage('runway', { error: 'nope' })).toEqual([]);
  });

  it("reads Luma's balance in cents as dollars, and Kling's live resource packs", () => {
    expect(testUsage('luma', { credit_balance: 1000.5 })).toEqual([{ name: 'Balance', usedPct: null, used: 10.01, unit: '$', resetsAt: null }]);
    expect(testUsage('luma', { generations: [] })).toEqual([]);
    expect(testUsage('kling', KLING_COSTS, NOW)).toEqual([{ name: 'Video Generation - 1000 units', usedPct: 36, used: 359.5, limit: 1000, unit: 'units', resetsAt: 2_000_000_000_000 }]);
  });

  it('names only the video models Gemini lists for the key', () => {
    const list = { models: [{ name: 'models/gemini-3-flash' }, { name: 'models/gemini-omni-1.2-flash' }, { name: 'models/veo-3.1-generate-001' }] };
    expect(geminiVideoModels(list)).toEqual(['gemini-omni-1.2-flash', 'veo-3.1-generate-001']);
    expect(testPlan('gemini-video', { models: [{ name: 'models/gemini-3-flash' }] })).toBe('No video models on this key');
  });

  it("puts Runway's balance on the usage card, and says where the ledger stands in for a balance", () => {
    const at = { at: 5, ok: true, note: 'Key works' };
    expect(connectionSource({ id: 'v1', provider: 'runway', label: 'Runway', addedAt: 1, keyHint: '', test: { ...at, windows: testUsage('runway', RUNWAY_ORG) } })).toMatchObject({ provider: 'runway', category: 'video', status: 'ready', windows: [{ name: 'Balance', used: 1250 }, { name: 'gen4_turbo today' }] });
    expect(connectionSource({ id: 'v2', provider: 'gemini-video', label: 'Google video', addedAt: 1, keyHint: '', test: at })?.note).toMatch(/ledger/);
  });
});

describe('image providers (#368)', () => {
  it('lists Nano Banana and OpenAI Images under Image, on the Gemini and OpenAI keys, and says the subscription stays out', () => {
    expect(PROVIDERS.filter((p) => p.category === 'image').map((p) => [p.id, p.sharesKeyWith, p.usage, p.icon])).toEqual([
      ['nano-banana', 'gemini', 'gemini', 'banana'],
      ['openai-images', 'openai', 'openai', 'image'],
    ]);
    expect(PROVIDERS.find((p) => p.id === 'nano-banana')?.note).toMatch(/Google AI Plus.*Gemini app and Flow, not through the API/);
    // Only live models: no Imagen, DALL·E or gpt-image-1, all shut down.
    expect(Object.values(IMAGE_MODELS).flat().filter((m) => /imagen|dall-e|gpt-image-1/.test(m))).toEqual([]);
  });

  it('tests each with a models list: a GET with only its key, no generation', () => {
    const reqs = ['nano-banana', 'openai-images'].map((id) => testRequest(id, 'k'));
    expect(reqs).toEqual([
      { kind: 'http', url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', headers: { 'x-goog-api-key': 'k' } },
      { kind: 'http', url: 'https://api.openai.com/v1/models', headers: { Authorization: 'Bearer k' } },
    ]);
    expect(keyProblem('openai-images', 'sk-ant-api03-x')).toMatch(/not an OpenAI/);
  });

  it("names only the catalogue's image models the key's list has", () => {
    const gemini = { models: [{ name: 'models/gemini-3-flash' }, { name: 'models/gemini-3-pro-image' }, { name: 'models/gemini-2.5-flash-image' }, { name: 'models/imagen-4.0-generate' }] };
    expect(imageModels('nano-banana', gemini)).toEqual(['gemini-3-pro-image', 'gemini-2.5-flash-image']);
    const openai = { data: [{ id: 'gpt-5' }, ...IMAGE_MODELS['openai-images'].map((id) => ({ id })), { id: 'dall-e-3' }] };
    expect(testPlan('openai-images', openai)).toBe('gpt-image-2.6-sunburst, gpt-image-2.6-flare, gpt-image-2.5-sunburst +2');
    expect(testPlan('nano-banana', { models: [{ name: 'models/gemini-3-flash' }] })).toBe('No image models on this key');
    expect(testPlan('openai', openai)).toBeUndefined();
  });

  it('puts each on the usage card as an image row whose spend the office ledger counts', () => {
    const at = { at: 5, ok: true, note: 'Key works', plan: 'gemini-3-pro-image' };
    expect(connectionSource({ id: 'i1', provider: 'nano-banana', label: 'Nano Banana', addedAt: 1, keyHint: '', test: at })).toMatchObject({ id: 'provider:i1', provider: 'gemini', category: 'image', plan: 'gemini-3-pro-image', status: 'ready', windows: [], note: expect.stringMatching(/ledger/) });
    expect(connectionSource({ id: 'i2', provider: 'openai-images', label: 'OpenAI Images', addedAt: 1, keyHint: '', test: at })).toMatchObject({ provider: 'openai', category: 'image', note: expect.stringMatching(/ledger/) });
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
