// install_key into an app (#622): a Providers key set through the app's own Settings API (PUT /api/settings/<group>),
// then its Test pressed (POST …/test) and read back, over the app's Cloudflare Access service token (its env file in
// the office's secrets folder, written by access_service_token_ensure). The value goes in the PUT's body and nowhere
// else: nothing here returns it.
import fs from 'node:fs/promises';
import { envAccessPair } from './cfSecretFile.ts';
import type { AppTarget } from '../shared/keyInstall.ts';
import type { ActionResponse, ProviderHttp } from './providerActions/types.ts';

/** The app's Access service token "id:secret" from its env file, or what to do about it. */
export async function appAccess(t: AppTarget, file: string): Promise<{ pair: string } | { error: string }> {
  const pair = envAccessPair(await fs.readFile(file, 'utf8').catch(() => ''));
  return pair ? { pair } : { error: `No Access service token for ${t.name} at ${file}: make one with cloudflare access_service_token_ensure { hostname: "${new URL(t.url).host}", name: "${t.access}" }, then install again.` };
}

/** Where a variable goes: "clipfarm's Settings → youtube". */
export const appWhere = (t: AppTarget, varName: string) => `${t.name}'s Settings → ${t.groups[varName]}`;

function refusal(t: AppTarget, r: ActionResponse): string | null {
  if (r.status === 0) return `Couldn't reach ${t.name} at ${t.url}.`;
  if (r.status === 401 || r.status === 403) return `${t.name} turned the office away at Cloudflare Access: its service token isn't allowed on the app. Make one with cloudflare access_service_token_ensure for ${new URL(t.url).host}.`;
  if (r.status >= 400) {
    const e = (r.body as { error?: unknown } | undefined)?.error;
    return `${t.name} answered ${r.status}: ${typeof e === 'string' ? e.slice(0, 200) : 'no reason given'}.`;
  }
  return null;
}

/** Sets the variable; null when it went, else why not. */
export async function appSet(http: ProviderHttp, access: string, t: AppTarget, varName: string, value: string): Promise<string | null> {
  const r = await http(access, { method: 'PUT', url: `${t.url}/api/settings/${t.groups[varName]}`, auth: 'cf-access', body: { values: { [varName]: value } } });
  return refusal(t, r);
}

/** Presses the app's Test for the variable's group: "Working" or why not, in the app's words. */
export async function appTest(http: ProviderHttp, access: string, t: AppTarget, varName: string): Promise<{ ok: boolean; text: string }> {
  const r = await http(access, { method: 'POST', url: `${t.url}/api/settings/${t.groups[varName]}/test`, auth: 'cf-access', body: {} });
  const no = refusal(t, r);
  if (no) return { ok: false, text: no };
  const b = (r.body ?? {}) as { ok?: unknown; message?: unknown };
  const said = typeof b.message === 'string' ? b.message.slice(0, 200) : '';
  return b.ok === true ? { ok: true, text: `${t.name}'s Test: Working${said ? ` (${said})` : ''}` } : { ok: false, text: `${t.name}'s Test: Not working: ${said || 'no reason given'}` };
}
