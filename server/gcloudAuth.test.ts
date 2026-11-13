import { createPublicKey, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accessToken, assertion, gcloudProbe } from './gcloudAuth.ts';
import { demoServiceAccount } from './demo/gcloud.ts';
import { parseServiceAccount, type ServiceAccount } from '../shared/gcloud.ts';
import type { ProbeRequest } from '../shared/providers.ts';

// #622: a service account's token comes from a JWT signed with its private key; the key itself never leaves.
describe('a service account token', () => {
  const json = demoServiceAccount();
  const sa = parseServiceAccount(json) as ServiceAccount;

  it('signs an RS256 JWT for the cloud-platform scope that its public key verifies', () => {
    const [head, claims, sig] = assertion(sa, 1_700_000_000_000).split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'demo0000keyid9f3e' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ iss: sa.clientEmail, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(createPublicKey(sa.privateKey), Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('trades it once an hour, and reads the project with the token, never the key', async () => {
    const seen: ProbeRequest[] = [];
    const probe = async (req: ProbeRequest) => (seen.push(req), req.kind === 'form' ? { status: 200, body: { access_token: 'ya29.demo', expires_in: 3600 } } : { status: 200, body: {} });
    expect(await gcloudProbe(json, probe)).toEqual({ status: 200, body: {} });
    expect(await accessToken(json, probe)).toEqual({ token: 'ya29.demo' });
    expect(seen.map((r) => r.kind)).toEqual(['form', 'http']); // cached
    expect(seen[1]).toEqual({ kind: 'http', url: 'https://cloudresourcemanager.googleapis.com/v1/projects/clipfarm-demo', headers: { Authorization: 'Bearer ya29.demo' } });
    expect(JSON.stringify(seen)).not.toContain(sa.privateKey.split('\n')[1]);
  });

  it('turns a refused or broken key into a 401', async () => {
    expect(await accessToken(demoServiceAccount('other@x.iam.gserviceaccount.com'), async () => ({ status: 400, body: { error: 'invalid_grant' } }))).toEqual({ status: 401 });
    expect(await accessToken('{"type":"service_account"}', async () => ({ status: 200 }))).toEqual({ status: 401 });
  });
});
