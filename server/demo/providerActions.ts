// The demo's provider actions (#602): GitHub, the OpenAI-style inference APIs and ElevenLabs answered in memory, and a
// few Upstash boxes. A key with "bad" in it is turned away (401); a GitHub token with "noadmin" lacks Administration
// (write), one with "nosecrets" Secrets (read). Microsoft Entra (#621): the token exchange and Graph's app registrations,
// service principals and consent grants; an admin app with "noconsent" can't grant consent. `world.entra.secrets` holds
// every client secret Graph handed out, so tests can look for them. `calls` records each request and whether its key came with it (the
// tests check the key reached the provider and nothing else). The demo CEO shows a read and a write card.
import type { ActionRequest, ActionResponse, ProviderHttp } from '../providerActions/types.ts';
import type { BoxApi, BoxInfo } from '../box.ts';
import { registerCeoReply, registerDemo } from './registry.ts';
import { fakeClipfarm, fakeGoogle } from './gcloud.ts';
import { fakeExchange, type TokenInfo } from './exchange.ts';

export const DEMO_REPO = 'demo-co/storefront';

type GraphApp = { id: string; appId: string; displayName: string; web?: { redirectUris?: string[] }; requiredResourceAccess?: unknown[]; passwordCredentials: { keyId: string; endDateTime: string }[] };

