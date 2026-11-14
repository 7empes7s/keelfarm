// app_call (#625): IT calls a floor's live app over HTTPS past Cloudflare Access, with the service token from its env
// file (CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET) read in-process and put only in the request's headers
// (providerActions/http.ts, auth 'cf-access'; read with cfSecretFile.ts' envAccessPair). Pure: the allow-list, which
// token file fits a host, and the reply's shape. The live office's own /api/ on localhost is readable too, with no token (#663).

type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH';

/** The apps IT may call, and how. KEEL only reads: no write ever reaches its live tenant (CLAUDE.md). */
export const APP_CALL_HOSTS: Record<string, readonly Method[]> = {
  'clip.techinsiderbytes.com': ['GET', 'HEAD', 'POST', 'PUT', 'PATCH'],
  'keel.techinsiderbytes.com': ['GET', 'HEAD'],
};

/** The live office's own read-only API on this machine (#663): http://localhost:<office port>/api/…, no token. */
export function officeApiUrl(url: string, officePort: number): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname) && u.port === String(officePort) && u.pathname.startsWith('/api/') && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Why this call can't go, or null; `url` parsed when it can. `officePort`: the office's own, whose /api/ IT may read. */
export function appCallRefusal(url: string, method: string, officePort: number): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `"${url}" isn't a URL: give it in full, e.g. https://clip.techinsiderbytes.com/api/settings.`;
  }
  if (officeApiUrl(url, officePort)) return method === 'GET' || method === 'HEAD' ? null : "app_call only reads the office's API: GET or HEAD.";
  if (u.protocol !== 'https:') return `app_call goes over https only (or GET http://localhost:${officePort}/api/… for the office's own API).`;
  if (u.username || u.password) return 'Leave sign-in out of the URL: the service token is added by the office.';
  const methods = APP_CALL_HOSTS[u.hostname];
  if (!methods) return `${u.hostname} isn't on app_call's list (${Object.keys(APP_CALL_HOSTS).join(', ')}).`;
  if (!methods.includes(method as Method)) return `${method} isn't allowed on ${u.hostname} (${methods.join(', ')}).`;
  return null;
}

/** Of the office's secrets folder, the Access token files for this host: the ones naming its first label (clip → cf-access-clipfarm-…). */
export function tokenFilesFor(host: string, files: readonly string[]): string[] {
  const label = host.split('.')[0].toLowerCase();
  return files.filter((f) => /^cf-access-.*\.env$/.test(f) && f.toLowerCase().includes(label));
}

/** The answer as IT sees it: status, then the body (JSON pretty-printed), cut at `max`. Masking is the caller's. */
export function appCallReply(status: number, body: unknown, max = 8_000): string {
  if (status === 0) return "No answer: the app couldn't be reached (DNS, TLS or a 20 s timeout).";
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  const cut = text.length > max ? `${text.slice(0, max)}\n… cut at ${Math.round(max / 1000)} KB` : text;
  return `HTTP ${status}${status === 302 || status === 403 ? ' (Access refused the token: check its Service Auth policy)' : ''}${cut ? `\n${cut}` : ''}`;
}
