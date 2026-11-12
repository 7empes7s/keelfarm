// The Cloudflare office action (#586): the main tunnel's public hostnames, their DNS records and Access apps through
// the API with a Providers key, which never leaves the server. Reads answer at once; a write is planned here (its
// before and after for the manager's card) and applied on Approve, planned again then so rules added since are kept,
// and read back. The key is picked by what it can do: the first whose calls aren't turned away. `api` is the only
// network (backend.cloudflareApi); everything here is testable with a fake one.
import type { CfChange } from '../shared/cloudflare.ts';
import type { CfSecretFile } from './cfSecretFile.ts';

export interface CfRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string; // under /client/v4, e.g. "/accounts"
  body?: unknown;
}
export interface CfResponse {
  status: number; // 0: unreachable
  body?: unknown;
}
export type CfApi = (key: string, req: CfRequest) => Promise<CfResponse>;
type Call = (req: CfRequest) => Promise<CfResponse>;

/** A Cloudflare key from Settings → Providers (server memory only). */
export interface CfKey {
  id: string;
  label: string;
  key: string;
  accountId?: string;
  ok?: boolean; // its last Providers test passed
}

/** The token permissions each call needs, as the dashboard names them. */
const CF_PERM = {
  account: 'Account › Account Settings › Read',
  tunnel: 'Account › Cloudflare Tunnel › Edit',
  zone: 'Zone › Zone › Read',
  dns: 'Zone › DNS › Edit',
  access: 'Account › Access: Apps and Policies › Edit',
  tokens: 'Account › Access: Service Tokens › Edit',
  idp: 'Account › Access: Organizations, Identity Providers, and Groups › Write',
} as const;

export class CfError extends Error {
  constructor(
    message: string,
    readonly missing?: string,
  ) {
    super(message);
  }
}

export interface IngressRule {
  hostname?: string;
  service: string;
  path?: string;
  [k: string]: unknown;
}

type Envelope = { success?: boolean; errors?: { code?: number; message?: string }[]; result?: unknown };
/** Cloudflare's "not allowed" codes: 1001 on a tunnel the token can't see (seen 2026-11-06), 9109/10000 elsewhere. */
const DENIED = new Set([1001, 9109, 10000, 10001]);

/** One call: its result, or a CfError naming the permission when Cloudflare turned it away. */
export async function cf<T>(call: Call, req: CfRequest, perm: string): Promise<T> {
  const r = await call(req);
  if (r.status === 0) throw new CfError("Couldn't reach Cloudflare's API.");
  const b = (r.body && typeof r.body === 'object' ? r.body : {}) as Envelope;
  const errs = Array.isArray(b.errors) ? b.errors : [];
  if (r.status === 401 || r.status === 403 || errs.some((e) => DENIED.has(Number(e.code)))) throw new CfError(`The key needs ${perm}.`, perm);
  if (r.status >= 400 || b.success === false) throw new CfError(`Cloudflare answered ${r.status}: ${errs.map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join('; ').slice(0, 300) || 'no reason given'}.`);
  return b.result as T;
}

/** The keys to try: the ones whose Providers test passed first. */
const ordered = (keys: readonly CfKey[]) => [...keys].sort((a, b) => Number(!!b.ok) - Number(!!a.ok));

/** Runs `fn` with the first key Cloudflare doesn't turn away; when all are, says what each one lacks. */
export async function withKey<T>(keys: readonly CfKey[], api: CfApi, fn: (call: Call, key: CfKey) => Promise<T>): Promise<T> {
  if (!keys.length) throw new CfError('No Cloudflare key: add an API token in Settings → Providers → Cloudflare.');
  const lacks: string[] = [];
  for (const k of ordered(keys)) {
    try {
      return await fn((req) => api(k.key, req), k);
    } catch (err) {
      if (!(err instanceof CfError) || !err.missing) throw err;
      lacks.push(`the key needs ${err.missing} ("${k.label}")`);
    }
  }
  throw new CfError(`No Cloudflare key can do this: ${lacks.join('; ')}. Nothing was changed: give a token that permission (or add one with it) in Settings → Providers.`);
}

// ---------- pure rules ----------

const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SERVICE = /^((https?|tcp|ssh|rdp|smb|unix):\/\/\S+|http_status:\d{3}|hello_world)$/;

function cleanHost(h: string): string {
  const host = h.trim().toLowerCase().replace(/\.$/, '');
  if (!HOST.test(host)) throw new CfError(`"${h}" isn't a hostname like clip.example.com.`);
  return host;
}

const catchAll = (r: IngressRule) => !r.hostname && !r.path;

