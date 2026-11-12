// Cloudflare in the provider-action layer (#602): #586's tunnel, DNS and Access ops (server/cloudflare.ts) as a
// module. Its calls go through backend.cloudflareApi, as before.
import { z } from 'zod';
import { applyWrite, ingressGet, planWrite, tokenScopes } from '../cloudflare.ts';
import type { CfChange } from '../../shared/cloudflare.ts';
import type { ActionCtx, ActionPlan, ProviderModule } from './types.ts';

const host = z.string().min(4).max(253);
const tunnel = z.string().min(1).max(100).optional();

const UNDO: Record<CfChange['op'], string> = {
  tunnel_ingress_add: 'remove the rule in Zero Trust → Networks → Tunnels',
  dns_cname_ensure: 'delete the record in DNS',
  access_app_ensure: 'delete the app in Zero Trust → Access → Applications',
};

async function plan(ctx: ActionCtx, a: Record<string, unknown> & { op: CfChange['op']; hostname: string }): Promise<ActionPlan> {
  const p = await planWrite(ctx.keys, ctx.cloudflareApi, a);
  const c = p.change;
  return {
    change: { provider: 'cloudflare', op: c.op, keyId: c.keyId, data: { ...c } },
    summary: p.summary,
    diff: p.diff,
    argv: ['cloudflare', c.op, c.hostname, ...(c.op === 'tunnel_ingress_add' ? [c.service] : [])],
    undo: UNDO[c.op],
    ...(p.already && { already: p.already }),
  };
}

export const cloudflareModule: ProviderModule = {
  provider: 'cloudflare',
  name: 'Cloudflare',
  ops: {
    token_scopes: { args: z.object({ hostname: host.optional(), tunnel }), read: (ctx, a) => tokenScopes(ctx.keys, ctx.cloudflareApi, a) },
    tunnel_ingress_get: { args: z.object({ tunnel }), read: (ctx, a) => ingressGet(ctx.keys, ctx.cloudflareApi, a.tunnel as string | undefined) },
    tunnel_ingress_add: { args: z.object({ hostname: host, service: z.string().min(1).max(200), tunnel }), plan: (ctx, a) => plan(ctx, { ...a, op: 'tunnel_ingress_add', hostname: String(a.hostname) }) },
    dns_cname_ensure: { args: z.object({ hostname: host, tunnel }), plan: (ctx, a) => plan(ctx, { ...a, op: 'dns_cname_ensure', hostname: String(a.hostname) }) },
    access_app_ensure: {
      args: z.object({ hostname: host, emails: z.array(z.string().email().max(200)).min(1).max(50), bypass: z.array(z.string().min(1).max(200)).max(10).optional() }),
      plan: (ctx, a) => plan(ctx, { ...a, op: 'access_app_ensure', hostname: String(a.hostname) }),
    },
  },
  apply: (ctx, c) => applyWrite(ctx.keys, ctx.cloudflareApi, c.data as unknown as CfChange),
};
