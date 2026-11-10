import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '../shared/types.ts';
import { providerCards } from '../shared/providers.ts';
import { EMPTY_CLOUD } from '../shared/cloud.ts';
import { redact } from '../shared/journal.ts';

// Its own folder: the demo's secrets files are read straight from SWARM_HOME.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-providers-'));
process.env.SWARM_HOME = home;
const { Providers, readProvidersFile } = await import('./providers.ts');
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

const OPENAI = 'sk-proj-supersecret-openai-key-9f3a';
const ELEVEN = 'sk_0123456789abcdef0123456789abcdef0123';
const UPSTASH = 'upstash-box-key-secret-77aa';

function store(dir: string, probe = vi.fn(async () => ({ status: 200 }))) {
  const changed = vi.fn();
  const p = new Providers({ file: path.join(dir, 'providers.json'), secretsFile: path.join(dir, 'secrets.json'), probe, changed });
  return { p, changed, probe };
}

describe('the providers store', () => {
  it('keeps keys in the secrets file only, tests them, and tells the tabs on every change', async () => {
    const dir = fs.mkdtempSync(path.join(home, 'store-'));
    const { p, changed, probe } = store(dir);
    await p.init();
    const c = await p.add('openai', OPENAI, 'Work key');
    expect(c).toMatchObject({ provider: 'openai', label: 'Work key', keyHint: '9f3a', test: { ok: true } });
    expect(probe).toHaveBeenCalledWith({ kind: 'http', url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${OPENAI}` } });
    expect(fs.readFileSync(path.join(dir, 'providers.json'), 'utf8')).not.toContain(OPENAI);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'))).toEqual({ [`provider:${c.id}`]: OPENAI });
    expect(JSON.stringify(p.view())).not.toContain(OPENAI);
    expect(changed).toHaveBeenCalled();

    // A restart reads both back.
    const again = store(dir).p;
    await again.init();
    expect(again.view().connections.map((x) => x.id)).toEqual([c.id]);
    expect(again.secretValues()).toEqual([OPENAI]);

    changed.mockClear();
    await p.remove(c.id);
    expect(changed).toHaveBeenCalledWith({ connections: [], mcp: [] });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'))).toEqual({});
    await expect(p.remove(c.id)).rejects.toThrow(/No such connection/);
  });

  it("turns MCP servers into a session's config only, with their secrets, and writes nothing but its own files", async () => {
    const dir = fs.mkdtempSync(path.join(home, 'mcp-'));
    const { p } = store(dir);
    await p.init();
    const m = await p.addMcp({ name: 'github', command: 'npx -y @modelcontextprotocol/server-github', secrets: { GITHUB_TOKEN: 'ghp_mcpsecret' }, agents: ['ada'] });
    expect(m).toMatchObject({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envKeys: ['GITHUB_TOKEN'] });
    expect(JSON.stringify(p.view())).not.toContain('ghp_mcpsecret');
    expect(p.mcpFor('ada')).toEqual({ github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'ghp_mcpsecret' } } });
    expect(p.mcpFor('bob')).toEqual({});
    await p.setMcp(m.id, { on: false });
    expect(p.mcpFor('ada')).toEqual({});
    expect(fs.readdirSync(dir).sort()).toEqual(['providers.json', 'secrets.json']);
    await p.removeMcp(m.id);
    expect(p.secretValues()).toEqual([]);
  });

  it('drops anything malformed in its file', () => {
    expect(readProvidersFile({ connections: [{ id: 'x', provider: 'nope' }, { id: 'y', provider: 'gemini' }], mcp: [{ id: 'z', name: 'n' }] })).toEqual({
      connections: [{ id: 'y', provider: 'gemini', label: 'Google Gemini API', addedAt: 0, keyHint: '', test: null }],
      mcp: [],
    });
  });
});

describe('image keys (#368)', () => {
  it("reuses the saved Gemini and OpenAI keys when an image entry's key is left empty, and keeps them out of the view", async () => {
    const dir = fs.mkdtempSync(path.join(home, 'images-'));
    const { p, probe, changed } = store(dir, vi.fn(async () => ({ status: 200, body: { models: [{ name: 'models/gemini-3-pro-image' }] } })));
    await p.init();
    await expect(p.add('nano-banana', '')).rejects.toThrow(/Paste the key/);
    await p.add('gemini', 'AIzaSy-gemini-secret-1234');
    const nb = await p.add('nano-banana', '  ');
    expect(probe).toHaveBeenLastCalledWith({ kind: 'http', url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', headers: { 'x-goog-api-key': 'AIzaSy-gemini-secret-1234' } });
    expect(nb.test).toMatchObject({ ok: true, plan: 'gemini-3-pro-image' });
    await p.add('openai', OPENAI);
    await p.add('openai-images', '');
    expect(probe).toHaveBeenLastCalledWith({ kind: 'http', url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${OPENAI}` } });
    for (const text of [JSON.stringify(p.view()), JSON.stringify(changed.mock.calls), fs.readFileSync(path.join(dir, 'providers.json'), 'utf8')]) {
      expect(text).not.toContain('gemini-secret');
      expect(text).not.toContain(OPENAI);
    }
    expect(p.secretValues()).toEqual(expect.arrayContaining(['AIzaSy-gemini-secret-1234', OPENAI]));
  });

  it("keeps no plan from a turned-away key's answer", async () => {
    const { p } = store(fs.mkdtempSync(path.join(home, 'images-bad-')), vi.fn(async () => ({ status: 403, body: { models: [{ name: 'models/gemini-3-pro-image' }] } })));
    await p.init();
    const c = await p.add('nano-banana', 'AIza-bad');
    expect(c.test).toMatchObject({ ok: false });
    expect(c.test?.plan).toBeUndefined();
  });
});