/** The ingress with `hostname → service` before the catch-all, every other rule kept in order; `already` when it's there. */
export function planIngressAdd(rules: readonly IngressRule[], hostname: string, service: string): { after: IngressRule[]; already: boolean } {
  const host = cleanHost(hostname);
  const svc = service.trim();
  if (!SERVICE.test(svc)) throw new CfError(`"${service}" isn't a tunnel service like http://localhost:80.`);
  const same = rules.filter((r) => r.hostname?.toLowerCase() === host && !r.path);
  if (same.some((r) => r.service === svc)) return { after: [...rules], already: true };
  if (same.length) throw new CfError(`${host} already routes to ${same[0].service}: that rule stays; changing it is a job for the dashboard.`);
  const at = rules.findIndex(catchAll);
  const i = at < 0 ? rules.length : at;
  return { after: [...rules.slice(0, i), { hostname: host, service: svc }, ...rules.slice(i)], already: false };
}

const ruleLine = (r: IngressRule) => `${r.hostname ?? '(everything else)'}${r.path ? ` ${r.path}` : ''} → ${r.service}`;

/** The card's diff: every rule after, "+ " on new ones. */
export function ingressDiff(before: readonly IngressRule[], after: readonly IngressRule[]): string {
  const had = new Set(before.map(ruleLine));
  return after.map((r) => `${had.has(ruleLine(r)) ? '  ' : '+ '}${ruleLine(r)}`).join('\n');
}

/** The zones a hostname could be in, longest first: a.b.example.com → b.example.com, example.com. */
export function zoneCandidates(host: string): string[] {
  const parts = host.split('.');
  return parts.slice(1, -1).map((_, i) => parts.slice(i + 1).join('.'));
}

// ---------- reads ----------

type Named = { id: string; name: string };

async function accountOf(call: Call, k: CfKey): Promise<string> {
  if (k.accountId) return k.accountId;
  const list = await cf<Named[]>(call, { method: 'GET', path: '/accounts?per_page=50' }, CF_PERM.account);
  if (list?.length === 1) return list[0].id;
  if (!list?.length) throw new CfError('The key sees no Cloudflare account.', CF_PERM.account);
  throw new CfError(`The key sees ${list.length} accounts (${list.map((a) => a.name).join(', ')}): set the Account ID on its card in Settings → Providers.`);
}

async function tunnelOf(call: Call, account: string, want?: string): Promise<Named> {
  const list = await cf<Named[]>(call, { method: 'GET', path: `/accounts/${account}/cfd_tunnel?is_deleted=false&per_page=100` }, CF_PERM.tunnel);
  const w = want?.trim().toLowerCase();
  const hit = w ? list?.find((t) => t.id === w || t.name.toLowerCase() === w) : list?.length === 1 ? list[0] : undefined;
  if (hit) return hit;
  const names = (list ?? []).map((t) => t.name).join(', ') || 'none';
  throw new CfError(w ? `No tunnel "${want}" (tunnels: ${names}).` : `Say which tunnel: ${names}.`);
}

type TunnelConfig = { config?: { ingress?: IngressRule[]; [k: string]: unknown } };

async function ingressOf(call: Call, account: string, tunnel: string) {
  const r = await cf<TunnelConfig>(call, { method: 'GET', path: `/accounts/${account}/cfd_tunnel/${tunnel}/configurations` }, CF_PERM.tunnel);
  const config = r?.config ?? {};
  return { config, ingress: Array.isArray(config.ingress) ? config.ingress : [] };
}

async function zoneOf(call: Call, host: string): Promise<Named> {
  for (const name of zoneCandidates(host)) {
    const z = await cf<Named[]>(call, { method: 'GET', path: `/zones?name=${encodeURIComponent(name)}` }, CF_PERM.zone);
    if (z?.length) return z[0];
  }
  throw new CfError(`No Cloudflare zone holds ${host}: add its domain to the account first.`, CF_PERM.zone);
}

type DnsRecord = { id: string; type: string; name: string; content: string; proxied?: boolean };
const dnsOf = (call: Call, zone: string, host: string) => cf<DnsRecord[]>(call, { method: 'GET', path: `/zones/${zone}/dns_records?name=${encodeURIComponent(host)}` }, CF_PERM.dns);

type AccessApp = { id: string; domain?: string; name?: string };
const appsOf = (call: Call, account: string) => cf<AccessApp[]>(call, { method: 'GET', path: `/accounts/${account}/access/apps?per_page=500` }, CF_PERM.access);

type ServiceToken = { id: string; name: string; client_id?: string };
type Policy = { id: string; name?: string; decision?: string; include?: Record<string, unknown>[] };
/** The account's service token with exactly this name, if any. */
const tokenOf = async (call: Call, account: string, name: string) => (await cf<ServiceToken[]>(call, { method: 'GET', path: `/accounts/${account}/access/service_tokens?name=${encodeURIComponent(name)}&per_page=50` }, CF_PERM.tokens))?.find((t) => t.name === name);
const policiesOf = async (call: Call, account: string, app: string) => (await cf<Policy[]>(call, { method: 'GET', path: `/accounts/${account}/access/apps/${app}/policies` }, CF_PERM.access)) ?? [];
/** A Service Auth policy letting this token in. */
const servesToken = (p: Policy, id: string) => p.decision === 'non_identity' && (p.include ?? []).some((r) => (r.service_token as { token_id?: string } | undefined)?.token_id === id);

