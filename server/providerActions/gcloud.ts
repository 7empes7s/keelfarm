// Google Cloud in the provider-action layer (#622): the office's service account (its JSON is the Providers key; the
// token is minted from it in http.ts) enables allow-listed APIs (Service Usage) and makes API keys restricted to them
// (API Keys), idempotent by display name. A key's string is read back with getKeyString straight into the office's key
// store (ctx.saveKey) and never returned; install_key then puts it into the app.
import { z } from 'zod';
import { apiKeyProvider, GCLOUD_SERVICES, parseServiceAccount } from '../../shared/gcloud.ts';
import { ActionError, keyById, withKeys, type ActionCtx, type ActionKey, type ActionRequest, type Call, type ProviderModule } from './types.ts';

const NAME = 'Google Cloud';
const PERMS = { usage: 'Service Usage Admin (roles/serviceusage.serviceUsageAdmin)', keys: 'API Keys Admin (roles/serviceusage.apiKeysAdmin)' };
const USAGE = 'https://serviceusage.googleapis.com/v1';
const KEYS = 'https://apikeys.googleapis.com/v2';
const service = z.enum(GCLOUD_SERVICES);
const keyName = z.string().min(1).max(60);

interface Operation<T> {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: T;
}
interface GKey {
  name: string;
  displayName?: string;
  restrictions?: { apiTargets?: { service: string }[] };
}

/** The account's project and email: the only parts of its JSON the module reads. */
function account(k: ActionKey) {
  const sa = parseServiceAccount(k.key);
  if (typeof sa === 'string') throw new ActionError(`"${k.label}": ${sa} Save the service account's JSON file again.`);
  return { project: sa.projectId, email: sa.clientEmail };
}

