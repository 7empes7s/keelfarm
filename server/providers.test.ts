import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '../shared/types.ts';
import { providerCards } from '../shared/providers.ts';
import { EMPTY_CLOUD } from '../shared/cloud.ts';
import { redact } from '../shared/journal.ts';
import type { ProbeRequest, ProbeResult } from '../shared/providers.ts';
import { createChecklist, fillSecret } from '../shared/checklists.ts';

// Its own folder: the demo's secrets files are read straight from SWARM_HOME.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-providers-'));
process.env.SWARM_HOME = home;
const { Providers, readProvidersFile, klingToken } = await import('./providers.ts');
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
  it('saves from two offices on one file at once without a torn rename (#602: parallel test files share it)', async () => {
    const dir = fs.mkdtempSync(path.join(home, 'race-'));
    const [a, b] = [store(dir).p, store(dir).p];
    await Promise.all([a.init(), b.init()]);
    const adds = Array.from({ length: 10 }, (_, i) => [a, b][i % 2].add('openrouter', `sk-or-race-key-${i}-0000`));
    await expect(Promise.all(adds)).resolves.toHaveLength(10);
  });

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
    expect(changed).toHaveBeenCalledWith({ connections: [], mcp: [], defaults: {}, clients: [] });
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
      connections: [{ id: 'y', provider: 'gemini', label: 'Google Gemini API', addedAt: 0, keyHint: '', test: null, tags: [], usedFor: 'inference' }],
      mcp: [],
      defaults: {},
      clients: [],
    });
  });
});

