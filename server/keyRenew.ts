// Renewing a key the office made (#609), before it runs out (shared/keyInstall.ts renewDue): a new token with the same
// permissions from the key that made the first, saved over the old value, installed into every service env file the
// old one was in, and only then the old token revoked. An install that fails keeps the old token alive (the service
// still runs on it) and says so. No value ever goes into the text returned.
import type { CfApi } from './cloudflare.ts';
import { mintToken, revokeToken } from './providerActions/cfTokens.ts';
import type { KeyInstall } from '../shared/keyInstall.ts';
import type { ProviderConnection } from '../shared/types.ts';

export interface RenewDeps {
  cloudflareApi: CfApi;
  /** The value of the key that made it, if it's still in Providers. */
  parentKey(id: string): string | undefined;
  /** Saves the new value over the old one. */
  renewed(id: string, value: string, expiresAt: number, tokenId: string): Promise<void>;
  /** Writes the new value into one target (and restarts its unit). */
  install(ki: KeyInstall, value: string): Promise<{ ok: boolean; text: string }>;
}

export async function renewMinted(c: ProviderConnection, deps: RenewDeps, now = Date.now()): Promise<{ ok: boolean; text: string }> {
  const m = c.mint;
  if (!m || c.provider !== 'cloudflare') return { ok: false, text: `"${c.label}" wasn't made by the office: it can't renew it.` };
  const parent = deps.parentKey(m.parentId);
  if (!parent) return { ok: false, text: `Couldn't renew "${c.label}": the key that made it is gone from Settings → Providers. Make it again with token_create.` };
  const call: Parameters<typeof mintToken>[0] = (req) => deps.cloudflareApi(parent, req);
  let t: Awaited<ReturnType<typeof mintToken>>;
  try {
    t = await mintToken(call, m, now);
  } catch (err) {
    return { ok: false, text: `Couldn't renew "${c.label}": ${(err as Error).message}` };
  }
  await deps.renewed(c.id, t.value, t.expiresAt, t.id);
  const lines = [`Made a new "${m.name}" token with the same permissions, until ${new Date(t.expiresAt).toISOString().slice(0, 10)}.`];
  let installed = true;
  for (const ki of c.installs ?? []) {
    const r = await deps.install(ki, t.value);
    lines.push(r.text);
    installed &&= r.ok;
  }
  if (!installed) return { ok: false, text: `${lines.join('\n')}\nThe old token stays until its expiry, as a service may still use it.` };
  try {
    await revokeToken(call, m.tokenId);
    lines.push('Revoked the old token.');
  } catch (err) {
    return { ok: false, text: `${lines.join('\n')}\nCouldn't revoke the old token: ${(err as Error).message}` };
  }
  return { ok: true, text: lines.join('\n') };
}
