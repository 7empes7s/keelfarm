// A Google service account's access token (#622): a JWT signed with its private key (RS256), traded at its token URL
// for an hour's token (cached until 5 minutes before it ends). The private key is used here and nowhere else; the
// Providers test and the provider-action layer's calls (server/providerActions/http.ts) both come through.
import { createHash, createSign } from 'node:crypto';
import { parseServiceAccount, type ServiceAccount } from '../shared/gcloud.ts';
import type { ProbeRequest, ProbeResult } from '../shared/providers.ts';

type Probe = (req: ProbeRequest) => Promise<ProbeResult>;

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** The signed JWT the token URL takes. */
export function assertion(sa: ServiceAccount, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const head = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...(sa.privateKeyId && { kid: sa.privateKeyId }) }))}.${b64url(JSON.stringify({ iss: sa.clientEmail, scope: SCOPE, aud: sa.tokenUri, iat, exp: iat + 3600 }))}`;
  return `${head}.${b64url(createSign('RSA-SHA256').update(head).sign(sa.privateKey))}`;
}

const cache = new Map<string, { token: string; until: number }>();

/** An access token for the service account's JSON, or the token URL's refusal as a status (401 for a bad key). */
export async function accessToken(json: string, probe: Probe, now = Date.now()): Promise<{ token: string } | { status: number }> {
  const sa = parseServiceAccount(json);
  if (typeof sa === 'string') return { status: 401 };
  const id = createHash('sha256').update(json).digest('hex');
  const hit = cache.get(id);
  if (hit && hit.until > now) return { token: hit.token };
  let r: ProbeResult;
  try {
    r = await probe({ kind: 'form', url: sa.tokenUri, form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(sa, now) } });
  } catch {
    return { status: 401 }; // a private key node can't sign with
  }
  const b = (r.body ?? {}) as { access_token?: unknown; expires_in?: unknown };
  if (typeof b.access_token !== 'string' || !b.access_token) return { status: r.status === 0 ? 0 : 401 };
  cache.set(id, { token: b.access_token, until: now + (Number(b.expires_in) || 3600) * 1000 - 5 * 60_000 });
  return { token: b.access_token };
}

/** The Providers test: a token, then the project read with it. */
export async function gcloudProbe(json: string, probe: Probe): Promise<ProbeResult> {
  const t = await accessToken(json, probe);
  if (!('token' in t)) return { status: t.status };
  const sa = parseServiceAccount(json) as ServiceAccount;
  return probe({ kind: 'http', url: `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}`, headers: { Authorization: `Bearer ${t.token}` } });
}