/** A fake of every provider's API the layer calls. */
export function fakeProviderHttp() {
  const repo = { full_name: DEMO_REPO, default_branch: 'main', private: true, allow_auto_merge: false, delete_branch_on_merge: false, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: false, permissions: { admin: true } };
  const world = { repo, secrets: ['NPM_TOKEN', 'DEPLOY_KEY'], protection: null as string[] | null, reruns: [] as number[], runs: [{ id: 4242, name: 'CI', head_branch: 'swarm/issue-7', conclusion: 'failure', created_at: '2026-11-12T09:30:00Z' }] };
  const entra = { apps: [] as GraphApp[], sps: [{ id: 'sp-graph', appId: '00000003-0000-0000-c000-000000000000' }], grants: [] as { id: string; clientId: string; consentType: string; resourceId: string; scope: string }[], secrets: [] as string[], tenants: [] as string[] };
  Object.assign(world, { entra });
  const calls: (ActionRequest & { key: string })[] = [];
  const google = fakeGoogle();
  const clipfarm = fakeClipfarm();
  const exchange = fakeExchange(); // #668
  const tokens = new Map<string, TokenInfo>();
  const ok = (body: unknown, status = 200): ActionResponse => ({ status, body });
  const denied = (perm: string): ActionResponse => ({ status: 403, body: { message: 'Resource not accessible by personal access token' }, headers: { 'x-accepted-github-permissions': perm } });
  const github = (key: string, req: ActionRequest): ActionResponse => {
    const p = req.url.replace('https://api.github.com', '');
    const base = `/repos/${DEMO_REPO}`;
    if (!p.startsWith(base)) return { status: 404, body: { message: 'Not Found' } };
    const rest = p.slice(base.length);
    if (rest.startsWith('/actions/secrets')) {
      if (/nosecrets/i.test(key)) return denied('secrets=read');
      if (req.method === 'DELETE') {
        world.secrets = world.secrets.filter((s) => `/actions/secrets/${s}` !== rest);
        return ok(undefined, 204);
      }
      return ok({ total_count: world.secrets.length, secrets: world.secrets.map((name) => ({ name, updated_at: '2026-10-01T00:00:00Z' })) });
    }
    if (rest.startsWith('/actions/runs')) {
      const m = rest.match(/^\/actions\/runs\/(\d+)(\/rerun-failed-jobs)?/);
      if (m?.[2]) {
        world.reruns.push(Number(m[1]));
        return ok({}, 201);
      }
      if (m) return world.runs.find((r) => r.id === Number(m[1])) ? ok(world.runs.find((r) => r.id === Number(m[1]))) : { status: 404, body: { message: 'Not Found' } };
      return ok({ total_count: world.runs.length, workflow_runs: world.runs });
    }
    if (rest.match(/^\/branches\/[^/]+\/protection$/)) {
      if (/noadmin/i.test(key) && req.method !== 'GET') return denied('administration=write');
      if (req.method === 'PUT') world.protection = [...((req.body as { required_status_checks: { contexts: string[] } }).required_status_checks.contexts)];
      return world.protection ? ok({ required_status_checks: { strict: false, contexts: world.protection } }) : { status: 404, body: { message: 'Branch not protected' } };
    }
    if (rest === '') {
      if (req.method === 'PATCH') {
        if (/noadmin/i.test(key)) return denied('administration=write');
        Object.assign(world.repo, req.body);
      }
      return ok({ ...world.repo, permissions: { admin: !/noadmin/i.test(key) } });
    }
    return { status: 404, body: { message: 'Not Found' } };
  };
  let seq = 0;
  const graph = (key: string, req: ActionRequest): ActionResponse => {
    const [p, query = ''] = req.url.replace('https://graph.microsoft.com/v1.0', '').split('?');
    const filter = new URLSearchParams(query).get('$filter') ?? '';
    const eq = (field: string) => filter.match(new RegExp(`${field} eq '([^']*)'`))?.[1];
    if (p === '/applications') {
      if (req.method === 'POST') {
        entra.apps.push({ id: `obj-${++seq}`, appId: `0000c1f0-0000-4000-8000-${String(seq).padStart(12, '0')}`, ...(req.body as Omit<GraphApp, 'id' | 'appId' | 'passwordCredentials'>), passwordCredentials: [] });
        return ok(entra.apps.at(-1), 201);
      }
      const name = eq('displayName');
      return ok({ value: structuredClone(entra.apps.filter((a) => name === undefined || a.displayName === name.replace(/''/g, "'"))) });
    }
    const app = p.match(/^\/applications\/([^/]+)(\/\w+)?$/);
    if (app) {
      const a = entra.apps.find((x) => x.id === app[1]);
      if (!a) return { status: 404, body: { error: { code: 'Request_ResourceNotFound' } } };
      if (app[2] === '/addPassword') {
        const secretText = `entra-secret-${++seq}-Xq~${Math.random().toString(36).slice(2)}`;
        entra.secrets.push(secretText);
        const cred = { keyId: `key-${seq}`, endDateTime: (req.body as { passwordCredential: { endDateTime: string } }).passwordCredential.endDateTime };
        a.passwordCredentials.push(cred);
        return ok({ ...cred, secretText });
      }
      if (app[2] === '/removePassword') {
        a.passwordCredentials = a.passwordCredentials.filter((c) => c.keyId !== (req.body as { keyId: string }).keyId);
        return ok(undefined, 204);
      }
      if (req.method === 'PATCH') Object.assign(a, req.body);
      return ok(structuredClone(a));
    }
    if (p === '/servicePrincipals') {
      if (req.method === 'POST') {
        entra.sps.push({ id: `sp-${++seq}`, appId: (req.body as { appId: string }).appId });
        return ok(entra.sps.at(-1), 201);
      }
      return ok({ value: entra.sps.filter((x) => x.appId === eq('appId')) });
    }
    if (p.startsWith('/oauth2PermissionGrants')) {
      if (/noconsent/i.test(key)) return { status: 403, body: { error: { code: 'Authorization_RequestDenied', message: 'Insufficient privileges to complete the operation.' } } };
      const id = p.split('/')[2];
      if (req.method === 'POST') {
        entra.grants.push({ id: `grant-${++seq}`, ...(req.body as Omit<(typeof entra.grants)[number], 'id'>) });
        return ok(entra.grants.at(-1), 201);
      }
      if (req.method === 'PATCH') {
        Object.assign(entra.grants.find((g) => g.id === id) ?? {}, req.body);
        return ok(undefined, 204);
      }
      return ok({ value: entra.grants.filter((g) => g.clientId === eq('clientId') && g.resourceId === eq('resourceId')) });
    }
    return { status: 404, body: { error: { code: 'BadRequest' } } };
  };
  const models = (ids: string[]) => ok({ object: 'list', data: ids.map((id) => ({ id, object: 'model' })) });
  const http: ProviderHttp = async (key, req) => {
    calls.push({ ...req, key });
    await new Promise((r) => setTimeout(r, 5));
    const other = google.handle(key, req) ?? clipfarm.handle(key, req); // before "bad": a private key's base64 may spell it
    if (other) return other;
    if (/bad/i.test(key)) return { status: 401, body: { error: { message: 'Invalid API key' } } };
    const u = req.url;
    if (u.startsWith('https://api.github.com')) return github(key, req);
    const login = u.match(/^https:\/\/login\.microsoftonline\.com\/([^/]+)\/oauth2\/v2\.0\/token$/);
    if (login && req.auth === 'entra-token') {
      entra.tenants.push(login[1]);
      if (!key.includes(':')) return { status: 401, body: { error: 'invalid_client' } };
      const token = `graph-token-${/noconsent/i.test(key) ? 'noconsent-' : ''}${/noexo/i.test(key) ? 'noexo-' : ''}${++seq}`;
      tokens.set(token, { tenant: login[1], client: key.slice(0, key.indexOf(':')) });
      return ok({ token_type: 'Bearer', expires_in: 3599, access_token: token });
    }
    const mail = exchange.handle(key, req, tokens.get(key));
    if (mail) return mail;
    if (u.startsWith('https://graph.microsoft.com/v1.0')) return graph(key, req);
    if (u === 'https://openrouter.ai/api/v1/key') return ok({ data: { label: 'demo', usage: 3.4, limit: 10, limit_remaining: 6.6 } });
    if (u === 'https://openrouter.ai/api/v1/models') return models(['anthropic/claude-sonnet-5.5', 'openai/gpt-5', 'google/gemini-3-flash']);
    if (u.startsWith('https://api.openai.com')) return models(['gpt-5', 'gpt-5-mini', 'gpt-image-2.6-flare']);
    if (u.startsWith('https://aihubmix.com')) return models(['gpt-5', 'claude-sonnet-5-5', 'deepseek-v4']);
    if (u.startsWith('https://api.cerebras.ai')) return models(['llama-4-scout-17b', 'qwen-3-235b']);
    if (u.startsWith('https://integrate.api.nvidia.com')) return models(['meta/llama-4-maverick', 'nvidia/nemotron-ultra']);
    if (u.startsWith('https://api.nvcf.nvidia.com')) return ok({ functions: [] });
    if (u === 'https://api.elevenlabs.io/v1/user') return ok({ subscription: { tier: 'starter' } });
    if (u === 'https://api.elevenlabs.io/v1/voices') return ok({ voices: [{ voice_id: 'v-rachel', name: 'Rachel', category: 'premade' }, { voice_id: 'v-office', name: 'Office narrator', category: 'cloned' }] });
    if (u === 'https://api.elevenlabs.io/v1/user/subscription') return ok({ tier: 'starter', character_count: 12_480, character_limit: 30_000, next_character_count_reset_unix: 1_765_000_000 });
    return { status: 404, body: { message: 'No such route' } };
  };
  return { http, calls, world, google: google.world, clipfarm: clipfarm.world, exchange };
}

