// Microsoft Entra in the provider-action layer (#621): the app registration Cloudflare Access signs in with, made and
// kept by the office through Microsoft Graph with the admin app credential from Settings → Providers ("client id:secret",
// its tenant as the connection's Account ID; no other tenant is ever used). entra_app_ensure makes or updates the app
// "Cloudflare Access" (the Access callback, the delegated Graph permissions with admin consent) and a 24-month client
// secret that goes straight into the office's key store (ctx.entra), never into a card, log or tool result.
// renewEntraSecret makes a new secret 30 days before the old one ends, puts it on the Cloudflare IdP, then removes the old.
import { z } from 'zod';
import { CfError, teamDomain, withKey, writeIdp } from '../cloudflare.ts';
import { ActionError, expectOk, keyById, withKeys, type ActionCtx, type ActionKey, type ActionPlan, type Call, type EntraCred, type ProviderModule } from './types.ts';

const NAME = 'Microsoft Entra';
export const GRAPH = 'https://graph.microsoft.com/v1.0';
/** Microsoft Graph's own app id, and its delegated permissions Cloudflare's Entra sign-in needs (ids from Graph's permission reference). */
export const GRAPH_APP = '00000003-0000-0000-c000-000000000000';
const ENTRA_SCOPES: Record<string, string> = {
  email: '64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0',
  offline_access: '7427e0e9-2fba-42fe-b0c0-848c9e6a8182',
  openid: '37f7f235-527c-4136-accd-4a02d197296e',
  profile: '14dad69e-099b-42c9-810b-d002981feec1',
  'User.Read': 'e1fe6dd8-ba31-4d61-89e7-88639da4683d',
  'Directory.Read.All': '06da0dbc-49e2-44d2-8312-53f166ab848a',
  'GroupMember.Read.All': 'bc024368-1153-4739-b217-4326f2e966d0',
};
const PERM_APPS = 'Application.ReadWrite.All (application permission, admin-consented)';
const PERM_CONSENT = 'DelegatedPermissionGrant.ReadWrite.All (application permission, admin-consented)';
const DAY = 86_400_000;
/** A new secret lasts 24 months; renewal starts 30 days before it ends. */
export const SECRET_MS = 730 * DAY;
export const RENEW_BEFORE_MS = 30 * DAY;

export const renewDue = (c: Pick<EntraCred, 'expiresAt'>, now = Date.now()) => c.expiresAt - now <= RENEW_BEFORE_MS;
const accessCallback = (team: string) => `https://${team}/cdn-cgi/access/callback`;

export type GraphApp = { id: string; appId: string; displayName: string; web?: { redirectUris?: string[]; implicitGrantSettings?: Record<string, unknown> }; requiredResourceAccess?: { resourceAppId: string; resourceAccess: { id: string; type: string }[] }[]; passwordCredentials?: { keyId: string; endDateTime?: string }[] };
type Grant = { id: string; clientId: string; consentType: string; resourceId: string; scope?: string };

/** The app's Graph permissions with every one Cloudflare needs added (others kept). */
function accessWith(rra: GraphApp['requiredResourceAccess'] = []): NonNullable<GraphApp['requiredResourceAccess']> {
  const graph = rra.find((r) => r.resourceAppId === GRAPH_APP);
  const have = new Set((graph?.resourceAccess ?? []).filter((x) => x.type === 'Scope').map((x) => x.id));
  const add = Object.values(ENTRA_SCOPES).filter((id) => !have.has(id)).map((id) => ({ id, type: 'Scope' }));
  return [...rra.filter((r) => r !== graph), { resourceAppId: GRAPH_APP, resourceAccess: [...(graph?.resourceAccess ?? []), ...add] }];
}
const missingScopes = (app?: GraphApp) => {
  const graph = app?.requiredResourceAccess?.find((r) => r.resourceAppId === GRAPH_APP);
  const have = new Set((graph?.resourceAccess ?? []).map((x) => x.id));
  return Object.keys(ENTRA_SCOPES).filter((n) => !have.has(ENTRA_SCOPES[n]));
};
const grantMissing = (g?: Grant) => {
  const have = new Set((g?.scope ?? '').split(/\s+/));
  return Object.keys(ENTRA_SCOPES).filter((n) => !have.has(n));
};

/** A tenant id (a GUID) or its domain, as the Providers connection's Account ID; nothing else reaches a URL. */
function tenantOf(k: ActionKey): string {
  const t = (k.accountId ?? '').trim().toLowerCase();
  if (!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/.test(t)) throw new ActionError(`"${k.label}" has no tenant ID: set it (Directory (tenant) ID, from Entra → Overview) as the connection's Tenant ID in Settings → Providers.`, 'its tenant ID');
  return t;
}