describe('one sign-in per company and permission checks (#533)', () => {
  const ACCOUNT = '0123456789abcdef0123456789abcdef';

  it('signs in against a fake Google: tokens kept server-side only, refreshed when they run out, one connection per company', async () => {
    const dir = fs.mkdtempSync(path.join(home, 'oauth-'));
    let n = 0;
    const probe = vi.fn(async (req: ProbeRequest): Promise<ProbeResult> => {
      if (req.kind === 'form') return { status: 200, body: { access_token: `ya29.access-${++n}`, ...(req.form.grant_type === 'authorization_code' ? { refresh_token: '1//refresh-secret' } : {}), expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/youtube.upload' } };
      return { status: 200, body: { email: 'boss@example.com' } };
    });
    const p = new Providers({ file: path.join(dir, 'providers.json'), secretsFile: path.join(dir, 'secrets.json'), probe, changed: vi.fn() });
    await p.init();
    expect(() => p.oauthStart('google', 'http://localhost:4317')).toThrow(/client ID and secret/);
    await p.setClient('google', 'cid.apps.googleusercontent.com', 'client-secret-xyz');
    const { url } = p.oauthStart('google', 'http://localhost:4317');
    const q = new URL(url).searchParams;
    expect(q.get('redirect_uri')).toBe('http://localhost:4317/api/oauth/callback');
    await expect(p.oauthFinish('forged', 'code')).rejects.toThrow(/expired or was already used/);

    const c = await p.oauthFinish(q.get('state')!, 'auth-code');
    expect(probe).toHaveBeenCalledWith({ kind: 'form', url: 'https://oauth2.googleapis.com/token', form: { grant_type: 'authorization_code', code: 'auth-code', redirect_uri: 'http://localhost:4317/api/oauth/callback', client_id: 'cid.apps.googleusercontent.com', client_secret: 'client-secret-xyz' } });
    expect(c).toMatchObject({ provider: 'google', scopes: ['openid', 'email', 'https://www.googleapis.com/auth/youtube.upload'], test: { ok: true, plan: 'boss@example.com' } });
    await expect(p.oauthFinish(q.get('state')!, 'auth-code')).rejects.toThrow(/already used/); // a state works once
    const view = JSON.stringify(p.view());
    for (const secret of ['1//refresh-secret', 'ya29.access-1', 'client-secret-xyz']) {
      expect(view).not.toContain(secret);
      expect(fs.readFileSync(path.join(dir, 'providers.json'), 'utf8')).not.toContain(secret);
    }
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'))).toMatchObject({ [`provider:${c.id}`]: '1//refresh-secret', [`oauth-access:${c.id}`]: 'ya29.access-1' });
    expect(p.view().clients).toEqual(['google']);

    // a fresh token is used as is; one about to run out is refreshed with the refresh token
    expect(await p.accessToken(c.id)).toBe('ya29.access-1');
    const inner = (p as unknown as { data: { connections: { expiresAt?: number }[] } }).data.connections[0];
    inner.expiresAt = Date.now() + 1000;
    expect(await p.accessToken(c.id)).toBe('ya29.access-2');
    expect(probe).toHaveBeenLastCalledWith({ kind: 'form', url: 'https://oauth2.googleapis.com/token', form: expect.objectContaining({ grant_type: 'refresh_token', refresh_token: '1//refresh-secret' }) });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'))[`provider:${c.id}`]).toBe('1//refresh-secret'); // kept when none came back

    // signing in again keeps one connection
    const again = p.oauthStart('google', 'http://localhost:4317');
    await p.oauthFinish(new URL(again.url).searchParams.get('state')!, 'code-2');
    expect(p.view().connections.filter((x) => x.provider === 'google')).toHaveLength(1);
    await expect(p.add('google', 'a-key')).rejects.toThrow(/Sign in with Google/);
  });

  it("says a refused refresh means signing in again, and the demo's consent needs no client", async () => {
    const dir = fs.mkdtempSync(path.join(home, 'oauth-demo-'));
    let refuse = false;
    const probe = vi.fn(async (req: ProbeRequest): Promise<ProbeResult> => (req.kind === 'form' ? (refuse ? { status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } : { status: 200, body: { access_token: 'a', refresh_token: 'r', expires_in: 1 } }) : { status: 200, body: { name: 'Demo Studio' } }));
    const changed = vi.fn();
    const p = new Providers({ file: path.join(dir, 'providers.json'), secretsFile: path.join(dir, 'secrets.json'), probe, changed, fakeConsent: true });
    await p.init();
    expect(p.view().clients).toEqual(['google', 'meta', 'tiktok', 'microsoft']);
    const { url } = p.oauthStart('meta', 'http://127.0.0.1:5829');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:5829\/api\/oauth\/callback\?state=\w+&code=demo-consent$/);
    const c = await p.oauthFinish(new URL(url).searchParams.get('state')!, 'demo-consent');
    expect(c.test?.plan).toBe('Demo Studio');
    refuse = true;
    expect((await p.test(c.id)).test).toMatchObject({ ok: false, result: 'dead', note: 'Sign in with Meta again: Token has been expired or revoked.' });
  });

  it("tests a Cloudflare account token on its account and names what it lacks; a GitHub token on the floor's repo", async () => {
    const dir = fs.mkdtempSync(path.join(home, 'perms-'));
    const probe = vi.fn(async (req: ProbeRequest): Promise<ProbeResult> => {
      const url = req.kind === 'command' ? '' : req.url;
      if (url.includes('/zones?')) return { status: 200, body: { result: [{ id: 'z1' }] } };
      if (url.includes('/dns_records')) return { status: 403, body: { errors: [{ code: 10000 }] } };
      if (url.includes('/pulls')) return { status: 403, headers: { 'x-accepted-github-permissions': 'pull_requests=read' } };
      return { status: 200, body: { result: { status: 'active' } } };
    });
    const changed = vi.fn();
    const p = new Providers({ file: path.join(dir, 'providers.json'), secretsFile: path.join(dir, 'secrets.json'), probe, changed, repo: () => 'acme/app' });
    await p.init();
    await expect(p.add('cloudflare', 'cf-token', '', '', 'not-an-id')).rejects.toThrow(/32 letters and digits/);
    const cf = await p.add('cloudflare', 'cf-token', '', '', ACCOUNT);
    expect(probe).toHaveBeenCalledWith({ kind: 'http', url: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/tokens/verify`, headers: { Authorization: 'Bearer cf-token' } });
    expect(cf.test).toMatchObject({ ok: true, result: 'live', missing: ['Zone DNS edit'], note: 'Missing: Zone DNS edit' });
    const gh = await p.add('github', 'github_pat_abc');
    expect(gh.test).toMatchObject({ missing: ['Pull requests (read)'], note: 'Missing: Pull requests (read)' });
  });
});

describe('an Entra key and its Tenant ID (#677)', () => {
  const TENANT = '73b6beef-9d40-4ea6-8ad6-2da6b4818f29';
  const KEY = 'client-0001:secret-value-Hc85';
  /** Graph's sign-in, faked: only the tenant (by GUID, or by the verified domain) signs the app in; its token names the tenant. */
  const graph = () =>
    vi.fn(async (req: ProbeRequest): Promise<ProbeResult> => {
      const t = req.kind === 'form' ? req.url.split('/')[3] : '';
      return t === TENANT || t === 'techinsiderbytes.com' ? { status: 200, body: { access_token: `e30.${Buffer.from(JSON.stringify({ tid: TENANT })).toString('base64url')}.sig` } } : { status: 400, body: { error: 'invalid_request' } };
    });
  const entra = (probe: ReturnType<typeof graph>, hints: string[] = []) => {
    const dir = fs.mkdtempSync(path.join(home, 'entra-'));
    return new Providers({ file: path.join(dir, 'providers.json'), secretsFile: path.join(dir, 'secrets.json'), probe, changed: vi.fn(), tenantHints: () => hints });
  };

  it('saves a checklist secret with its Tenant ID on the same entry, and tests it there', async () => {
    const probe = graph();
    const p = entra(probe);
    await p.init();
    const s = { seq: 0, list: [] };
    const c = createChecklist(s, { title: 'Connect the shared mailboxes', steps: [{ title: 'Paste the admin app', secret: { label: 'client id:client secret', provider: 'entra' } }] }, 1);
    const r = await fillSecret(c, 's1', KEY, (provider, label, v, acct) => p.add(provider, v, label, '', acct), () => 2, ` ${TENANT} `);
    expect(r).not.toHaveProperty('error');
    const [conn] = p.view().connections;
    expect(conn).toMatchObject({ provider: 'entra', accountId: TENANT, keyHint: 'Hc85', test: { ok: true, result: 'live' } });
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ url: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token` }));
    expect(c.steps[0].secret?.saved).toMatchObject({ connectionId: conn.id, hint: 'Hc85' });
  });

  it('lets an entry saved without one get its Tenant ID later, without the key, and then passes its test', async () => {
    const probe = graph();
    const p = entra(probe);
    await p.init();
    const c = await p.add('entra', KEY, 'client id:client secret · Connect the shared mailboxes');
    expect(c.accountId).toBeUndefined();
    expect(c.test).toMatchObject({ ok: false, note: expect.stringMatching(/^Add its Tenant ID/) });
    expect(probe).not.toHaveBeenCalled();
    const fixed = await p.update(c.id, { accountId: TENANT });
    expect(fixed).toMatchObject({ accountId: TENANT, keyHint: 'Hc85', test: { ok: true, result: 'live', note: 'Key works' } });
    expect(p.keyValue(c.id)).toBe(KEY); // the key itself untouched
    await expect(p.update(c.id, { accountId: 'not a tenant' })).rejects.toThrow(/Tenant ID looks like/);
  });

  it("tries the office's verified domain as the tenant when there is none, and keeps the tenant GUID it signed in to", async () => {
    const probe = graph();
    const p = entra(probe, ['nope.example', 'techinsiderbytes.com', 'techinsiderbytes.com']);
    await p.init();
    const c = await p.add('entra', KEY);
    expect(probe.mock.calls.map(([req]) => (req.kind === 'form' ? req.url : ''))).toEqual(['https://login.microsoftonline.com/nope.example/oauth2/v2.0/token', 'https://login.microsoftonline.com/techinsiderbytes.com/oauth2/v2.0/token']);
    expect(c).toMatchObject({ accountId: TENANT, test: { ok: true, note: 'Key works; Tenant ID found from techinsiderbytes.com' } });

    const none = entra(graph(), ['nope.example']);
    await none.init();
    const d = await none.add('entra', KEY);
    expect(d.accountId).toBeUndefined();
    expect(d.test).toMatchObject({ ok: false, result: 'unknown', note: "Add its Tenant ID: nope.example didn't sign it in (invalid_request)" });
  });

  it('edits every field but the key on any entry, whoever saved it', async () => {
    const p = entra(graph());
    await p.init();
    const c = await p.add('openai', OPENAI, 'Imported');
    const e = await p.update(c.id, { usedBy: 'clipfarm transcription', label: 'OpenAI (clipfarm)' });
    expect(e).toMatchObject({ usedBy: 'clipfarm transcription', label: 'OpenAI (clipfarm)', keyHint: '9f3a' });
    expect((await p.update(c.id, { usedBy: '' })).usedBy).toBeUndefined();
  });
});

