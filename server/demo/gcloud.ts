// The demo's Google Cloud (#622) and clipfarm's Settings API, answered in memory: Service Usage (enable an API) and
// API Keys (create with restrictions, read the key string, delete), each write a finished operation. A service account
// whose email has "viewer" in it is refused every write (403), one with "norestrict" gets keys without their
// restriction. clipfarm's Settings take a key only with the demo's Access service token, and its Test says whether the
// key looks like a YouTube one. The demo CEO shows the whole flow for "the YouTube key".
import { generateKeyPairSync } from 'node:crypto';
import type { ActionRequest, ActionResponse } from '../providerActions/types.ts';
import { registerCeoReply } from './registry.ts';

export const DEMO_GCP = { project: 'clipfarm-demo', email: 'office@clipfarm-demo.iam.gserviceaccount.com' };
/** The demo's clipfarm Access service token, "client id:secret". */
export const DEMO_ACCESS = 'demo-access-id.access:demo-access-secret-0001';

let pem: string | null = null;

/** A service account JSON key file with a real (made-up) RSA key, so a JWT can be signed. */
export function demoServiceAccount(email = DEMO_GCP.email, project = DEMO_GCP.project): string {
  pem ??= generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return JSON.stringify({ type: 'service_account', project_id: project, private_key_id: 'demo0000keyid9f3e', private_key: pem, client_email: email, token_uri: 'https://oauth2.googleapis.com/token' });
}

interface FakeKey {
  name: string;
  uid: string;
  displayName: string;
  keyString: string;
  restrictions?: { apiTargets: { service: string }[] };
}

const denied: ActionResponse = { status: 403, body: { error: { code: 403, message: 'Permission denied on resource project.', status: 'PERMISSION_DENIED' } } };
const notFound: ActionResponse = { status: 404, body: { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } } };
const done = (response: unknown): ActionResponse => ({ status: 200, body: { name: 'operations/demo', done: true, response } });