/** A Graph token (or, #668, Exchange Online's) for the admin app: the key ("client id:secret") goes only into http.ts's form. */
export async function graphCall(ctx: ActionCtx, call: Call, k: ActionKey, scope = 'https://graph.microsoft.com/.default'): Promise<{ g: Call; tenant: string }> {
  const tenant = tenantOf(k);
  if (!/^[^:]+:.+$/.test(k.key)) throw new ActionError(`"${k.label}" isn't "client id:client secret": paste the admin app's Application (client) ID, a colon, then its secret.`, 'client id:secret');
  const r = await call({ method: 'POST', url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, auth: 'entra-token', form: { grant_type: 'client_credentials', scope } });
  const b = (r.body ?? {}) as { access_token?: unknown; error?: unknown };
  if (r.status === 0) throw new ActionError(`Couldn't reach ${NAME}.`);
  if (r.status >= 400 || typeof b.access_token !== 'string') throw new ActionError(`${NAME} turned the admin app away (${typeof b.error === 'string' ? b.error : r.status}): check its tenant, client ID and secret.`, 'a working admin app credential');
  const token = b.access_token;
  return { g: (req) => ctx.http(token, req), tenant };
}

export const get = <T>(g: Call, path: string, perm = PERM_APPS) => expectOk<T>(g, { method: 'GET', url: `${GRAPH}${path}`, auth: 'bearer' }, perm, 'Microsoft Graph');
export const send = <T>(g: Call, method: 'POST' | 'PATCH', path: string, body: unknown, perm = PERM_APPS) => expectOk<T>(g, { method, url: `${GRAPH}${path}`, auth: 'bearer', body }, perm, 'Microsoft Graph');
export const q = (s: string) => encodeURIComponent(s);

export async function findApp(g: Call, name: string, stored?: Pick<EntraCred, 'appObjectId'>): Promise<GraphApp | undefined> {
  const list = (await get<{ value?: GraphApp[] }>(g, `/applications?$filter=${q(`displayName eq '${name.replace(/'/g, "''")}'`)}&$select=id,appId,displayName,web,requiredResourceAccess,passwordCredentials`)).value ?? [];
  return list.find((a) => a.id === stored?.appObjectId) ?? list[0];
}
export const spOf = async (g: Call, appId: string) => (await get<{ value?: { id: string }[] }>(g, `/servicePrincipals?$filter=${q(`appId eq '${appId}'`)}&$select=id`)).value?.[0];
async function grantOf(g: Call, clientSp: string, graphSp: string) {
  const list = (await get<{ value?: Grant[] }>(g, `/oauth2PermissionGrants?$filter=${q(`clientId eq '${clientSp}' and resourceId eq '${graphSp}'`)}`, PERM_CONSENT)).value ?? [];
  return list.find((x) => x.consentType === 'AllPrincipals');
}
const secretOk = (app: GraphApp, c: EntraCred | undefined, tenant: string, now: number) => !!c && c.tenant === tenant && c.appObjectId === app.id && (app.passwordCredentials ?? []).some((p) => p.keyId === c.keyId) && !renewDue(c, now);

/** A new client secret on the app (24 months), its text only into the store. */
async function addSecret(g: Call, app: GraphApp, now: number) {
  const r = await send<{ keyId?: string; secretText?: string; endDateTime?: string }>(g, 'POST', `/applications/${app.id}/addPassword`, { passwordCredential: { displayName: 'cubefarm: Cloudflare Access', endDateTime: new Date(now + SECRET_MS).toISOString() } });
  if (!r.keyId || !r.secretText) throw new ActionError("Microsoft Graph made a secret but didn't return it: run entra_app_ensure again.");
  return { keyId: r.keyId, secret: r.secretText, expiresAt: r.endDateTime ? Date.parse(r.endDateTime) : now + SECRET_MS };
}
export const removeSecret = (g: Call, appObjectId: string, keyId: string) => g({ method: 'POST', url: `${GRAPH}/applications/${appObjectId}/removePassword`, auth: 'bearer', body: { keyId } });

const cleanName = (n: unknown) => {
  const s = String(n ?? 'Cloudflare Access').trim() || 'Cloudflare Access';
  if (!/^[\w .()-]{1,80}$/.test(s)) throw new ActionError(`"${s}" isn't an app name like "Cloudflare Access".`);
  return s;
};