describe('rename and tags (#523)', () => {
  it("saves a key's name, tags and Used for, which survive a restart, and never puts the key in the file or the view", async () => {
    const dir = fs.mkdtempSync(path.join(home, 'edit-'));
    const { p, changed } = store(dir);
    await p.init();
    const cf = await p.add('cloudflare', 'cf-secret-token-0000aa11');
    const cerebras = await p.add('cerebras', 'csk-secret-paid-0000bb22', 'Cerebras (CEREBRAS_API_KEY_PAID, LiteLLM litellm.env)');
    // The default comes from the catalogue's category: cloud runs things, text is a model.
    expect([cf.usedFor, cerebras.usedFor]).toEqual(['operations', 'inference']);

    changed.mockClear();
    const done = await p.update(cerebras.id, { label: '  Cerebras paid ', tags: 'Inference, paid, inference, bad tag!', usedFor: 'both' });
    expect(done).toMatchObject({ label: 'Cerebras paid', tags: ['inference', 'paid', 'bad'], usedFor: 'both', named: true });
    expect(changed).toHaveBeenCalled();
    await expect(p.update(cerebras.id, { usedFor: 'billing' as never })).rejects.toThrow(/AI inference, Operations or Both/);
    await expect(p.update('gone', { label: 'x' })).rejects.toThrow(/No such connection/);
    expect((await p.update(cf.id, { label: '   ' })).label).toBe('Cloudflare'); // an empty name: the provider's

    const again = store(dir).p;
    await again.init();
    expect(again.view().connections.find((c) => c.id === cerebras.id)).toMatchObject({ label: 'Cerebras paid', tags: ['inference', 'paid', 'bad'], usedFor: 'both' });
    const text = fs.readFileSync(path.join(dir, 'providers.json'), 'utf8') + JSON.stringify(again.view());
    for (const k of ['cf-secret-token-0000aa11', 'csk-secret-paid-0000bb22']) expect(text).not.toContain(k);
  });

  it("cleans an import's old name into its provider's name and a source line, and leaves the manager's names alone", () => {
    const view = readProvidersFile({
      connections: [
        { id: 'a', provider: 'cerebras', label: 'Cerebras (CEREBRAS_API_KEY_PAID, LiteLLM litellm.env)' },
        { id: 'b', provider: 'openrouter', label: 'OpenRouter (LiteLLM litellm.env)' },
        { id: 'c', provider: 'openrouter', label: 'OpenRouter (work)' },
        { id: 'd', provider: 'cloudflare', label: 'Cloudflare (Control Surface .env)', named: true },
        { id: 'e', provider: 'cloudflare', label: 'Cloudflare', usedFor: 'both', tags: ['dns'] },
      ],
    });
    expect(view.connections.map((c) => [c.label, c.source ?? null, c.usedFor, c.tags])).toEqual([
      ['Cerebras (paid)', 'CEREBRAS_API_KEY_PAID · LiteLLM litellm.env', 'inference', []],
      ['OpenRouter', 'OPENROUTER_API_KEY · LiteLLM litellm.env', 'inference', []],
      ['OpenRouter (work)', null, 'inference', []],
      ['Cloudflare (Control Surface .env)', null, 'operations', []],
      ['Cloudflare', null, 'both', ['dns']],
    ]);
  });

  it('keeps a test that worked but found no credit as No credit', async () => {
    const dir = fs.mkdtempSync(path.join(home, 'credit-'));
    const { p } = store(dir, vi.fn(async () => ({ status: 402 })));
    await p.init();
    expect((await p.add('groq', 'gsk_nocredit_00001234')).test).toMatchObject({ ok: false, result: 'no-credit' });
  });
});