// ---------- identity providers (#621) ----------

type Idp = { id: string; name: string; type?: string; config?: { client_id?: string; directory_id?: string; support_groups?: boolean } };
type AppFull = AccessApp & { allowed_idps?: string[]; auto_redirect_to_identity?: boolean; policies?: { id: string; precedence?: number }[]; [k: string]: unknown };
const idpsOf = async (call: Call, account: string) => (await cf<Idp[]>(call, { method: 'GET', path: `/accounts/${account}/access/identity_providers?per_page=100` }, CF_PERM.idp)) ?? [];
const orgOf = (call: Call, account: string) => cf<{ auth_domain?: string; name?: string }>(call, { method: 'GET', path: `/accounts/${account}/access/organizations` }, CF_PERM.idp);
const appOf = (call: Call, account: string, id: string) => cf<AppFull>(call, { method: 'GET', path: `/accounts/${account}/access/apps/${id}` }, CF_PERM.access);
const idpName = (i: Idp) => i.name || i.type || i.id;

/** The Access team domain (e.g. "team.cloudflareaccess.com"), for the Entra app's callback. */
export function teamDomain(keys: readonly CfKey[], api: CfApi): Promise<string> {
  return withKey(keys, api, async (call, k) => {
    const d = (await orgOf(call, await accountOf(call, k)))?.auth_domain?.trim().toLowerCase();
    if (!d || !HOST.test(d)) throw new CfError('The Cloudflare account has no Zero Trust team domain yet: open Zero Trust once to pick a team name.');
    return d;
  });
}

/** The Entra IdP an access_idp_ensure updates: same name and directory; never a second one with that name. */
function idpMatch(idps: readonly Idp[], name: string, directoryId: string): Idp | undefined {
  const n = name.trim().toLowerCase();
  const same = idps.filter((i) => i.name.trim().toLowerCase() === n);
  const hit = same.find((i) => i.type === 'azureAD' && i.config?.directory_id === directoryId);
  if (!hit && same.length) throw new CfError(`An identity provider named "${same[0].name}" already exists for ${same[0].type === 'azureAD' ? `another directory (${same[0].config?.directory_id ?? '?'})` : same[0].type ?? 'another login'}: give access_idp_ensure another name.`);
  return hit;
}

/** The secret's half of the store, for apply and renewal: the record, or why there's none. */
export interface IdpSecret {
  tenant: string;
  clientId: string;
  keyId: string;
  secret: string;
}

/** access_idp_ensure's plan: the IdP by name and directory, created or updated with the office's Entra app. */
export function planIdp(keys: readonly CfKey[], api: CfApi, a: { name?: string; cred?: IdpSecret & { idp?: { id: string; keyId: string } } }): Promise<CfPlan> {
  const name = (a.name ?? 'Entra ID').trim() || 'Entra ID';
  if (!/^[\w .()-]{1,60}$/.test(name)) throw new CfError(`"${name}" isn't a name like "Entra ID".`);
  const c = a.cred;
  if (!c) throw new CfError('No Entra app yet: run provider_action entra entra_app_ensure first; its secret goes straight into the office\'s key store.');
  return withKey(keys, api, async (call, k) => {
    const account = await accountOf(call, k);
    const hit = idpMatch(await idpsOf(call, account), name, c.tenant);
    const sameApp = hit?.config?.client_id === c.clientId && hit.config.support_groups === true;
    const current = sameApp && c.idp?.id === hit!.id && c.idp.keyId === c.keyId;
    const change: CfChange = { op: 'access_idp_ensure', keyId: k.id, accountId: account, name, ...(hit && { idpId: hit.id }), directoryId: c.tenant, clientId: c.clientId };
    const line = hit ? `${current ? ' ' : '~'} ${name} (azureAD, directory ${c.tenant}): ${current ? `client ${c.clientId}` : `client ${hit.config?.client_id ?? '?'} → ${c.clientId}, a new secret, groups on`}` : `+ ${name} (azureAD, directory ${c.tenant}, client ${c.clientId}, groups on)`;
    return { change, diff: `Access identity providers:\n${line}\n  the client secret comes from the office's key store (not shown)`, summary: `${hit ? 'updates' : 'adds'} the "${name}" sign-in (Microsoft Entra) in Cloudflare Access`, ...(current && { already: `"${name}" already signs in with the office's Entra app (${c.clientId}).` }) };
  });
}

/** Writes the IdP (created or updated) with this secret; its id. Used by Approve and by the secret's renewal. */
export async function writeIdp(call: Call, account: string, o: { id?: string; name: string; cred: IdpSecret }): Promise<string> {
  const body = { name: o.name, type: 'azureAD', config: { client_id: o.cred.clientId, client_secret: o.cred.secret, directory_id: o.cred.tenant, support_groups: true } };
  const r = await cf<Idp>(call, o.id ? { method: 'PUT', path: `/accounts/${account}/access/identity_providers/${o.id}`, body } : { method: 'POST', path: `/accounts/${account}/access/identity_providers`, body }, CF_PERM.idp);
  return r?.id ?? o.id ?? '';
}

