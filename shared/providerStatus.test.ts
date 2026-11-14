import { describe, expect, it } from 'vitest';
import { entryStatus, needsAttention, providerStatusText } from './providerStatus.ts';
import { tenantGuesses, tokenTenant } from './keySetup.ts';
import type { ProviderConnection } from './types.ts';

const conn = (o: Partial<ProviderConnection>): ProviderConnection => ({ id: 'k1', provider: 'openai', label: 'OpenAI', addedAt: 0, keyHint: 'ab12', test: { at: 1, ok: true, note: 'Key works' }, tags: [], usedFor: 'inference', ...o });

describe("each Providers key's completeness (#677)", () => {
  it('marks a dead key not working with its reason, a missing Tenant ID or permission as needing attention', () => {
    const dead = conn({ id: 'cf1', provider: 'cloudflare', label: 'Cloudflare (old)', keyHint: 'e578', accountId: '0123456789abcdef0123456789abcdef', test: { at: 1, ok: false, note: 'Turned away (401)', result: 'dead' } });
    const noTenant = conn({ id: 'e1', provider: 'entra', label: 'Entra', keyHint: 'Hc85', test: null });
    const noDns = conn({ id: 'cf2', provider: 'cloudflare', label: 'Cloudflare', accountId: '0123456789abcdef0123456789abcdef', test: { at: 1, ok: true, note: 'Missing: Zone DNS edit', missing: ['Zone DNS edit'] } });
    const fine = conn({});
    expect(entryStatus(dead)).toEqual({ state: 'not working', lacks: [], missing: [], reason: 'Turned away (401)' });
    expect(entryStatus(noTenant)).toEqual({ state: 'not tested', lacks: ['Tenant ID'], missing: [] });
    expect([dead, noTenant, noDns, fine].map(needsAttention)).toEqual([true, true, true, false]);

    const text = providerStatusText([fine, dead, noTenant, noDns]);
    const lines = text.split('\n');
    expect(lines[0]).toBe('4 keys, 3 need attention:');
    expect(lines.at(-1)).toBe('k1 "OpenAI" (openai, ••••ab12) · working · can: test the key, list models, check credit');
    expect(lines[1]).toBe('cf1 "Cloudflare (old)" (cloudflare, ••••e578) · not working: Turned away (401) · Account ID 0123456789abcdef0123456789abcdef');
    expect(lines[2]).toBe('e1 "Entra" (entra, ••••Hc85) · not tested · lacks its Tenant ID: set it with provider_update (no key needed)');
    expect(lines[3]).toMatch(/^cf2 .* · working · Account ID \w+ · missing permissions: Zone DNS edit · can: /);
    expect(providerStatusText([fine], 'entra')).toMatch(/^No Microsoft Entra key/);
  });

  it("reads the tenant GUID from a sign-in's token and lists each domain to try once", () => {
    const tid = '73b6beef-9d40-4ea6-8ad6-2da6b4818f29';
    const jwt = (o: unknown) => `e30.${btoa(JSON.stringify(o)).replace(/=+$/, '')}.sig`;
    expect(tokenTenant({ access_token: jwt({ tid: tid.toUpperCase(), aud: 'x' }) })).toBe(tid);
    expect(tokenTenant({ access_token: jwt({ tid: 'not-a-guid' }) })).toBeNull();
    expect(tokenTenant({ access_token: 'opaque' })).toBeNull();
    expect(tokenTenant(undefined)).toBeNull();
    expect(tenantGuesses(['TechInsiderBytes.com', undefined, 'techinsiderbytes.com', 'no spaces.com', ''])).toEqual(['techinsiderbytes.com']);
  });
});