describe('video keys (#364)', () => {
  it("signs Kling's access key and secret into a short JWT, and sends the secret nowhere", async () => {
    const token = klingToken('ak-123:sk-secret-456', 1_800_000_000_000);
    const [head, body, sig] = token.split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual({ iss: 'ak-123', exp: 1_800_001_800, nbf: 1_799_999_995 });
    const { createHmac } = await import('node:crypto');
    expect(sig).toBe(createHmac('sha256', 'sk-secret-456').update(`${head}.${body}`).digest('base64url'));
    expect(klingToken('one-api-key')).toBe('one-api-key');

    const dir = fs.mkdtempSync(path.join(home, 'kling-'));
    const { p, probe, changed } = store(dir, vi.fn(async () => ({ status: 200, body: { data: { resource_pack_subscribe_infos: [] } } })));
    await p.init();
    const c = await p.add('kling', 'ak-123:sk-secret-456');
    const sent = JSON.stringify(probe.mock.calls);
    expect(sent).not.toContain('sk-secret-456');
    expect(sent).toContain('Bearer ey');
    for (const text of [JSON.stringify(p.view()), JSON.stringify(changed.mock.calls), fs.readFileSync(path.join(dir, 'providers.json'), 'utf8')]) expect(text).not.toContain('sk-secret-456');
    expect(c.keyHint).toBe('-456');
  });

  it("reuses the saved Gemini key for Google video when its key is left empty, and keeps the key out of the view", async () => {
    const dir = fs.mkdtempSync(path.join(home, 'veo-'));
    const { p, probe } = store(dir, vi.fn(async () => ({ status: 200, body: { models: [{ name: 'models/gemini-omni-1.2-flash' }] } })));
    await p.init();
    await expect(p.add('gemini-video', '')).rejects.toThrow(/Paste the key/);
    await p.add('gemini', 'AIzaSy-gemini-secret-1234');
    const v = await p.add('gemini-video', '  ');
    expect(probe).toHaveBeenLastCalledWith(expect.objectContaining({ headers: { 'x-goog-api-key': 'AIzaSy-gemini-secret-1234' } }));
    expect(v.test).toMatchObject({ ok: true, plan: 'gemini-omni-1.2-flash' });
    expect(JSON.stringify(p.view())).not.toContain('gemini-secret');
  });

  it("keeps a Runway answer's usage only when the key worked", async () => {
    const dir = fs.mkdtempSync(path.join(home, 'runway-'));
    const { p } = store(dir, vi.fn(async () => ({ status: 401, body: { creditBalance: 5 } })));
    await p.init();
    const c = await p.add('runway', 'key_runway-secret');
    expect(c.test).toMatchObject({ ok: false });
    expect(c.test?.windows).toBeUndefined();
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
    expect(new Set(cards.map((c) => c.category))).toEqual(new Set(['coding', 'text', 'audio', 'video', 'image', 'cloud', 'mcp']));
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