/** A few Upstash boxes, two of them the office's. */
export function fakeBoxes(): BoxApi & { boxes: BoxInfo[] } {
  const boxes: BoxInfo[] = [
    { id: 'box-ada', name: 'cubefarm-ada', labels: ['cubefarm'], status: 'running' },
    { id: 'box-old', name: 'scratch', labels: [], status: 'paused' },
  ];
  const find = (id: string) => boxes.find((b) => b.id === id);
  const set = (id: string, status: BoxInfo['status']) => {
    const b = find(id);
    if (b) b.status = status;
  };
  const no = () => Promise.reject(new Error('not in the demo'));
  return {
    boxes,
    list: async () => boxes.map((b) => ({ ...b })),
    get: async (id) => (find(id) ? { ...find(id)! } : null),
    resume: async (id) => set(id, 'running'),
    pause: async (id) => set(id, 'paused'),
    remove: async (id) => void boxes.splice(boxes.findIndex((b) => b.id === id), 1),
    create: no,
    run: no,
    read: no,
    write: no,
    files: no,
    session: no,
    browser: no,
  };
}

registerDemo('provider actions', () => ({ providerHttp: fakeProviderHttp().http }));

// "What can the office do with our GitHub key?": a read, then a merge setting on a card with its diff.
registerCeoReply('provider actions', async ({ text, use }) => {
  if (!/\bprovider (action|op)s?\b|\bgithub (key|token|settings?)\b|\bopenrouter credit\b/i.test(text)) return null;
  const credit = await use('provider_action', { provider: 'openrouter', op: 'credit' });
  const repo = await use('provider_action', { provider: 'github', op: 'repo_get', args: { repo: DEMO_REPO } });
  const card = await use('provider_action', { provider: 'github', op: 'repo_settings', args: { repo: DEMO_REPO, delete_branch_on_merge: true }, why: 'Merged branches pile up: GitHub can delete them after each merge.' });
  const first = (s: string) => s.split('\n')[0].replace(/^Refused:\s*/, '');
  return `With the office's own keys (never shown to me):\n- OpenRouter: ${first(credit)}\n- GitHub: ${first(repo)}\n\n${card.startsWith('Refused') ? `I couldn't plan the change: ${first(card)}` : 'One change is on a card with its before and after: delete merged branches automatically. Tap Approve and it is applied and read back.'}`;
}, { early: true }); // before the demo's files, which answer about the chat's last attachment

// "Sign in with Microsoft on clip": the Entra app registration's card (#621); Approve, then the IdP and the app's logins.
registerCeoReply('entra sign-in', async ({ text, use }) => {
  if (!/\b(entra|sign in with microsoft|microsoft sign-in)\b/i.test(text)) return null;
  const card = await use('provider_action', { provider: 'entra', op: 'entra_app_ensure', why: 'Microsoft sign-in for clip.techinsiderbytes.com through Cloudflare Access.' });
  return card.startsWith('Refused') ? `I couldn't plan it: ${card.split('\n')[0]}` : 'Step 1 of 3 is on a card: register the "Cloudflare Access" app in Entra (its secret goes straight into the office\'s key store). After Approve I add the Entra ID login to Access and attach it to clip, keeping the Google login.';
}, { early: true });