describe('Settings → Providers in the office', () => {
  it('keeps the accounts, the ElevenLabs key and the Upstash key, emits an event per change, and never puts a key in the snapshot', async () => {
    // Keys saved before the Providers page: they stay where they were and show on it.
    fs.writeFileSync(path.join(home, 'demo-secrets.json'), JSON.stringify({ elevenlabsKey: ELEVEN }));
    fs.writeFileSync(path.join(home, 'demo-cloud-secrets.json'), JSON.stringify({ upstashBoxKey: UPSTASH }));
    const swarm = new Swarm(createDemoBackend());
    const events: ServerEvent[] = [];
    const inside = swarm as unknown as { broadcast(ev: ServerEvent): void; initProviders(): Promise<void>; providersLine(): string; secrets(): string[] };
    inside.broadcast = (ev) => void events.push(ev);
    await Promise.all([swarm.voice.init(), swarm.cloud.init(), swarm.accounts.init(), inside.initProviders()]);

    const snap = swarm.snapshot();
    const cards = providerCards({ accounts: snap.accounts!.accounts, voiceKeySet: snap.voiceKeySet, voiceKeyHint: snap.voiceKeyHint, cloud: snap.cloud ?? EMPTY_CLOUD, providers: snap.providers!, clis: snap.clis, agentName: (id) => id, cloudAgents: 0 });
    expect(cards.filter((c) => c.category === 'coding' && c.key.startsWith('account:')).map((c) => c.key)).toEqual(snap.accounts!.accounts.filter((a) => !a.removing).map((a) => `account:${a.id}`));
    expect(cards.find((c) => c.key === 'voice')?.keyHint).toBe(ELEVEN.slice(-4));
    expect(cards.find((c) => c.key === 'cloud')?.keyHint).toBe(UPSTASH.slice(-4));
    // The demo's made-up connections: one in every category the catalogue has.
    expect(new Set(cards.map((c) => c.category))).toEqual(new Set(['coding', 'text', 'audio', 'image', 'cloud', 'mcp']));
    expect(swarm.voice.secret()).toBe(ELEVEN);

    events.length = 0;
    const c = await swarm.providers.add('openai', OPENAI);
    expect(events.filter((e) => e.type === 'providers').length).toBeGreaterThan(0);
    const rows = events.filter((e): e is Extract<ServerEvent, { type: 'usageSources' }> => e.type === 'usageSources').at(-1)?.sources ?? [];
    expect(rows.find((r) => r.id === `provider:${c.id}`)).toMatchObject({ provider: 'openai', status: 'ready' });
    const json = JSON.stringify([swarm.snapshot(), events]);
    for (const k of [OPENAI, ELEVEN, UPSTASH, 'demo-gh-token-0000']) expect(json).not.toContain(k);
    expect(inside.providersLine()).toMatch(/^Providers: .*OpenAI API/);
    // The demo's image keys: on the Image cards, tested with the models they name, and redacted from logs.
    expect(cards.filter((c) => c.category === 'image').map((c) => [c.provider, c.status, c.plan])).toEqual([
      ['nano-banana', 'ready', 'gemini-nano-banana-2.1, gemini-3-pro-image'],
      ['openai-images', 'ready', 'gpt-image-2.6-flare, gpt-image-2.5-sunburst'],
    ]);
    for (const k of ['AIza-demo-banana-00001f2a', 'sk-demo-images-00003b4c']) {
      expect(json).not.toContain(k);
      expect(inside.secrets()).toContain(k);
      expect(redact(`log line ${k}`, inside.secrets())).not.toContain(k);
    }

    events.length = 0;
    await swarm.providers.remove(c.id);
    expect(events.find((e) => e.type === 'providers')).toMatchObject({ type: 'providers', providers: { connections: expect.not.arrayContaining([expect.objectContaining({ id: c.id })]) } });
  });
});
