// Cloudflare in the provider-action layer (#602): #586's tunnel, DNS and Access ops (server/cloudflare.ts) as a
// module. Its calls go through backend.cloudflareApi, as before.
import { z } from 'zod';
import { applyIdp, applyWrite, CfError, ingressGet, planIdp, planWrite, tokenScopes } from '../cloudflare.ts';
import { envSecretFile } from '../cfSecretFile.ts';
import type { CfChange } from '../../shared/cloudflare.ts';
import type { ActionCtx, ActionPlan, ProviderModule } from './types.ts';
import { applyTokenCreate, planTokenCreate, tokenCreateArgs } from './cfTokens.ts';

const host = z.string().min(4).max(253);
const tunnel = z.string().min(1).max(100).optional();

const noFile = (): never => {
  throw new CfError('No file to store the secret in.');
};

const UNDO: Record<CfChange['op'], string> = {
  tunnel_ingress_add: 'remove the rule in Zero Trust → Networks → Tunnels',
  dns_cname_ensure: 'delete the record in DNS',
  access_app_ensure: 'delete the app in Zero Trust → Access → Applications',
  access_service_token_ensure: 'delete its policy on the app, then the token in Zero Trust → Access → Service auth, and its two lines in the env file',
  access_idp_ensure: 'delete it in Zero Trust → Settings → Authentication (apps signing in with it fall back to their other logins)',
};

/** access_idp_ensure (#621): the office's Entra app as an Access login; the secret is read from the key store at apply. */
async function planIdpCard(ctx: ActionCtx, a: Record<string, unknown>): Promise<ActionPlan> {
  const p = await planIdp(ctx.keys, ctx.cloudflareApi, { name: a.name as string | undefined, cred: ctx.entra?.get() });
  const c = p.change as Extract<CfChange, { op: 'access_idp_ensure' }>;
  return { change: { provider: 'cloudflare', op: c.op, keyId: c.keyId, data: { ...c } }, summary: p.summary, diff: p.diff, argv: ['cloudflare', c.op, c.name], undo: UNDO[c.op], ...(p.already && { already: p.already }) };
}

async function plan(ctx: ActionCtx, a: Record<string, unknown> & { op: CfChange['op']; hostname: string }): Promise<ActionPlan> {
  const secretFile = a.op === 'access_service_token_ensure' ? (ctx.secretFile ?? noFile)(a.env_file as string | undefined, String(a.name ?? '')) : undefined;
  const p = await planWrite(ctx.keys, ctx.cloudflareApi, { ...a, secretFile });
  const c = p.change as Exclude<CfChange, { op: 'access_idp_ensure' }>;
  return {
    change: { provider: 'cloudflare', op: c.op, keyId: c.keyId, data: { ...c } },
    summary: p.summary,
    diff: p.diff,
    argv: ['cloudflare', c.op, c.hostname, ...(c.op === 'tunnel_ingress_add' ? [c.service] : c.op === 'access_service_token_ensure' ? [c.name] : c.op === 'access_app_ensure' && c.idps?.length ? [`idps=${c.idps.map((i) => i.name).join(',')}`] : [])],
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
      args: z.object({ hostname: host, emails: z.array(z.string().email().max(200)).min(1).max(50), bypass: z.array(z.string().min(1).max(200)).max(10).optional(), idps: z.array(z.string().min(1).max(60)).max(10).optional(), auto_redirect: z.boolean().optional() }),
      plan: (ctx, a) => plan(ctx, { ...a, op: 'access_app_ensure', hostname: String(a.hostname) }),
    },
    access_service_token_ensure: {
      args: z.object({ hostname: host, name: z.string().min(1).max(100), duration: z.string().min(2).max(10).optional(), env_file: z.string().min(2).max(500).optional() }),
      plan: (ctx, a) => plan(ctx, { ...a, op: 'access_service_token_ensure', hostname: String(a.hostname) }),
    },
    access_idp_ensure: { args: z.object({ name: z.string().min(1).max(60).optional() }), plan: (ctx, a) => planIdpCard(ctx, a) },
    token_create: { args: tokenCreateArgs, plan: (ctx, a) => planTokenCreate(ctx, tokenCreateArgs.parse(a)) },
  },
  apply: (ctx, c) => {
    if (c.op === 'token_create') return applyTokenCreate(ctx, c);
    const change = c.data as unknown as CfChange;
    if (change.op === 'access_idp_ensure') {
      const cred = ctx.entra?.get();
      return applyIdp(ctx.keys, ctx.cloudflareApi, change, cred, async (id) => {
        if (cred) await ctx.entra!.set({ ...cred, idp: { cfKeyId: change.keyId, accountId: change.accountId, id, name: change.name, keyId: cred.keyId } });
      });
    }
    return applyWrite(ctx.keys, ctx.cloudflareApi, change, change.op === 'access_service_token_ensure' ? envSecretFile(change.envFile) : undefined);
  },
};
