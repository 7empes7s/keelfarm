import { describe, expect, it } from 'vitest';
import { applyWrite, ingressDiff, planIngressAdd, planWrite, tokenScopes, withKey, zoneCandidates, CfError, type CfKey } from './cloudflare.ts';
import { DEMO_CF, fakeCloudflare } from './demo/cloudflare.ts';

const KEEL = { hostname: 'keel.techinsiderbytes.com', service: 'http://localhost:80' };
const CATCH = { service: 'http_status:404' };
const good: CfKey = { id: 'cdaa4976', label: 'Cloudflare (LiteLLM litellm.env)', key: 'cf-good-token-1234', ok: true };
const dead: CfKey = { id: '2bae3f4a', label: 'Cloudflare', key: 'cf-bad-token-5678', ok: false };

describe('planIngressAdd', () => {
  it('inserts before the catch-all and keeps every rule in order', () => {
    const rules = [KEEL, { hostname: 'a.example.com', path: '/api', service: 'http://localhost:3000', originRequest: { noTLSVerify: true } }, CATCH];
    const p = planIngressAdd(rules, 'Clip.TechInsiderBytes.com', 'http://localhost:80');
    expect(p.already).toBe(false);
    expect(p.after).toEqual([rules[0], rules[1], { hostname: 'clip.techinsiderbytes.com', service: 'http://localhost:80' }, CATCH]);
    expect(ingressDiff(rules, p.after).split('\n')).toEqual(['  keel.techinsiderbytes.com → http://localhost:80', '  a.example.com /api → http://localhost:3000', '+ clip.techinsiderbytes.com → http://localhost:80', '  (everything else) → http_status:404']);
  });

  it('is idempotent, and rejects the hostname routed elsewhere', () => {
    const once = planIngressAdd([KEEL, CATCH], 'clip.techinsiderbytes.com', 'http://localhost:80').after;
    expect(planIngressAdd(once, 'clip.techinsiderbytes.com', 'http://localhost:80')).toEqual({ after: once, already: true });
    expect(() => planIngressAdd(once, 'clip.techinsiderbytes.com', 'http://localhost:9000')).toThrow(/already routes to http:\/\/localhost:80/);
  });

  it('refuses what is not a hostname or a service', () => {
    expect(() => planIngressAdd([CATCH], 'not a host', 'http://localhost:80')).toThrow(/isn't a hostname/);
    expect(() => planIngressAdd([CATCH], 'clip.example.com', 'localhost:80')).toThrow(/isn't a tunnel service/);
  });

  it('lists the zones a hostname could be in', () => expect(zoneCandidates('a.b.example.com')).toEqual(['b.example.com', 'example.com']));
});

describe('the Cloudflare action against a faked API', () => {
  it('adds the hostname with the key that passes, then reads it back with every rule kept', async () => {
    const cf = fakeCloudflare();
    const plan = await planWrite([dead, good], cf.api, { op: 'tunnel_ingress_add', hostname: 'clip.techinsiderbytes.com', service: 'http://localhost:80' });
    expect(plan.change).toMatchObject({ keyId: 'cdaa4976', accountId: DEMO_CF.account, tunnelId: DEMO_CF.tunnel, tunnelName: 'main' });
    expect(plan.diff).toContain('+ clip.techinsiderbytes.com → http://localhost:80');
    expect(cf.calls.every((c) => c.method === 'GET')).toBe(true); // planning writes nothing
    // a rule added in the dashboard meanwhile survives the apply
    (cf.world.config.ingress as unknown[]).splice(1, 0, { hostname: 'new.techinsiderbytes.com', service: 'http://localhost:81' });
    const r = await applyWrite([dead, good], cf.api, plan.change);
    expect(r.ok).toBe(true);
    expect(cf.world.config.ingress).toEqual([KEEL, { hostname: 'new.techinsiderbytes.com', service: 'http://localhost:81' }, { hostname: 'clip.techinsiderbytes.com', service: 'http://localhost:80' }, CATCH]);
    expect(cf.world.config['warp-routing']).toEqual({ enabled: false }); // the rest of the config kept
    expect(r.text).toMatch(/^Read back: tunnel main ingress:\n/);
    // again: nothing to do
    expect((await planWrite([good], cf.api, { op: 'tunnel_ingress_add', hostname: 'clip.techinsiderbytes.com', service: 'http://localhost:80' })).already).toMatch(/already on tunnel main/);
    expect(await applyWrite([good], cf.api, plan.change)).toMatchObject({ ok: true, text: expect.stringMatching(/nothing written/) });
  });

  it('names the missing scope on a 1001 or a 403', async () => {
    const cf = fakeCloudflare();
    const noTunnel: CfKey = { id: 'x', label: 'Old token', key: 'cf-notunnel-1' };
    await expect(planWrite([noTunnel], cf.api, { op: 'tunnel_ingress_add', hostname: 'clip.techinsiderbytes.com', service: 'http://localhost:80' })).rejects.toThrow('"Old token" lacks Account › Cloudflare Tunnel › Edit');
    const noDns: CfKey = { id: 'y', label: 'DNS-less', key: 'cf-nodns-1' };
    await expect(planWrite([noDns], cf.api, { op: 'dns_cname_ensure', hostname: 'clip.techinsiderbytes.com' })).rejects.toThrow('"DNS-less" lacks Zone › DNS › Edit');
    const scopes = await tokenScopes([noTunnel, good], cf.api, { hostname: 'clip.techinsiderbytes.com' });
    expect(scopes).toContain('✗ tunnels: missing Account › Cloudflare Tunnel › Edit');
    expect(scopes).toMatch(/"Cloudflare \(LiteLLM litellm.env\)":\n {2}✓ token is active\n {2}✓ account\n {2}✓ tunnels\n {2}✓ tunnel main's ingress\n {2}✓ zone\n {2}✓ DNS records in techinsiderbytes.com\n {2}✓ Access apps/);
  });

  it('ensures a proxied CNAME to the tunnel and the Access apps, idempotently', async () => {
    const cf = fakeCloudflare();
    const dns = await planWrite([good], cf.api, { op: 'dns_cname_ensure', hostname: 'clip.techinsiderbytes.com' });
    expect(dns.diff).toContain(`+ CNAME clip.techinsiderbytes.com → ${DEMO_CF.tunnel}.cfargotunnel.com (proxied)`);
    expect(await applyWrite([good], cf.api, dns.change)).toMatchObject({ ok: true });
    expect((await planWrite([good], cf.api, { op: 'dns_cname_ensure', hostname: 'clip.techinsiderbytes.com' })).already).toBeTruthy();
    await expect(planWrite([good], cf.api, { op: 'dns_cname_ensure', hostname: 'keel.techinsiderbytes.com' })).resolves.toMatchObject({ already: expect.any(String) });
    const access = await planWrite([good], cf.api, { op: 'access_app_ensure', hostname: 'clip.techinsiderbytes.com', emails: ['Manager@Example.com'], bypass: ['api/health'] });
    expect(access.change).toMatchObject({ emails: ['manager@example.com'], bypass: ['/api/health'] });
    expect(await applyWrite([good], cf.api, access.change)).toMatchObject({ ok: true });
    expect(cf.world.apps.map((a) => a.domain)).toEqual(['clip.techinsiderbytes.com', 'clip.techinsiderbytes.com/api/health']);
    expect((await planWrite([good], cf.api, { op: 'access_app_ensure', hostname: 'clip.techinsiderbytes.com', emails: ['manager@example.com'], bypass: ['/api/health'] })).already).toBeTruthy();
  });

  it('says what every key lacks when none can do it', async () => {
    await expect(withKey([dead], fakeCloudflare().api, async () => Promise.reject(new CfError('x', 'Zone › DNS › Edit')))).rejects.toThrow('No Cloudflare key can do this: "Cloudflare" lacks Zone › DNS › Edit');
    await expect(withKey([], fakeCloudflare().api, async () => 1)).rejects.toThrow(/Settings → Providers/);
  });
});