/** One call; a refusal worded for IT, a 403 naming the role so another key is tried. */
async function g<T>(call: Call, method: ActionRequest['method'], url: string, perm: string, body?: unknown): Promise<T> {
  const r = await call({ method, url, auth: 'google-sa', ...(body !== undefined && { body }) });
  if (r.status === 0) throw new ActionError(`Couldn't reach ${NAME}.`);
  if (r.status === 401) throw new ActionError("Google turned the service account away: its key may have been deleted. Save a new JSON key file in Settings → Providers.");
  if (r.status === 403) throw new ActionError(`The service account lacks ${perm} on the project.`, perm);
  if (r.status >= 400) throw new ActionError(`${NAME} answered ${r.status}: ${((r.body as { error?: { message?: string } })?.error?.message ?? 'no reason given').slice(0, 200)}`);
  return r.body as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A long-running operation's result, polled for up to 30 s. */
async function finished<T>(call: Call, base: string, op: Operation<T>, perm: string): Promise<T> {
  for (let i = 0; !op.done && op.name && i < 30; i++) {
    await sleep(1000);
    op = await g<Operation<T>>(call, 'GET', `${base}/${op.name}`, perm);
  }
  if (!op.done) throw new ActionError(`${NAME} is still working on it: ask again in a minute.`);
  if (op.error) throw new ActionError(`${NAME} said: ${op.error.message ?? 'it failed'}.`);
  return op.response as T;
}

const serviceUrl = (project: string, s: string) => `${USAGE}/projects/${encodeURIComponent(project)}/services/${s}`;
const keysUrl = (project: string) => `${KEYS}/projects/${encodeURIComponent(project)}/locations/global/keys`;
const targets = (k?: GKey) => (k?.restrictions?.apiTargets ?? []).map((t) => t.service);
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const only = (apis: readonly string[]) => (apis.length ? `only ${apis.join(', ')}` : 'any API');
const works = (apis: readonly string[]) => `works ${apis.length ? `only with ${apis.join(', ')}` : 'with any API'}`;

async function enabled(call: Call, project: string, services: readonly string[]) {
  const states = await Promise.all(services.map((s) => g<{ state?: string }>(call, 'GET', serviceUrl(project, s), PERMS.usage)));
  return services.filter((_, i) => states[i].state === 'ENABLED');
}

async function findKey(call: Call, project: string, name: string) {
  const list = await g<{ keys?: GKey[] }>(call, 'GET', keysUrl(project), PERMS.keys);
  return (list.keys ?? []).find((k) => k.displayName === name);
}

function keyFor(ctx: ActionCtx, id: string): ActionKey | { ok: false; text: string } {
  const k = keyById(ctx, NAME, id);
  return 'key' in k ? k : { ok: false, text: k.text };
}

type EnsureData = { name: string; apis: string[]; provider: string; project: string; keyName?: string; restrict: boolean };

export const gcloudModule: ProviderModule = {
  provider: 'gcloud',
  name: NAME,
  ops: {
    key_test: {
      args: z.object({}),
      read: (ctx) =>
        withKeys(ctx, NAME, async (call, key) => {
          const a = account(key);
          const p = await g<{ name?: string; projectId?: string }>(call, 'GET', `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(a.project)}`, 'Viewer (roles/viewer)');
          return `"${key.label}" works: project ${p.name ?? a.project} (${p.projectId ?? a.project}) as ${a.email}.`;
        }),
    },
    services_enable: {
      args: z.object({ services: z.array(service).min(1).max(GCLOUD_SERVICES.length) }),
      plan: (ctx, a) =>
        withKeys(ctx, NAME, async (call, key) => {
          const { project } = account(key);
          const services = [...new Set(a.services as string[])];
          const on = await enabled(call, project, services);
          const off = services.filter((s) => !on.includes(s));
          return {
            change: { provider: 'gcloud', op: 'services_enable', keyId: key.id, data: { project, services: off } },
            summary: `enables ${off.join(', ')} on ${project}`,
            diff: `${project}:\n${services.map((s) => `${off.includes(s) ? '+' : ' '} ${s} enabled`).join('\n')}`,
            argv: ['gcloud', 'services_enable', ...off],
            undo: 'disable it in APIs & Services',
            ...(!off.length && { already: `${services.join(', ')} ${services.length === 1 ? 'is' : 'are'} already enabled on ${project}.` }),
          };
        }),
    },
    api_key_ensure: {
      args: z.object({ name: keyName, apis: z.array(service).min(1).max(GCLOUD_SERVICES.length) }),
      plan: (ctx, a) =>
        withKeys(ctx, NAME, async (call, key) => {
          const { project } = account(key);
          const name = String(a.name);
          const apis = [...new Set(a.apis as string[])];
          const on = await enabled(call, project, apis);
          const notOn = apis.filter((s) => !on.includes(s));
          if (notOn.length) throw new ActionError(`${notOn.join(', ')} ${notOn.length === 1 ? "isn't" : "aren't"} enabled on ${project}: enable it first with services_enable.`);
          const found = await findKey(call, project, name);
          const restrict = !found || !same(targets(found), apis);
          const provider = apiKeyProvider(apis);
          const saved = ctx.savedKey?.(provider, name) ?? false;
          const head = !found ? [`+ API key "${name}"`, `+   ${only(apis)}`] : restrict ? [`~ API key "${name}"`, `-   ${only(targets(found))}`, `+   ${only(apis)}`] : [`  API key "${name}"`, `    ${only(apis)}`];
          const data: EnsureData = { name, apis, provider, project, restrict, ...(found && { keyName: found.name }) };
          return {
            change: { provider: 'gcloud', op: 'api_key_ensure', keyId: key.id, data: { ...data } },
            summary: `${found ? 'restricts' : 'makes'} API key "${name}" (${only(apis)}) and saves it in Settings → Providers`,
            diff: [...head, `${saved && !restrict ? ' ' : '+'} saved in Settings → Providers as "${name}" (${provider}); the key is never shown`].join('\n'),
            argv: ['gcloud', 'api_key_ensure', name],
            undo: 'delete it with api_key_delete',
            ...(!restrict && saved && { already: `API key "${name}" already ${works(apis)} and is saved in Settings → Providers.` }),
          };
        }),
    },
    api_key_delete: {
      args: z.object({ name: keyName }),
      plan: (ctx, a) =>
        withKeys(ctx, NAME, async (call, key) => {
          const { project } = account(key);
          const name = String(a.name);
          const found = await findKey(call, project, name);
          if (!found) throw new ActionError(`No API key "${name}" on ${project}.`);
          return {
            change: { provider: 'gcloud', op: 'api_key_delete', keyId: key.id, data: { name, project, keyName: found.name } },
            summary: `deletes API key "${name}" on ${project}: whatever uses it stops working`,
            diff: `- API key "${name}" (${only(targets(found))})`,
            argv: ['gcloud', 'api_key_delete', name],
            undo: 'none: make a new one with api_key_ensure and install it again',
          };
        }),
    },
  },
  async apply(ctx, c) {
    const key = keyFor(ctx, c.keyId);
    if (!('key' in key)) return key;
    const call: Call = (req) => ctx.http(key.key, req);
    try {
      if (c.op === 'services_enable') {
        const d = c.data as { project: string; services: string[] };
        for (const s of d.services) await finished(call, USAGE, await g<Operation<unknown>>(call, 'POST', `${serviceUrl(d.project, s)}:enable`, PERMS.usage, {}), PERMS.usage);
        const on = await enabled(call, d.project, d.services);
        return { ok: on.length === d.services.length, text: `Read back: ${d.services.map((s) => `${s} is ${on.includes(s) ? 'enabled' : 'still off'}`).join(', ')}.` };
      }
      if (c.op === 'api_key_ensure') return await ensure(ctx, call, c.data as unknown as EnsureData);
      if (c.op === 'api_key_delete') {
        const d = c.data as { name: string; project: string; keyName: string };
        await finished(call, KEYS, await g<Operation<unknown>>(call, 'DELETE', `${KEYS}/${d.keyName}`, PERMS.keys), PERMS.keys);
        const back = await findKey(call, d.project, d.name);
        return { ok: !back, text: `Read back: API key "${d.name}" is ${back ? 'still there' : 'gone'}.` };
      }
      return { ok: false, text: `${NAME} has no write ${c.op}.` };
    } catch (err) {
      return { ok: false, text: (err as Error).message };
    }
  },
};

/** api_key_ensure's Approve: made or restricted, the restriction read back, the key string saved (never returned). */
async function ensure(ctx: ActionCtx, call: Call, d: EnsureData) {
  if (!ctx.saveKey) return { ok: false, text: 'Nowhere to save the key.' };
  const restrictions = { apiTargets: d.apis.map((s) => ({ service: s })) };
  let k: GKey;
  if (!d.keyName) k = await finished<GKey>(call, KEYS, await g<Operation<GKey>>(call, 'POST', keysUrl(d.project), PERMS.keys, { displayName: d.name, restrictions }), PERMS.keys);
  else if (d.restrict) k = await finished<GKey>(call, KEYS, await g<Operation<GKey>>(call, 'PATCH', `${KEYS}/${d.keyName}?updateMask=restrictions`, PERMS.keys, { restrictions }), PERMS.keys);
  else k = { name: d.keyName };
  const back = await g<GKey>(call, 'GET', `${KEYS}/${k.name}`, PERMS.keys);
  if (!same(targets(back), d.apis)) {
    if (d.keyName) return { ok: false, text: `Google didn't change the key's restriction to ${d.apis.join(', ')}: it is still ${only(targets(back))}, and nothing was saved.` };
    await finished(call, KEYS, await g<Operation<unknown>>(call, 'DELETE', `${KEYS}/${k.name}`, PERMS.keys), PERMS.keys);
    return { ok: false, text: `Google didn't keep the key's restriction to ${d.apis.join(', ')}, so it was deleted and nothing was saved. Ask again.` };
  }
  const { keyString } = await g<{ keyString?: string }>(call, 'GET', `${KEYS}/${k.name}/keyString`, PERMS.keys);
  if (!keyString) return { ok: false, text: 'Google gave no key string back: ask again.' };
  const label = await ctx.saveKey({ provider: d.provider, label: d.name, value: keyString, usedBy: 'Made by the office (Google Cloud)' });
  return { ok: true, text: `Read back: API key "${d.name}" ${works(d.apis)}; saved in Settings → Providers as "${label}". Put it into the app with install_key.` };
}
