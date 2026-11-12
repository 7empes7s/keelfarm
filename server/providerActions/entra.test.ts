// Entra ID sign-in for Access apps (#621), against the fake Cloudflare and Microsoft Graph: entra_app_ensure →
// access_idp_ensure → access_app_ensure idps, idempotent, no duplicate IdP, the missing token permission named, the
// secret's renewal, and no secret in anything returned.
import { describe, expect, it } from 'vitest';
import { fakeCloudflare } from '../demo/cloudflare.ts';
import { fakeProviderHttp } from '../demo/providerActions.ts';
import { RENEW_BEFORE_MS, renewEntraSecret } from './entra.ts';
import { entraForm } from './http.ts';
import { applyAction, runAction } from './index.ts';
import type { ActionCtx, ActionKey, EntraCred } from './types.ts';

const TENANT = '7e57e57e-0000-4000-8000-00000000c1f0';
const ADMIN = 'admin-client-id:admin-Secret~value-0001';
const HOST = 'clip.techinsiderbytes.com';
const CALLBACK = 'https://techinsiderbytes.cloudflareaccess.com/cdn-cgi/access/callback';

type Entra = { apps: { id: string; appId: string; web?: { redirectUris?: string[] }; requiredResourceAccess?: { resourceAccess: unknown[] }[]; passwordCredentials: { keyId: string }[] }[]; grants: { scope: string; consentType: string }[]; secrets: string[]; tenants: string[] };

function setup(o: { cfKey?: string; admin?: ActionKey[] } = {}) {
  const net = fakeProviderHttp();
  const cf = fakeCloudflare({ access: true });
  let cred: EntraCred | undefined;
  const cfKeys = [{ id: 'cf', label: 'Cloudflare', key: o.cfKey ?? 'cf-live-token' }];
  const base = { http: net.http, cloudflareApi: cf.api, boxes: null, cfKeys, entra: { get: () => cred, set: async (c: EntraCred) => void (cred = c) } };
  const entra: ActionCtx = { ...base, keys: o.admin ?? [{ id: 'adm', label: 'Microsoft Entra', key: ADMIN, accountId: TENANT, ok: true }] };
  const cloud: ActionCtx = { ...base, keys: cfKeys };
  const g = (net.world as unknown as { entra: Entra }).entra;
  const outs: string[] = [];
  /** A read's text, or a write planned and (unless already) approved: every text kept for the secret grep. */
  const act = async (ctx: ActionCtx, provider: string, op: string, args: Record<string, unknown> = {}) => {
    const out = await runAction(ctx, { provider, op, args });
    outs.push(JSON.stringify(out));
    if ('text' in out) return { text: out.text };
    if (out.plan.already) return { already: out.plan.already, diff: out.plan.diff };
    const r = await applyAction(ctx, out.plan.change);
    outs.push(JSON.stringify(r));
    return { diff: out.plan.diff, ...r };
  };
  const writes = () => net.calls.filter((c) => c.method !== 'GET' && c.auth !== 'entra-token').length + cf.calls.filter((c) => c.method !== 'GET').length;
  return { net, cf, g, entra, cloud, act, outs, writes, cred: () => cred };
}

/** The whole chain once: register, add the IdP, attach it to the app. */
async function chain(s: ReturnType<typeof setup>) {
  const app = await s.act(s.entra, 'entra', 'entra_app_ensure');
  const idp = await s.act(s.cloud, 'cloudflare', 'access_idp_ensure');
  const attach = await s.act(s.cloud, 'cloudflare', 'access_app_ensure', { hostname: HOST, emails: ['maro@example.com'], idps: ['Entra ID'] });
  return { app, idp, attach };
}