/** entra_app_ensure's plan: what the app, its consent and its secret lack; nothing written. */
async function planApp(ctx: ActionCtx, a: { name?: unknown }, now = Date.now()): Promise<ActionPlan> {
  const name = cleanName(a.name);
  const team = await teamDomain(ctx.cfKeys ?? [], ctx.cloudflareApi).catch((err: Error) => {
    throw new ActionError(err instanceof CfError ? `The Access callback needs the Cloudflare team domain: ${err.message}` : err.message);
  });
  const callback = accessCallback(team);
  return withKeys(ctx, NAME, async (call, k) => {
    const { g, tenant } = await graphCall(ctx, call, k);
    const app = await findApp(g, name, ctx.entra?.get());
    const graphSp = app ? await spOf(g, GRAPH_APP) : undefined;
    const sp = app ? await spOf(g, app.appId) : undefined;
    const grant = sp && graphSp ? await grantOf(g, sp.id, graphSp.id) : undefined;
    const hasCb = !!app?.web?.redirectUris?.includes(callback);
    const scopes = missingScopes(app);
    const consent = grantMissing(grant);
    const secret = !!app && secretOk(app, ctx.entra?.get(), tenant, now);
    const lines = [
      `${app ? ' ' : '+'} app "${name}"${app ? ` (${app.appId})` : ''} in tenant ${tenant}`,
      `${hasCb ? ' ' : '+'}   Web redirect URI ${callback}`,
      `${scopes.length ? '+' : ' '}   delegated Graph permissions: ${scopes.length ? scopes.join(', ') : Object.keys(ENTRA_SCOPES).join(', ')}`,
      `${sp ? ' ' : '+'}   its enterprise app (service principal)`,
      `${consent.length ? '+' : ' '}   admin consent for the whole tenant${consent.length && grant ? `: adds ${consent.join(', ')}` : ''}`,
      `${secret ? ' ' : '+'}   a client secret (24 months), straight into the office's key store (not shown)`,
    ];
    const done = !!app && hasCb && !scopes.length && !!sp && !consent.length && secret;
    return {
      change: { provider: 'entra', op: 'entra_app_ensure', keyId: k.id, data: { name, tenant, callback } },
      summary: `${app ? 'keeps' : 'registers'} the Entra app "${name}" for Cloudflare Access sign-in in tenant ${tenant}`,
      diff: `Microsoft Entra:\n${lines.join('\n')}`,
      argv: ['entra', 'entra_app_ensure', name],
      undo: `delete the app "${name}" in Entra → App registrations (Cloudflare's Entra ID sign-in stops working)`,
      ...(done && { already: `The Entra app "${name}" is set up for Cloudflare Access (${app!.appId}), its secret in the office's key store.` }),
    };
  });
}

/** Approve on entra_app_ensure: each part made or updated, the secret stored, read back. Never throws. */
async function applyApp(ctx: ActionCtx, keyId: string, d: { name: string; tenant: string; callback: string }, now = Date.now()) {
  const k = keyById(ctx, NAME, keyId);
  if (!('key' in k)) return k;
  try {
    const { g, tenant } = await graphCall(ctx, (req) => ctx.http(k.key, req), k);
    if (tenant !== d.tenant) return { ok: false, text: `The ${NAME} connection's tenant changed since this card: ask for it again.` };
    const stored = ctx.entra?.get();
    let app = await findApp(g, d.name, stored);
    if (!app) app = await send<GraphApp>(g, 'POST', '/applications', { displayName: d.name, signInAudience: 'AzureADMyOrg', web: { redirectUris: [d.callback] }, requiredResourceAccess: accessWith() });
    else if (!app.web?.redirectUris?.includes(d.callback) || missingScopes(app).length) await send(g, 'PATCH', `/applications/${app.id}`, { web: { ...(app.web?.implicitGrantSettings && { implicitGrantSettings: app.web.implicitGrantSettings }), redirectUris: [...new Set([...(app.web?.redirectUris ?? []), d.callback])] }, requiredResourceAccess: accessWith(app.requiredResourceAccess) });
    const sp = (await spOf(g, app.appId)) ?? (await send<{ id: string }>(g, 'POST', '/servicePrincipals', { appId: app.appId }));
    const graphSp = await spOf(g, GRAPH_APP);
    if (!graphSp) return { ok: false, text: "Microsoft Graph's own enterprise app isn't in the tenant: nothing to consent to." };
    const grant = await grantOf(g, sp.id, graphSp.id);
    const scope = [...new Set([...(grant?.scope ?? '').split(/\s+/).filter(Boolean), ...Object.keys(ENTRA_SCOPES)])].join(' ');
    if (!grant) await send(g, 'POST', '/oauth2PermissionGrants', { clientId: sp.id, consentType: 'AllPrincipals', resourceId: graphSp.id, scope }, PERM_CONSENT);
    else if (grantMissing(grant).length) await send(g, 'PATCH', `/oauth2PermissionGrants/${grant.id}`, { scope }, PERM_CONSENT);
    if (!secretOk(app, stored, tenant, now)) {
      const s = await addSecret(g, app, now);
      await ctx.entra?.set({ tenant, appObjectId: app.id, clientId: app.appId, ...s, ...(stored?.appObjectId === app.id && stored.idp && { idp: stored.idp }) });
    }
    const back = await findApp(g, d.name, ctx.entra?.get());
    const ok = !!back && !!back.web?.redirectUris?.includes(d.callback) && !missingScopes(back).length && ctx.entra?.get()?.clientId === back.appId && !grantMissing(await grantOf(g, sp.id, graphSp.id)).length;
    return { ok, text: ok ? `Read back: Entra app "${d.name}" (client ${back!.appId}) with the redirect URI ${d.callback}, the 7 Graph permissions admin-consented, and its secret in the office's key store (ends ${new Date(ctx.entra!.get()!.expiresAt).toISOString().slice(0, 10)}, renewed 30 days before). Next: cloudflare access_idp_ensure.` : `Read back, but the Entra app "${d.name}" isn't complete: run entra_app_ensure again.` };
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  }
}