/** Approve on access_idp_ensure: planned again (no duplicate), written with the stored secret, read back. Never throws. */
export async function applyIdp(keys: readonly CfKey[], api: CfApi, c: Extract<CfChange, { op: 'access_idp_ensure' }>, cred: IdpSecret | undefined, saved: (idpId: string) => Promise<void>): Promise<{ ok: boolean; text: string }> {
  const key = keys.find((k) => k.id === c.keyId);
  if (!key) return { ok: false, text: 'The Cloudflare key this card was planned with is gone from Settings → Providers: ask for it again.' };
  if (!cred || cred.clientId !== c.clientId || cred.tenant !== c.directoryId) return { ok: false, text: "The office's Entra app changed since this card: ask for access_idp_ensure again." };
  const call: Call = (req) => api(key.key, req);
  try {
    const hit = idpMatch(await idpsOf(call, c.accountId), c.name, c.directoryId);
    const id = await writeIdp(call, c.accountId, { id: hit?.id, name: c.name, cred });
    await saved(id);
    const back = (await idpsOf(call, c.accountId)).find((i) => i.id === id);
    const ok = back?.type === 'azureAD' && back.config?.client_id === cred.clientId && back.config.directory_id === cred.tenant;
    return { ok, text: ok ? `Read back: identity provider "${back!.name}" (azureAD, directory ${cred.tenant}, client ${cred.clientId}, groups ${back!.config?.support_groups ? 'on' : 'off'}). Attach it to an app with access_app_ensure idps: ["${c.name}"].` : `Read back, but "${c.name}" isn't the office's Entra app.` };
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  }
}

/** The app's logins after adding `want`: an empty list means every login, so those stay (Google, one-time PIN). */
function idpsAfter(allowed: readonly string[] | undefined, all: readonly Idp[], want: readonly string[]): string[] {
  const base = allowed?.length ? allowed : all.map((i) => i.id);
  return [...new Set([...base, ...want])];
}

/** The names asked for, as the account's IdPs. */
function resolveIdps(all: readonly Idp[], names: readonly string[]): { id: string; name: string }[] {
  return names.map((n) => {
    const hit = all.find((i) => idpName(i).toLowerCase() === n.trim().toLowerCase());
    if (!hit) throw new CfError(`No identity provider "${n}" (there are: ${all.map(idpName).join(', ') || 'none'}): add it with access_idp_ensure first.`);
    return { id: hit.id, name: idpName(hit) };
  });
}

/** tunnel_ingress_get: the tunnel's rules, one a line. */
export function ingressGet(keys: readonly CfKey[], api: CfApi, tunnel?: string): Promise<string> {
  return withKey(keys, api, async (call, k) => {
    const account = await accountOf(call, k);
    const t = await tunnelOf(call, account, tunnel);
    const { ingress } = await ingressOf(call, account, t.id);
    return `Tunnel ${t.name} (${t.id}), key "${k.label}":\n${ingress.map(ruleLine).join('\n') || '(no rules)'}`;
  });
}

/** token_scopes: each key's verify and a dry read of everything the action uses, naming what's missing. */
export async function tokenScopes(keys: readonly CfKey[], api: CfApi, o: { hostname?: string; tunnel?: string } = {}): Promise<string> {
  if (!keys.length) throw new CfError('No Cloudflare key: add an API token in Settings → Providers → Cloudflare.');
  const out: string[] = [];
  for (const k of ordered(keys)) {
    const call: Call = (req) => api(k.key, req);
    const lines: string[] = [];
    const check = async <T>(what: string, perm: string, f: () => Promise<T>): Promise<T | null> => {
      try {
        const v = await f();
        lines.push(`  ✓ ${what}`);
        return v;
      } catch (err) {
        lines.push(`  ✗ ${what}: ${err instanceof CfError && err.missing ? `the key needs ${perm}` : (err as Error).message}`);
        return null;
      }
    };
    const verify = await call({ method: 'GET', path: k.accountId ? `/accounts/${k.accountId}/tokens/verify` : '/user/tokens/verify' });
    const fallback = k.accountId && verify.status >= 400 ? await call({ method: 'GET', path: '/user/tokens/verify' }) : verify;
    const live = fallback.status >= 200 && fallback.status < 300;
    lines.push(live ? '  ✓ token is active' : `  ✗ token turned away (${fallback.status}): use an API token, not the Global API Key`);
    if (live) {
      const account = await check('account', CF_PERM.account, () => accountOf(call, k));
      const t = account ? await check('tunnels', CF_PERM.tunnel, () => tunnelOf(call, account, o.tunnel)) : null;
      if (account && t) await check(`tunnel ${t.name}'s ingress`, CF_PERM.tunnel, () => ingressOf(call, account, t.id));
      const zone = o.hostname ? await check('zone', CF_PERM.zone, () => zoneOf(call, cleanHost(o.hostname!))) : null;
      if (zone) await check(`DNS records in ${zone.name}`, CF_PERM.dns, () => dnsOf(call, zone.id, cleanHost(o.hostname!)));
      if (account) await check('Access apps', CF_PERM.access, () => appsOf(call, account));
      if (account) await check('Access service tokens', CF_PERM.tokens, () => tokenOf(call, account, 'cubefarm'));
      if (account) await check('Access identity providers and team domain', CF_PERM.idp, () => Promise.all([idpsOf(call, account), orgOf(call, account)]));
    }
    out.push(`"${k.label}"${k.ok === false ? ' (its Providers test fails)' : ''}:\n${lines.join('\n')}`);
  }
  return `${out.join('\n')}\nReads prove read access; a write turned away names the Edit permission it lacked.`;
}