/** Google's APIs for a service account key; null when the request isn't Google's. */
export function fakeGoogle() {
  const world = { enabled: new Set(['apikeys.googleapis.com', 'serviceusage.googleapis.com']), keys: [] as FakeKey[] };
  let n = 0;
  const handle = (key: string, req: ActionRequest): ActionResponse | null => {
    if (!/\.googleapis\.com\//.test(req.url) || req.auth !== 'google-sa') return null;
    let sa: { client_email?: string; project_id?: string };
    try {
      sa = JSON.parse(key) as typeof sa;
    } catch {
      return { status: 401, body: { error: { message: 'invalid_grant' } } };
    }
    const email = sa.client_email ?? '';
    if (req.method !== 'GET' && /viewer/.test(email)) return denied;
    const u = new URL(req.url);
    const p = u.pathname;
    if (u.host === 'cloudresourcemanager.googleapis.com') return p === `/v1/projects/${sa.project_id}` ? { status: 200, body: { projectId: sa.project_id, name: 'clipfarm', lifecycleState: 'ACTIVE' } } : notFound;
    if (u.host === 'serviceusage.googleapis.com') {
      const m = p.match(/^\/v1\/projects\/[^/]+\/services\/([^/:]+)(:enable)?$/);
      if (!m) return notFound;
      if (m[2]) world.enabled.add(m[1]);
      const state = { name: `projects/123/services/${m[1]}`, state: world.enabled.has(m[1]) ? 'ENABLED' : 'DISABLED' };
      return m[2] ? done({ service: state }) : { status: 200, body: state };
    }
    if (u.host !== 'apikeys.googleapis.com') return notFound;
    const base = `/v2/projects/${sa.project_id}/locations/global/keys`;
    const view = (k: FakeKey) => ({ name: k.name, uid: k.uid, displayName: k.displayName, ...(k.restrictions && { restrictions: k.restrictions }) });
    if (p === base && req.method === 'GET') return { status: 200, body: { keys: world.keys.map(view) } };
    if (p === base && req.method === 'POST') {
      const b = req.body as { displayName: string; restrictions?: FakeKey['restrictions'] };
      const uid = `demo-key-${++n}`;
      const k: FakeKey = { name: `${base.slice(4)}/${uid}`, uid, displayName: b.displayName, keyString: `AIzaSyDEMO${uid.replace(/\W/g, '')}${'x'.repeat(20)}`, ...(b.restrictions && !/norestrict/.test(email) && { restrictions: b.restrictions }) };
      world.keys.push(k);
      return done(view(k));
    }
    const k = world.keys.find((x) => p === `/v2/${x.name}` || p === `/v2/${x.name}/keyString`);
    if (!k) return notFound;
    if (p.endsWith('/keyString')) return { status: 200, body: { keyString: k.keyString } };
    if (req.method === 'PATCH') {
      if (!/norestrict/.test(email)) k.restrictions = (req.body as FakeKey).restrictions;
      return done(view(k));
    }
    if (req.method === 'DELETE') {
      world.keys = world.keys.filter((x) => x !== k);
      return done(view(k));
    }
    return { status: 200, body: view(k) };
  };
  return { handle, world };
}

/** clipfarm's Settings API behind Access; null when the request isn't clipfarm's. */
export function fakeClipfarm() {
  const world = { values: {} as Record<string, string>, tests: 0 };
  const handle = (key: string, req: ActionRequest): ActionResponse | null => {
    if (!req.url.startsWith('https://clip.techinsiderbytes.com/')) return null;
    if (req.auth !== 'cf-access' || key !== DEMO_ACCESS) return { status: 403, body: { error: 'Forbidden: not through Cloudflare Access' } };
    if (req.method === 'GET' && new URL(req.url).pathname === '/api/settings') return { status: 200, body: { clipsToday: 7, channels: 3, settings: { youtube: { YOUTUBE_API_KEY: world.values.YOUTUBE_API_KEY ?? null } }, webhookSecret: 'whsec_DemoAppSecret0123456789abcdef' } }; // app_call (#625): its secret-looking field comes back masked
    const m = new URL(req.url).pathname.match(/^\/api\/settings\/([a-z-]+)(\/test)?$/);
    if (!m || m[1] !== 'youtube') return { status: 404, body: { error: 'No such setting' } };
    if (m[2]) {
      world.tests++;
      const v = world.values.YOUTUBE_API_KEY;
      const r = !v ? { ok: false, message: 'Not set yet: YouTube Data API key.' } : v.startsWith('AIza') ? { ok: true, message: 'YouTube answered.' } : { ok: false, message: 'YouTube says: API key not valid. Please pass a valid API key.' };
      return { status: 200, body: { ...r, settings: {} } };
    }
    if (req.method !== 'PUT') return { status: 405, body: { error: 'Method not allowed' } };
    Object.assign(world.values, (req.body as { values: Record<string, string> }).values);
    return { status: 200, body: { integrations: [] } };
  };
  return { handle, world };
}

// "Set up the YouTube Data API key": enable the API, make the restricted key, install it into clipfarm and test it.
registerCeoReply('google cloud', async ({ text, use }) => {
  if (!/\b(youtube (data )?api key|youtube key)\b/i.test(text)) return null;
  const enable = await use('provider_action', { provider: 'gcloud', op: 'services_enable', args: { services: ['youtube.googleapis.com'] }, why: "clipfarm's watchlist reads YouTube." });
  const key = await use('provider_action', { provider: 'gcloud', op: 'api_key_ensure', args: { name: 'clipfarm watchlist', apis: ['youtube.googleapis.com'] }, why: "clipfarm's watchlist needs a YouTube Data API key." });
  const first = (s: string) => s.split('\n')[0].replace(/^Refused:\s*/, '');
  return `With the office's Google Cloud service account (never shown to me):\n- ${first(enable)}\n- ${first(key)}\n\nOnce the key is made, install_key puts it into clipfarm's Settings → YouTube and presses its Test.`;
}, { early: true });