describe('Entra ID sign-in for Access apps (#621)', () => {
  it('registers the app, adds the IdP and attaches it with the existing logins kept, read back', async () => {
    const s = setup();
    const { app, idp, attach } = await chain(s);
    expect(app).toMatchObject({ ok: true, text: expect.stringContaining(`redirect URI ${CALLBACK}`) });
    expect(app.diff).toContain(`+   Web redirect URI ${CALLBACK}`);
    const [reg] = s.g.apps;
    expect(reg.web?.redirectUris).toEqual([CALLBACK]);
    expect(reg.requiredResourceAccess?.[0].resourceAccess).toHaveLength(7);
    expect(s.g.grants).toEqual([expect.objectContaining({ consentType: 'AllPrincipals', scope: 'email offline_access openid profile User.Read Directory.Read.All GroupMember.Read.All' })]);
    expect(s.cred()).toMatchObject({ tenant: TENANT, clientId: reg.appId, secret: s.g.secrets[0] });
    expect(s.cred()!.expiresAt - Date.now()).toBeGreaterThan(700 * 86_400_000);

    expect(idp).toMatchObject({ ok: true, text: expect.stringMatching(/^Read back: identity provider "Entra ID" \(azureAD, directory 7e57e57e.*groups on\)/) });
    const entraIdp = s.cf.world.idps.find((i) => i.type === 'azureAD')!;
    expect(entraIdp).toMatchObject({ name: 'Entra ID', config: { client_id: reg.appId, client_secret: s.g.secrets[0], directory_id: TENANT, support_groups: true } });

    expect(attach).toMatchObject({ ok: true, text: expect.stringContaining(`${HOST} signs in with: One-time PIN, Google, Entra ID.`) });
    const clip = s.cf.world.apps.find((a) => a.domain === HOST)!;
    expect(clip.allowed_idps).toEqual(['idp-otp', 'idp-google', entraIdp.id]); // the Gmail login stays
    expect(clip.auto_redirect_to_identity).toBe(false);
    expect(s.cf.world.policies[clip.id]).toEqual([expect.objectContaining({ decision: 'allow', include: [{ email: { email: 'maro@example.com' } }] })]); // still an email allow-list
    expect(new Set(s.g.tenants)).toEqual(new Set([TENANT])); // only the Providers entry's tenant
  });

  it('changes nothing when run twice', async () => {
    const s = setup();
    await chain(s);
    const before = s.writes();
    const again = await chain(s);
    expect(again.app.already).toMatch(/is set up for Cloudflare Access/);
    expect(again.idp.already).toMatch(/already signs in with the office's Entra app/);
    expect(again.attach.already).toMatch(/already has its Access app, signing in with Entra ID too/);
    expect(s.writes()).toBe(before);
    expect(s.g.apps).toHaveLength(1);
    expect(s.cf.world.idps.filter((i) => i.type === 'azureAD')).toHaveLength(1);
  });

  it('never shows a secret in a diff, card, result or read', async () => {
    const s = setup();
    await chain(s);
    await s.act(s.cloud, 'cloudflare', 'token_scopes', { hostname: HOST });
    await s.act(s.entra, 'entra', 'key_test');
    const all = s.outs.join('\n');
    expect(s.g.secrets.length).toBeGreaterThan(0);
    for (const secret of [...s.g.secrets, ADMIN, ADMIN.split(':')[1]]) expect(all).not.toContain(secret);
    expect(all).not.toMatch(/graph-token-/);
  });

  it('updates an IdP with the same name and directory instead of adding one, and refuses a name taken by another login', async () => {
    const s = setup();
    s.cf.world.idps.push({ id: 'idp-old', name: 'Entra ID', type: 'azureAD', config: { client_id: 'old-client', directory_id: TENANT, support_groups: false } });
    await s.act(s.entra, 'entra', 'entra_app_ensure');
    const idp = await s.act(s.cloud, 'cloudflare', 'access_idp_ensure');
    expect(idp.diff).toContain('~ Entra ID (azureAD, directory 7e57e57e-0000-4000-8000-00000000c1f0): client old-client → ');
    expect(s.cf.world.idps.filter((i) => i.name === 'Entra ID')).toEqual([expect.objectContaining({ id: 'idp-old', config: expect.objectContaining({ client_id: s.g.apps[0].appId, support_groups: true }) })]);
    await expect(runAction(s.cloud, { provider: 'cloudflare', op: 'access_idp_ensure', args: { name: 'Google' } })).rejects.toThrow(/named "Google" already exists for google: give access_idp_ensure another name/);
  });

  it('names the missing Cloudflare permission, and asks for the Entra app first', async () => {
    const s = setup({ cfKey: 'cf-noidp-token' });
    await expect(runAction(s.cloud, { provider: 'cloudflare', op: 'access_idp_ensure' })).rejects.toThrow(/run provider_action entra entra_app_ensure first/);
    await expect(runAction(s.entra, { provider: 'entra', op: 'entra_app_ensure' })).rejects.toThrow(/Access callback needs the Cloudflare team domain: .*needs Account › Access: Organizations, Identity Providers, and Groups › Write/);
    const scopes = await runAction(s.cloud, { provider: 'cloudflare', op: 'token_scopes' });
    expect('text' in scopes && scopes.text).toContain('✗ Access identity providers and team domain: the key needs Account › Access: Organizations, Identity Providers, and Groups › Write');
  });

  it("names Graph's missing consent permission, and needs the connection's tenant", async () => {
    const s = setup({ admin: [{ id: 'adm', label: 'Admin', key: 'admin-noconsent:secret-1', accountId: TENANT }] });
    const plan = await runAction(s.entra, { provider: 'entra', op: 'entra_app_ensure' });
    if (!('plan' in plan)) throw new Error('a write plans');
    expect(await applyAction(s.entra, plan.plan.change)).toEqual({ ok: false, text: 'The key lacks DelegatedPermissionGrant.ReadWrite.All (application permission, admin-consented).' });
    const none = setup({ admin: [{ id: 'adm', label: 'Admin', key: ADMIN }] });
    await expect(runAction(none.entra, { provider: 'entra', op: 'entra_app_ensure' })).rejects.toThrow(/"Admin" lacks its tenant ID/);
    expect(none.g.tenants).toEqual([]);
  });

  it('renews the secret 30 days before it ends: a new one on the app and the IdP, the old one removed', async () => {
    const s = setup();
    await chain(s);
    const old = s.cred()!;
    expect(await renewEntraSecret(s.entra, old.expiresAt - RENEW_BEFORE_MS - 1000)).toBeNull(); // not due yet
    const r = await renewEntraSecret(s.entra, old.expiresAt - RENEW_BEFORE_MS + 1000);
    expect(r).toMatchObject({ ok: true, text: expect.stringMatching(/^Renewed the Entra app's client secret \(ends .*\), updated Cloudflare's "Entra ID" sign-in and removed the old one\.$/) });
    const now = s.cred()!;
    expect(now.keyId).not.toBe(old.keyId);
    expect(now.idp?.keyId).toBe(now.keyId);
    expect(s.g.apps[0].passwordCredentials.map((p) => p.keyId)).toEqual([now.keyId]);
    expect(s.cf.world.idps.find((i) => i.type === 'azureAD')!.config.client_secret).toBe(now.secret);
    expect(JSON.stringify(r)).not.toContain(now.secret);
    expect((await s.act(s.cloud, 'cloudflare', 'access_idp_ensure')).already).toBeTruthy(); // still in step
  });

  it('keeps the old secret when the IdP update fails', async () => {
    const s = setup();
    await chain(s);
    const old = s.cred()!;
    const broken: ActionCtx = { ...s.entra, cfKeys: [{ id: 'cf', label: 'Cloudflare', key: 'cf-noidp-token' }] };
    const r = await renewEntraSecret(broken, old.expiresAt - 1000);
    expect(r).toMatchObject({ ok: false, text: expect.stringContaining('the old one still works') });
    expect(s.cred()).toEqual(old);
    expect(s.g.apps[0].passwordCredentials.map((p) => p.keyId)).toEqual([old.keyId]);
    expect(s.cf.world.idps.find((i) => i.type === 'azureAD')!.config.client_secret).toBe(old.secret);
  });

  it("sends the admin app's client id and secret only in the token form", () => {
    expect(Object.fromEntries(new URLSearchParams(entraForm(ADMIN, { grant_type: 'client_credentials' })))).toEqual({ grant_type: 'client_credentials', client_id: 'admin-client-id', client_secret: 'admin-Secret~value-0001' });
  });

  it('refuses auto-redirect with more than one login', async () => {
    const s = setup();
    await s.act(s.entra, 'entra', 'entra_app_ensure');
    await s.act(s.cloud, 'cloudflare', 'access_idp_ensure');
    await expect(runAction(s.cloud, { provider: 'cloudflare', op: 'access_app_ensure', args: { hostname: 'keel.techinsiderbytes.com', emails: ['m@example.com'], idps: ['Entra ID'], auto_redirect: true } })).rejects.toThrow(/auto_redirect needs exactly one login on the app, and keel.techinsiderbytes.com would have 3/);
  });
});
