// The demo's Cloudflare (#586): one account with the main tunnel (KEEL's hostname and the catch-all), the
// techinsiderbytes.com zone and no Access apps, kept in memory. A token with "bad" in it is turned away (401), one with
// "notunnel" gets 1001 on tunnels (as the real one did on 2026-11-06), "nodns" a 403 on DNS records, "notoken" a 403 on
// service tokens and "nopolicy" on adding a policy (#607). `secrets` holds every client secret it handed out, so tests
// can look for them. The tests use it too.
import type { CfApi, CfRequest, CfResponse, IngressRule } from '../cloudflare.ts';
import { randomUUID } from 'node:crypto';
import { registerDemo } from './registry.ts';

type Policy = { id: string; name?: string; decision?: string; include?: Record<string, unknown>[] };

export const DEMO_CF = { account: '0123456789abcdef0123456789abcdef', tunnel: 'c0ffee00-1111-4222-8333-444455556666', zone: 'demo-zone-tib' };

/** A fake Cloudflare API; `calls` records every request (without its key). */
export function fakeCloudflare(o: { ingress?: IngressRule[]; access?: boolean } = {}) {
  const ingress: IngressRule[] = o.ingress ?? [{ hostname: 'keel.techinsiderbytes.com', service: 'http://localhost:80' }, { service: 'http_status:404' }];
  const world = { config: { ingress, 'warp-routing': { enabled: false } } as Record<string, unknown>, dns: [{ id: 'r1', type: 'CNAME', name: 'keel.techinsiderbytes.com', content: `${DEMO_CF.tunnel}.cfargotunnel.com`, proxied: true }], apps: [] as { id: string; domain: string; name: string }[], policies: {} as Record<string, Policy[]>, tokens: [] as { id: string; name: string; client_id: string; duration?: string }[], secrets: [] as string[] };
  let seq = 0;
  if (o.access) {
    // the demo office: KEEL already behind Access with an email allow-list
    world.apps.push({ id: 'app-keel', domain: 'keel.techinsiderbytes.com', name: 'keel.techinsiderbytes.com' });
    world.policies['app-keel'] = [{ id: 'pol-email', name: 'Allowed emails', decision: 'allow', include: [{ email: { email: 'manager@example.com' } }] }];
  }
  const calls: CfRequest[] = [];
  const ok = (result: unknown): CfResponse => ({ status: 200, body: { success: true, errors: [], result } });
  const no = (status: number, code: number, message: string): CfResponse => ({ status, body: { success: false, errors: [{ code, message }], result: null } });
  const api: CfApi = async (key, req) => {
    calls.push(req);
    await new Promise((r) => setTimeout(r, 5));
    if (/bad/i.test(key)) return no(401, 10000, 'Authentication error');
    const p = req.path;
    if (p.endsWith('/tokens/verify')) return ok({ id: 'tok', status: 'active' });
    if (p.startsWith('/accounts?')) return ok([{ id: DEMO_CF.account, name: 'Tech Insider Bytes' }]);
    if (p.includes('/cfd_tunnel') && /notunnel/i.test(key)) return no(403, 1001, 'Not authorized');
    if (p.startsWith(`/accounts/${DEMO_CF.account}/cfd_tunnel?`)) return ok([{ id: DEMO_CF.tunnel, name: 'main' }]);
    if (p === `/accounts/${DEMO_CF.account}/cfd_tunnel/${DEMO_CF.tunnel}/configurations`) {
      if (req.method === 'PUT') world.config = structuredClone((req.body as { config: Record<string, unknown> }).config);
      return ok({ tunnel_id: DEMO_CF.tunnel, config: structuredClone(world.config) });
    }
    if (p.startsWith('/zones?name=')) return ok(decodeURIComponent(p.slice('/zones?name='.length)) === 'techinsiderbytes.com' ? [{ id: DEMO_CF.zone, name: 'techinsiderbytes.com' }] : []);
    if (p.startsWith(`/zones/${DEMO_CF.zone}/dns_records`)) {
      if (/nodns/i.test(key)) return no(403, 10000, 'Authentication error');
      if (req.method === 'POST') {
        const b = req.body as { type: string; name: string; content: string; proxied: boolean };
        world.dns.push({ id: `r${world.dns.length + 1}`, type: b.type, name: b.name, content: b.content, proxied: b.proxied });
        return ok(world.dns.at(-1));
      }
      const name = decodeURIComponent(p.split('name=')[1] ?? '');
      return ok(world.dns.filter((r) => r.name === name));
    }
    const tokens = `/accounts/${DEMO_CF.account}/access/service_tokens`;
    if (p.startsWith(tokens)) {
      if (/notoken/i.test(key)) return no(403, 10000, 'Authentication error');
      const issue = (t: { id: string; name: string; client_id: string }) => {
        const client_secret = `cf-access-secret-${randomUUID()}`;
        world.secrets.push(client_secret);
        return ok({ ...t, client_secret });
      };
      const id = p.slice(tokens.length).match(/^\/([^/?]+)/)?.[1];
      const t = world.tokens.find((x) => x.id === id);
      if (req.method === 'POST' && !id) {
        const b = req.body as { name: string; duration?: string };
        world.tokens.push({ id: `tok${++seq}`, name: b.name, client_id: `${randomUUID().replace(/-/g, '')}.access`, ...(b.duration && { duration: b.duration }) });
        return issue(world.tokens.at(-1)!);
      }
      if (!t && id) return no(404, 12130, 'access.api.error.not_found');
      if (req.method === 'POST' && p.endsWith('/rotate')) return issue(t!);
      if (req.method === 'DELETE') {
        world.tokens = world.tokens.filter((x) => x !== t);
        return ok({ id });
      }
      const name = new URLSearchParams(p.split('?')[1] ?? '').get('name');
      return ok(world.tokens.filter((x) => !name || x.name === name).map(({ id: tid, name: n, client_id }) => ({ id: tid, name: n, client_id })));
    }
    const pol = p.match(new RegExp(`^/accounts/${DEMO_CF.account}/access/apps/([^/]+)/policies(?:/([^/?]+))?`));
    if (pol) {
      const list = (world.policies[pol[1]] ??= []);
      if (req.method === 'POST') {
        if (/nopolicy/i.test(key)) return no(403, 10000, 'Authentication error');
        list.push({ id: `pol${++seq}`, ...(req.body as Omit<Policy, 'id'>) });
        return ok(list.at(-1));
      }
      if (req.method === 'DELETE') {
        world.policies[pol[1]] = list.filter((x) => x.id !== pol[2]);
        return ok({ id: pol[2] });
      }
      return ok(structuredClone(list));
    }
    if (p.startsWith(`/accounts/${DEMO_CF.account}/access/apps`)) {
      if (req.method === 'POST') {
        const b = req.body as { domain: string; name: string; policies?: Omit<Policy, 'id'>[] };
        world.apps.push({ id: `app${world.apps.length + 1}`, domain: b.domain, name: b.name });
        world.policies[world.apps.at(-1)!.id] = (b.policies ?? []).map((x) => ({ id: `pol${++seq}`, ...x }));
        return ok(world.apps.at(-1));
      }
      return ok(world.apps);
    }
    return no(404, 7003, 'No route for that URI');
  };
  return { api, calls, world };
}

registerDemo('cloudflare', () => ({ cloudflareApi: fakeCloudflare({ access: true }).api }));