// ---------- writes: plan, then apply ----------

export interface CfPlan {
  change: CfChange;
  diff: string;
  summary: string; // the card's one line: what it changes
  already?: string; // nothing to do, and why
}

/** A write's plan: the ids found, the card's diff, or `already` when it's in place. */
export function planWrite(keys: readonly CfKey[], api: CfApi, a: { op: CfChange['op']; hostname: string; service?: string; tunnel?: string; emails?: string[]; bypass?: string[]; idps?: string[]; auto_redirect?: boolean; name?: string; duration?: string; secretFile?: CfSecretFile }): Promise<CfPlan> {
  const host = cleanHost(a.hostname);
  return withKey(keys, api, async (call, k) => {
    if (a.op === 'access_service_token_ensure') return planServiceToken(call, k, host, a);
    if (a.op === 'tunnel_ingress_add') {
      if (!a.service) throw new CfError('Give the service, e.g. http://localhost:80.');
      const account = await accountOf(call, k);
      const t = await tunnelOf(call, account, a.tunnel);
      const { ingress } = await ingressOf(call, account, t.id);
      const p = planIngressAdd(ingress, host, a.service);
      const change: CfChange = { op: a.op, keyId: k.id, accountId: account, tunnelId: t.id, tunnelName: t.name, hostname: host, service: a.service.trim() };
      return { change, diff: `Tunnel ${t.name} ingress:\n${ingressDiff(ingress, p.after)}`, summary: `adds ${host} → ${change.service} on tunnel ${t.name}, keeping its ${ingress.length} rules`, ...(p.already && { already: `${host} → ${change.service} is already on tunnel ${t.name}.` }) };
    }
    if (a.op === 'dns_cname_ensure') {
      const account = await accountOf(call, k);
      const t = await tunnelOf(call, account, a.tunnel);
      const target = `${t.id}.cfargotunnel.com`;
      const zone = await zoneOf(call, host);
      const has = await dnsOf(call, zone.id, host);
      const change: CfChange = { op: a.op, keyId: k.id, zoneId: zone.id, hostname: host, target };
      const already = dnsAlready(has, target);
      return { change, diff: `${zone.name} DNS:\n${has.map((r) => `  ${r.type} ${r.name} → ${r.content}${r.proxied ? ' (proxied)' : ''}`).join('\n')}${has.length ? '\n' : ''}${already ? '' : `+ CNAME ${host} → ${target} (proxied)`}`.trimEnd(), summary: `adds a proxied CNAME ${host} → tunnel ${t.name}`, ...(already && { already: `${host} already points to tunnel ${t.name}.` }) };
    }
    const account = await accountOf(call, k);
    const emails = [...new Set((a.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) throw new CfError('Give at least one email for the allow-list.');
    const bypass = [...new Set((a.bypass ?? []).map(cleanPath))];
    const apps = await appsOf(call, account);
    const missing = accessMissing(apps, host, bypass);
    const login = await planLogins(call, account, apps, host, a);
    const change: CfChange = { op: 'access_app_ensure', keyId: k.id, accountId: account, hostname: host, emails, bypass, ...(login.idps.length && { idps: login.idps }), ...(a.auto_redirect !== undefined && { autoRedirect: a.auto_redirect }) };
    const lines = [`${missing.includes(host) ? '+' : ' '} ${host}: allow ${emails.join(', ')}`, ...login.lines, ...bypass.map((p) => `${missing.includes(`${host}${p}`) ? '+' : ' '} ${host}${p}: bypass (no sign-in)`)];
    const idpNote = login.idps.length ? `, signing in with ${login.idps.map((i) => i.name).join(', ')} too` : '';
    return { change, diff: `Access apps:\n${lines.join('\n')}`, summary: `puts ${host} behind Access for ${emails.length} email${emails.length === 1 ? '' : 's'}${idpNote}`, ...(!missing.length && login.same && { already: `${host} already has its Access app${bypass.length ? 's' : ''}${idpNote}.` }) };
  });
}

/** access_app_ensure's logins (#621): the IdPs asked for joined to the app's (its policies untouched), and auto-redirect. */
async function planLogins(call: Call, account: string, apps: readonly AccessApp[], host: string, a: { idps?: string[]; auto_redirect?: boolean }) {
  const names = [...new Set((a.idps ?? []).map((n) => n.trim()).filter(Boolean))];
  if (!names.length && a.auto_redirect === undefined) return { idps: [], lines: [], same: true };
  const all = await idpsOf(call, account);
  const idps = resolveIdps(all, names);
  const app = apps.find((x) => x.domain?.toLowerCase() === host);
  const full = app ? await appOf(call, account, app.id) : undefined;
  const after = idpsAfter(full?.allowed_idps, all, idps.map((i) => i.id));
  if (a.auto_redirect && after.length !== 1) throw new CfError(`auto_redirect needs exactly one login on the app, and ${host} would have ${after.length} (${after.map((id) => idpName(all.find((i) => i.id === id) ?? { id, name: id })).join(', ')}): leave it off to keep the others.`);
  const had = new Set(full?.allowed_idps ?? []);
  const label = (id: string) => idpName(all.find((i) => i.id === id) ?? { id, name: id });
  const lines = [`${after.every((id) => had.has(id)) ? ' ' : '~'}   sign in with: ${after.map((id) => `${had.has(id) ? '' : '+'}${label(id)}`).join(', ')}`];
  const redirect = a.auto_redirect ?? full?.auto_redirect_to_identity ?? false;
  if (a.auto_redirect !== undefined) lines.push(`${(full?.auto_redirect_to_identity ?? false) === redirect ? ' ' : '~'}   straight to the login page: ${redirect ? 'on' : 'off'}`);
  return { idps, lines, same: !!full && after.every((id) => had.has(id)) && (full.auto_redirect_to_identity ?? false) === redirect };
}

const cleanPath = (p: string) => {
  const s = `/${p.trim().replace(/^\/+/, '')}`;
  if (!/^\/[\w\-./*]*$/.test(s)) throw new CfError(`"${p}" isn't a path like /api/health.`);
  return s;
};

const dnsAlready = (has: readonly DnsRecord[], target: string) => {
  if (has.some((r) => r.type === 'CNAME' && r.content === target && r.proxied)) return true;
  if (has.length) throw new CfError(`${has[0].name} already has a ${has[0].type} record → ${has[0].content}: it stays; change it in the dashboard if it should go to the tunnel.`);
  return false;
};

/** The Access apps' domains (the hostname, then each bypass path on it) that don't exist yet. */
const accessMissing = (apps: readonly AccessApp[], host: string, bypass: readonly string[]) => {
  const have = new Set(apps.map((x) => x.domain?.toLowerCase()));
  return [host, ...bypass.map((p) => `${host}${p}`)].filter((d) => !have.has(d));
};

// ---------- service tokens (#607) ----------

const cleanName = (n?: string) => {
  const s = (n ?? '').trim();
  if (!/^[\w .@-]{1,100}$/.test(s)) throw new CfError(`Give the service token a name like "clipfarm e2e" (letters, digits, spaces, . _ - @).`);
  return s;
};
const cleanDuration = (d?: string) => {
  const s = d?.trim();
  if (s && !/^\d{1,6}h$/.test(s)) throw new CfError(`"${d}" isn't a duration like 8760h.`);
  return s || undefined;
};
const tokenPolicy = (name: string, id: string) => ({ name: `Service token ${name}`, decision: 'non_identity', include: [{ service_token: { token_id: id } }] });

/** access_service_token_ensure's plan: the token by name, its secret in the file, its Service Auth policy on the hostname's app. */
async function planServiceToken(call: Call, k: CfKey, host: string, a: { name?: string; duration?: string; secretFile?: CfSecretFile }): Promise<CfPlan> {
  const name = cleanName(a.name);
  const duration = cleanDuration(a.duration);
  if (!a.secretFile) throw new CfError('No file to store the secret in.');
  const file = a.secretFile;
  const account = await accountOf(call, k);
  const app = (await appsOf(call, account))?.find((x) => x.domain?.toLowerCase() === host);
  if (!app) throw new CfError(`No Access app on ${host}: put it behind Access first (access_app_ensure).`);
  const token = await tokenOf(call, account, name);
  const policies = await policiesOf(call, account, app.id);
  const stored = !!token?.client_id && (await file.clientId()) === token.client_id;
  const hasPolicy = !!token && policies.some((p) => servesToken(p, token.id));
  const lines = [
    token ? `${stored ? ' ' : '~'} service token ${name}${stored ? '' : ': rotate its secret (the old secret stops working)'}` : `+ service token ${name}${duration ? ` (${duration})` : ''}`,
    `${stored ? ' ' : '+'} its client id and secret stored at ${file.path} (mode 600)`,
    ...policies.filter((p) => !token || !servesToken(p, token.id)).map((p) => `  policy ${p.name ?? p.id}: ${p.decision ?? '?'}`),
    `${hasPolicy ? ' ' : '+'} policy Service token ${name}: non_identity (Service Auth)`,
  ];
  const change: CfChange = { op: 'access_service_token_ensure', keyId: k.id, accountId: account, hostname: host, appId: app.id, name, ...(duration && { duration }), envFile: file.path };
  return { change, diff: `Access app ${host}:
${lines.join('\n')}`, summary: `lets service token "${name}" through Access on ${host}, keeping its ${policies.length} polic${policies.length === 1 ? 'y' : 'ies'}; the secret is stored at ${file.path}`, ...(stored && hasPolicy && { already: `Service token "${name}" already gets through Access on ${host}, its secret stored at ${file.path}.` }) };
}

/** Approve on a service token card: each write undone if a later one fails, the secret only ever into the file. */
async function applyServiceToken(call: Call, c: Extract<CfChange, { op: 'access_service_token_ensure' }>, file: CfSecretFile): Promise<{ ok: boolean; text: string }> {
  const undo: (() => Promise<unknown>)[] = [];
  const addPolicy = (id: string) => cf<Policy>(call, { method: 'POST', path: `/accounts/${c.accountId}/access/apps/${c.appId}/policies`, body: tokenPolicy(c.name, id) }, CF_PERM.access);
  let wrote = 0;
  let rotated = false;
  try {
    const token = await tokenOf(call, c.accountId, c.name);
    if (token) {
      if (!(await policiesOf(call, c.accountId, c.appId)).some((p) => servesToken(p, token.id))) {
        const p = await addPolicy(token.id);
        undo.push(() => call({ method: 'DELETE', path: `/accounts/${c.accountId}/access/apps/${c.appId}/policies/${p.id}` }));
        wrote++;
      }
      if (!token.client_id || (await file.clientId()) !== token.client_id) {
        const r = await cf<{ client_id?: string; client_secret?: string }>(call, { method: 'POST', path: `/accounts/${c.accountId}/access/service_tokens/${token.id}/rotate` }, CF_PERM.tokens);
        rotated = true;
        await file.write(r?.client_id ?? token.client_id ?? '', r?.client_secret ?? '');
        wrote++;
      }
    } else {
      const t = await cf<ServiceToken & { client_secret?: string }>(call, { method: 'POST', path: `/accounts/${c.accountId}/access/service_tokens`, body: { name: c.name, ...(c.duration && { duration: c.duration }) } }, CF_PERM.tokens);
      undo.push(() => call({ method: 'DELETE', path: `/accounts/${c.accountId}/access/service_tokens/${t.id}` }));
      undo.push(await file.write(t.client_id ?? '', t.client_secret ?? ''));
      await addPolicy(t.id);
      wrote++;
    }
  } catch (err) {
    for (const u of undo.reverse()) await u().catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, text: rotated ? `The secret was rotated but couldn't be stored at ${file.path}: ${msg}` : `${msg} Nothing was kept${undo.length ? ': what was written is undone' : ''}.` };
  }
  const back = await tokenOf(call, c.accountId, c.name);
  const policy = !!back && (await policiesOf(call, c.accountId, c.appId)).some((p) => servesToken(p, back.id));
  const stored = !!back?.client_id && (await file.clientId()) === back.client_id;
  const ok = policy && stored;
  if (!wrote && ok) return { ok, text: `Service token "${c.name}" already got through Access on ${c.hostname}: nothing written.` };
  return { ok, text: ok ? `Read back: service token "${c.name}" gets through Access on ${c.hostname} (Service Auth); its secret is stored at ${file.path}.` : `Read back, but ${!back ? 'no token' : !policy ? 'no Service Auth policy' : `the secret at ${file.path} isn't this token's`}.` };
}

/** Approve's logins (#621): the app's IdPs with the card's joined (Google and one-time PIN kept), read back by name. */
async function applyLogins(call: Call, c: Extract<CfChange, { op: 'access_app_ensure' }>, apps: readonly AccessApp[]) {
  const app = apps.find((x) => x.domain?.toLowerCase() === c.hostname);
  if (!app) return { ok: false, wrote: false, text: `No Access app on ${c.hostname} to add the logins to.` };
  const all = await idpsOf(call, c.accountId);
  const full = await appOf(call, c.accountId, app.id);
  const after = idpsAfter(full.allowed_idps, all, (c.idps ?? []).map((i) => i.id));
  const redirect = c.autoRedirect ?? full.auto_redirect_to_identity ?? false;
  const had = full.allowed_idps ?? [];
  const wrote = !(after.length === had.length && after.every((id) => had.includes(id)) && (full.auto_redirect_to_identity ?? false) === redirect);
  if (wrote) {
    const { id: _id, aud: _aud, created_at: _c, updated_at: _u, policies, ...rest } = full;
    const body = { ...rest, allowed_idps: after, auto_redirect_to_identity: redirect, ...(policies?.length && { policies: policies.map((p, i) => ({ id: p.id, precedence: p.precedence ?? i + 1 })) }) };
    await cf(call, { method: 'PUT', path: `/accounts/${c.accountId}/access/apps/${app.id}`, body }, CF_PERM.access);
  }
  const back = await appOf(call, c.accountId, app.id);
  const names = (back.allowed_idps ?? []).map((id) => idpName(all.find((i) => i.id === id) ?? { id, name: id }));
  const ok = (c.idps ?? []).every((i) => back.allowed_idps?.includes(i.id)) && (back.auto_redirect_to_identity ?? false) === redirect;
  return { ok, wrote, text: `${c.hostname} signs in with: ${names.join(', ') || 'every login'}${redirect ? ' (straight to the login page)' : ''}.` };
}

/** Approve: plans again with the card's key (rules added since are kept), writes, reads back. Never throws. */
export async function applyWrite(keys: readonly CfKey[], api: CfApi, c: CfChange, secretFile?: CfSecretFile): Promise<{ ok: boolean; text: string }> {
  const key = keys.find((k) => k.id === c.keyId);
  if (!key) return { ok: false, text: 'The Cloudflare key this card was planned with is gone from Settings → Providers: ask for it again.' };
  const call: Call = (req) => api(key.key, req);
  try {
    if (c.op === 'access_service_token_ensure') return secretFile ? await applyServiceToken(call, c, secretFile) : { ok: false, text: 'No file to store the secret in.' };
    if (c.op === 'tunnel_ingress_add') {
      const { config, ingress } = await ingressOf(call, c.accountId, c.tunnelId);
      const p = planIngressAdd(ingress, c.hostname, c.service);
      if (p.already) return { ok: true, text: `${c.hostname} → ${c.service} was already on tunnel ${c.tunnelName}: nothing written.` };
      await cf(call, { method: 'PUT', path: `/accounts/${c.accountId}/cfd_tunnel/${c.tunnelId}/configurations`, body: { config: { ...config, ingress: p.after } } }, CF_PERM.tunnel);
      const back = (await ingressOf(call, c.accountId, c.tunnelId)).ingress.map(ruleLine);
      const ok = p.after.map(ruleLine).every((l, i) => back[i] === l) && back.length === p.after.length;
      return { ok, text: `${ok ? 'Read back' : "Read back, but it doesn't match"}: tunnel ${c.tunnelName} ingress:\n${back.join('\n')}` };
    }
    if (c.op === 'dns_cname_ensure') {
      if (dnsAlready(await dnsOf(call, c.zoneId, c.hostname), c.target)) return { ok: true, text: `${c.hostname} already pointed to the tunnel: nothing written.` };
      await cf(call, { method: 'POST', path: `/zones/${c.zoneId}/dns_records`, body: { type: 'CNAME', name: c.hostname, content: c.target, proxied: true, ttl: 1, comment: 'cubefarm (#586)' } }, CF_PERM.dns);
      const back = await dnsOf(call, c.zoneId, c.hostname);
      const ok = back.some((r) => r.type === 'CNAME' && r.content === c.target && r.proxied);
      return { ok, text: `${ok ? 'Read back' : 'Read back, but no matching record'}: ${back.map((r) => `${r.type} ${r.name} → ${r.content}${r.proxied ? ' (proxied)' : ''}`).join('\n') || '(no records)'}` };
    }
    if (c.op === 'access_idp_ensure') return { ok: false, text: 'access_idp_ensure applies through applyIdp.' };
    const missing = accessMissing(await appsOf(call, c.accountId), c.hostname, c.bypass);
    for (const domain of missing) {
      const main = domain === c.hostname;
      const policy = main ? { name: 'Allowed emails', decision: 'allow', include: c.emails.map((email) => ({ email: { email } })) } : { name: 'Bypass', decision: 'bypass', include: [{ everyone: {} }] };
      await cf(call, { method: 'POST', path: `/accounts/${c.accountId}/access/apps`, body: { name: main ? c.hostname : `${domain} (bypass)`, domain, type: 'self_hosted', session_duration: '24h', policies: [policy] } }, CF_PERM.access);
    }
    const apps = await appsOf(call, c.accountId);
    const left = accessMissing(apps, c.hostname, c.bypass);
    const login = c.idps?.length || c.autoRedirect !== undefined ? await applyLogins(call, c, apps) : null;
    const ok = !left.length && (login?.ok ?? true);
    const wrote = missing.length || login?.wrote;
    const text = wrote ? (left.length ? `Read back, but still missing: ${left.join(', ')}` : `Read back: Access apps on ${[c.hostname, ...c.bypass.map((p) => c.hostname + p)].join(', ')}`) : 'The Access apps were already there: nothing written.';
    return { ok, text: login ? `${text}\n${login.text}` : text };
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  }
}

/** backend.cloudflareApi: one call with the key in its header (20 s). The key goes nowhere else. */
export async function realCloudflareApi(key: string, req: CfRequest): Promise<CfResponse> {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4${req.path}`, {
      method: req.method,
      headers: { Authorization: `Bearer ${key}`, ...(req.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, body: await res.json().catch(() => undefined) };
  } catch {
    return { status: 0 };
  }
}
