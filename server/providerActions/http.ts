// backend.providerHttp (#602): the provider-action layer's one network call. The key goes in the request's header
// here and nowhere else; the answer's JSON and GitHub's permission header come back (20 s, never throws).
import type { ActionRequest, ActionResponse } from './types.ts';

function headersFor(key: string, req: ActionRequest): Record<string, string> {
  const json: Record<string, string> = req.body === undefined ? {} : { 'Content-Type': 'application/json' };
  if (req.auth === 'xi-api-key') return { 'xi-api-key': key, ...json };
  if (req.auth === 'github') return { Authorization: `Bearer ${key}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'cubefarm', ...json };
  return { Authorization: `Bearer ${key}`, ...json };
}

export async function realProviderHttp(key: string, req: ActionRequest): Promise<ActionResponse> {
  try {
    const res = await fetch(req.url, { method: req.method, headers: headersFor(key, req), ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }), signal: AbortSignal.timeout(20_000) });
    const body = await res.json().catch(() => undefined);
    const perm = res.headers.get('x-accepted-github-permissions');
    return { status: res.status, body, ...(perm !== null && { headers: { 'x-accepted-github-permissions': perm } }) };
  } catch {
    return { status: 0 };
  }
}
