// Narrow Cloudflare API tokens (#609): provider_action cloudflare token_create makes a token with only the permission
// groups a use needs, on the key's account, expiring in `days`; the office saves it as its own Providers key (the value
// never leaves the server) and renews it before it runs out (server/keyRenew.ts): a new token with the same
// permissions, installed where the old one was, then the old one revoked.
import { z } from 'zod';
import { cf, CfError, withKey, type CfApi, type CfKey } from '../cloudflare.ts';
import { RENEW_DAYS } from '../../shared/keyInstall.ts';
import type { ActionCtx, ActionPlan, ActionResult } from './types.ts';
import type { ProviderChange } from '../../shared/providerActions.ts';
import type { KeyMint } from '../../shared/types.ts';

const PERM = 'User › API Tokens › Edit';
const DAY = 86_400_000;

/** A permission group as Cloudflare lists it; `scopes` says whether it's for the account or its zones. */
type CfGroup = KeyMint['groups'][number];
/** What a made token is, kept on its Providers connection so a renewal makes the same one. */
export type CfMint = Omit<KeyMint, 'parentId' | 'tokenId'>;

type Call = (req: Parameters<CfApi>[1]) => ReturnType<CfApi>;

export const tokenCreateArgs = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string().min(2).max(100)).min(1).max(20),
  days: z.number().int().min(1).max(365).optional(),
});

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The token's policies: account groups on the account, zone groups on every zone in it. User-level ones are refused. */
function tokenPolicies(m: Pick<CfMint, 'accountId' | 'groups'>) {
  const account = `com.cloudflare.api.account.${m.accountId}`;
  const zone = m.groups.filter((g) => g.scopes?.some((s) => s.includes('.zone')));
  const acct = m.groups.filter((g) => !zone.includes(g));
  return [
    ...(acct.length ? [{ effect: 'allow', resources: { [account]: '*' }, permission_groups: acct.map((g) => ({ id: g.id })) }] : []),
    ...(zone.length ? [{ effect: 'allow', resources: { [account]: { 'com.cloudflare.api.account.zone.*': '*' } }, permission_groups: zone.map((g) => ({ id: g.id })) }] : []),
  ];
}

/** Cloudflare's expiry form: whole seconds, Z. */
const expiry = (at: number) => new Date(at).toISOString().replace(/\.\d+Z$/, 'Z');

/** Makes the token; its value goes only to the caller (to be saved as a key). */
export async function mintToken(call: Call, m: CfMint, now = Date.now()): Promise<{ id: string; value: string; expiresAt: number }> {
  const expiresAt = now + m.days * DAY;
  const r = await cf<{ id?: string; value?: string }>(call, { method: 'POST', path: '/user/tokens', body: { name: m.name, policies: tokenPolicies(m), expires_on: expiry(expiresAt) } }, PERM);
  if (!r?.id || !r.value) throw new CfError('Cloudflare made no token.');
  return { id: r.id, value: r.value, expiresAt };
}

/** Revokes a token the office made. */
export const revokeToken = (call: Call, id: string) => cf(call, { method: 'DELETE', path: `/user/tokens/${encodeURIComponent(id)}` }, PERM);

/** token_create's plan: the permission groups found by name (as the dashboard words them) and the account. */
export async function planTokenCreate(ctx: ActionCtx, a: z.infer<typeof tokenCreateArgs>): Promise<ActionPlan> {
  return withKey(ctx.keys as CfKey[], ctx.cloudflareApi, async (call, key) => {
    const all = await cf<CfGroup[]>(call, { method: 'GET', path: '/user/tokens/permission_groups' }, PERM);
    const groups = a.permissions.map((p) => {
      const g = all.find((x) => norm(x.name) === norm(p));
      if (!g) throw new CfError(`Cloudflare has no permission "${p}". Name them as the dashboard does, e.g. ${all.slice(0, 4).map((x) => `"${x.name}"`).join(', ')}.`);
      if (g.scopes?.some((s) => s.includes('api.user'))) throw new CfError(`"${g.name}" is a user permission: made tokens get account and zone permissions only.`);
      return { id: g.id, name: g.name, ...(g.scopes && { scopes: g.scopes }) };
    });
    const accountId = key.accountId ?? (await cf<{ id: string }[]>(call, { method: 'GET', path: '/accounts?per_page=50' }, 'Account › Account Settings › Read'))[0]?.id;
    if (!accountId) throw new CfError('The key sees no Cloudflare account.');
    const mint: CfMint = { name: a.name, accountId, groups, days: a.days ?? 90 };
    const names = groups.map((g) => g.name).join(', ');
    return {
      change: { provider: 'cloudflare', op: 'token_create', keyId: key.id, data: { ...mint } },
      summary: `make API token "${a.name}" with only ${names}`,
      diff: `+ API token "${a.name}"\n${groups.map((g) => `+   ${g.name}`).join('\n')}\n+ expires in ${mint.days} days, renewed ${RENEW_DAYS} days before\n+ saved in Settings → Providers (the value is never shown)`,
      argv: ['cloudflare', 'token_create', a.name],
      undo: 'remove its card in Settings → Providers and the token in My Profile → API Tokens',
    };
  });
}

/** Approve: the token made with the card's key and saved as the office's own key. */
export async function applyTokenCreate(ctx: ActionCtx, c: ProviderChange): Promise<ActionResult> {
  const key = ctx.keys.find((k) => k.id === c.keyId);
  if (!key) return { ok: false, text: 'The Cloudflare key this card was planned with is gone from Settings → Providers: ask for it again.' };
  if (!ctx.saveMinted) return { ok: false, text: 'Nowhere to save the token.' };
  const m = c.data as unknown as CfMint;
  try {
    const t = await mintToken((req) => ctx.cloudflareApi(key.key, req), m);
    const label = await ctx.saveMinted({ provider: 'cloudflare', value: t.value, label: m.name, expiresAt: t.expiresAt, mint: { ...m, parentId: key.id, tokenId: t.id } });
    return { ok: true, text: `Made API token "${m.name}" (${m.groups.map((g) => g.name).join(', ')}), saved in Settings → Providers as "${label}"; it renews itself ${RENEW_DAYS} days before ${new Date(t.expiresAt).toISOString().slice(0, 10)}. Install it with install_key.` };
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  }
}
