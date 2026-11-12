// The Cloudflare office action (#586): the main tunnel's public hostnames, their DNS records and Access apps through
// the API with a Providers key, which never leaves the server. Reads answer at once; a write is planned here (its
// before and after for the manager's card) and applied on Approve, planned again then so rules added since are kept,
// and read back. The key is picked by what it can do: the first whose calls aren't turned away. `api` is the only
// network (backend.cloudflareApi); everything here is testable with a fake one.
import type { CfChange } from '../shared/cloudflare.ts';

export interface CfRequest {
  method: 'GET' | 'POST' | 'PUT';
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
async function cf<T>(call: Call, req: CfRequest, perm: string): Promise<T> {
  const r = await call(req);
  if (r.status === 0) throw new CfError("Couldn't reach Cloudflare's API.");
  const b = (r.body && typeof r.body === 'object' ? r.body : {}) as Envelope;
  const errs = Array.isArray(b.errors) ? b.errors : [];
  if (r.status === 401 || r.status === 403 || errs.some((e) => DENIED.has(Number(e.code)))) throw new CfError(`The key lacks ${perm}.`, perm);
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
      lacks.push(`"${k.label}" lacks ${err.missing}`);
    }
  }
  throw new CfError(`No Cloudflare key can do this: ${lacks.join('; ')}. Give a token that permission (or add one with it) in Settings → Providers.`);
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
        lines.push(`  ✗ ${what}: ${err instanceof CfError && err.missing ? `missing ${perm}` : (err as Error).message}`);
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
export function planWrite(keys: readonly CfKey[], api: CfApi, a: { op: CfChange['op']; hostname: string; service?: string; tunnel?: string; emails?: string[]; bypass?: string[] }): Promise<CfPlan> {
  const host = cleanHost(a.hostname);
  return withKey(keys, api, async (call, k) => {
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
    const change: CfChange = { op: 'access_app_ensure', keyId: k.id, accountId: account, hostname: host, emails, bypass };
    const lines = [`${missing.includes(host) ? '+' : ' '} ${host}: allow ${emails.join(', ')}`, ...bypass.map((p) => `${missing.includes(`${host}${p}`) ? '+' : ' '} ${host}${p}: bypass (no sign-in)`)];
    return { change, diff: `Access apps:\n${lines.join('\n')}`, summary: `puts ${host} behind Access for ${emails.length} email${emails.length === 1 ? '' : 's'}`, ...(!missing.length && { already: `${host} already has its Access app${bypass.length ? 's' : ''}.` }) };
  });
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

/** Approve: plans again with the card's key (rules added since are kept), writes, reads back. Never throws. */
export async function applyWrite(keys: readonly CfKey[], api: CfApi, c: CfChange): Promise<{ ok: boolean; text: string }> {
  const key = keys.find((k) => k.id === c.keyId);
  if (!key) return { ok: false, text: 'The Cloudflare key this card was planned with is gone from Settings → Providers: ask for it again.' };
  const call: Call = (req) => api(key.key, req);
  try {
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
    const missing = accessMissing(await appsOf(call, c.accountId), c.hostname, c.bypass);
    for (const domain of missing) {
      const main = domain === c.hostname;
      const policy = main ? { name: 'Allowed emails', decision: 'allow', include: c.emails.map((email) => ({ email: { email } })) } : { name: 'Bypass', decision: 'bypass', include: [{ everyone: {} }] };
      await cf(call, { method: 'POST', path: `/accounts/${c.accountId}/access/apps`, body: { name: main ? c.hostname : `${domain} (bypass)`, domain, type: 'self_hosted', session_duration: '24h', policies: [policy] } }, CF_PERM.access);
    }
    const left = accessMissing(await appsOf(call, c.accountId), c.hostname, c.bypass);
    return { ok: !left.length, text: missing.length ? (left.length ? `Read back, but still missing: ${left.join(', ')}` : `Read back: Access apps on ${[c.hostname, ...c.bypass.map((p) => c.hostname + p)].join(', ')}`) : 'The Access apps were already there: nothing written.' };
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
