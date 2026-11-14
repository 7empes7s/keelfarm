// Each Providers entry's completeness (#677), pure: whether it works (its last test, the reason when not), a field its
// provider's setup asks for that it lacks (Entra's Tenant ID, Cloudflare's Account ID), the permissions its test found
// missing, and what the office can do with it. The CEO's provider_status reads it, so it asks the manager only for what
// is really missing; the card on the Providers page draws the same fields.
import { setupGuide } from './keySetup.ts';
import { keyAbilities } from './providerActions.ts';
import { providerDef } from './providers.ts';
import type { ProviderConnection } from './types.ts';

export interface EntryStatus {
  state: 'working' | 'not working' | 'not tested';
  /** Fields its setup asks for that it lacks ("Tenant ID"). */
  lacks: string[];
  missing: string[];
  reason?: string;
}

export function entryStatus(c: ProviderConnection): EntryStatus {
  const ask = setupGuide(c.provider).accountId;
  const lacks = ask && !c.accountId ? [ask.label] : [];
  const missing = c.test?.missing ?? [];
  const state = !c.test ? 'not tested' : c.test.ok ? 'working' : 'not working';
  return { state, lacks, missing, ...(c.test && !c.test.ok && { reason: c.test.note }) };
}

/** Lacking a field or a permission, or not working: the entries the manager or the CEO should look at. */
export const needsAttention = (c: ProviderConnection) => {
  const s = entryStatus(c);
  return s.state === 'not working' || s.lacks.length > 0 || s.missing.length > 0;
};

/** provider_status: one line per entry (no secret: the last 4 only), the ones needing attention first. */
export function providerStatusText(conns: readonly ProviderConnection[], provider?: string): string {
  const list = conns.filter((c) => !provider || c.provider === provider);
  if (!list.length) return provider ? `No ${providerDef(provider)?.name ?? provider} key in Settings → Providers: ask the manager for one (or save_provider_key a pasted one).` : 'No keys in Settings → Providers yet.';
  const sorted = [...list].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)));
  const lines = sorted.map((c) => {
    const s = entryStatus(c);
    const ask = setupGuide(c.provider).accountId;
    const can = s.state === 'working' ? keyAbilities(c.provider, s.missing)?.can : undefined;
    return [
      `${c.id} "${c.label}" (${c.provider}, ••••${c.keyHint})`,
      s.state === 'not working' ? `not working: ${s.reason}` : s.state,
      ask && (c.accountId ? `${ask.label} ${c.accountId}` : `lacks its ${ask.label}: set it with provider_update (no key needed)`),
      s.missing.length && `missing permissions: ${s.missing.join(', ')}`,
      can?.length && `can: ${can.join(', ')}`,
    ]
      .filter(Boolean)
      .join(' · ');
  });
  const n = list.filter(needsAttention).length;
  return `${list.length} key${list.length === 1 ? '' : 's'}, ${n ? `${n} need${n === 1 ? 's' : ''} attention` : 'all complete'}:\n${lines.join('\n')}`;
}