/** key_test: the admin app's token, and whether it can read app registrations. */
const keyTest = (ctx: ActionCtx) =>
  withKeys(ctx, NAME, async (call, k) => {
    const { g, tenant } = await graphCall(ctx, call, k);
    await get(g, '/applications?$top=1&$select=id');
    return `"${k.label}" signs in to tenant ${tenant} and can read app registrations.`;
  });

/**
 * The secret's renewal (#621): a new one on the app, put on the Cloudflare IdP, then the old one removed. The old one
 * stays when anything fails, so sign-in keeps working. Never throws; the text never holds a secret.
 */
export async function renewEntraSecret(ctx: ActionCtx, now = Date.now()): Promise<{ ok: boolean; text: string } | null> {
  const c = ctx.entra?.get();
  if (!c || !renewDue(c, now)) return null;
  const k = ctx.keys.find((x) => (x.accountId ?? '').trim().toLowerCase() === c.tenant);
  if (!k) return { ok: false, text: `The Entra secret ends ${new Date(c.expiresAt).toISOString().slice(0, 10)} and no ${NAME} connection for tenant ${c.tenant} is left to renew it.` };
  let made: { keyId: string; secret: string; expiresAt: number } | undefined;
  let g: Call | undefined;
  try {
    g = (await graphCall(ctx, (req) => ctx.http(k.key, req), k)).g;
    const fresh = await addSecret(g, { id: c.appObjectId } as GraphApp, now);
    made = fresh;
    const next: EntraCred = { ...c, ...fresh };
    if (c.idp) {
      const idp = c.idp;
      await withKey((ctx.cfKeys ?? []).filter((x) => x.id === idp.cfKeyId).concat((ctx.cfKeys ?? []).filter((x) => x.id !== idp.cfKeyId)), ctx.cloudflareApi, (call) => writeIdp(call, idp.accountId, { id: idp.id, name: idp.name, cred: { tenant: c.tenant, clientId: c.clientId, keyId: fresh.keyId, secret: fresh.secret } }));
      next.idp = { ...idp, keyId: fresh.keyId };
    }
    made = undefined; // the IdP has it now: it stays even if storing fails
    await ctx.entra!.set(next);
    const gone = await removeSecret(g, c.appObjectId, c.keyId);
    const end = new Date(fresh.expiresAt).toISOString().slice(0, 10);
    return { ok: true, text: `Renewed the Entra app's client secret (ends ${end})${c.idp ? `, updated Cloudflare's "${c.idp.name}" sign-in` : ''}${gone.status >= 200 && gone.status < 300 ? ' and removed the old one' : ", but the old one couldn't be removed: it ends by itself"}.` };
  } catch (err) {
    if (made && g) await removeSecret(g, c.appObjectId, made.keyId).catch(() => undefined);
    return { ok: false, text: `Couldn't renew the Entra secret (ends ${new Date(c.expiresAt).toISOString().slice(0, 10)}; the old one still works): ${(err as Error).message}` };
  }
}

export const entraModule: ProviderModule = {
  provider: 'entra',
  name: NAME,
  ops: {
    key_test: { args: z.object({}), read: (ctx) => keyTest(ctx) },
    entra_app_ensure: { args: z.object({ name: z.string().min(1).max(80).optional() }), plan: (ctx, a) => planApp(ctx, a) },
  },
  apply: (ctx, c) => applyApp(ctx, c.keyId, c.data as { name: string; tenant: string; callback: string }),
};
