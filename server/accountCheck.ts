// Providers & accounts (#247): the real Test of an account. A login: is there one in its folder, and (Claude) its
// usage, read as usagePoll.ts does. A key: one free request (the provider's model list). The key goes in that request's
// header and nowhere else, and errors never carry the request.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkUsage, oauthReadings } from './usagePoll.ts';
import { readCodexLimits } from './codexLimits.ts';
import { codexReadings } from '../shared/usageSources.ts';
import type { AccountCli, AccountKind, UsageReading } from '../shared/types.ts';

export interface AccountCheck {
  signedIn: boolean; // a login on file, or a key the provider accepts
  readings: UsageReading[];
  note: string; // one line for the manager
}

export interface CheckTarget {
  cli: AccountCli;
  kind: AccountKind;
}

const get = async (url: string, headers: Record<string, string>): Promise<number> => {
  try {
    return (await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })).status;
  } catch {
    return 0;
  }
};

const keyNote = (status: number, who: string): AccountCheck =>
  status === 200
    ? { signedIn: true, readings: [], note: `✓ ${who} accepted the key.` }
    : status === 401 || status === 403
      ? { signedIn: false, readings: [], note: `${who} turned the key away (${status}): paste a new one.` }
      : { signedIn: true, readings: [], note: `Couldn't reach ${who}${status ? ` (${status})` : ''}: try again in a minute.` };

/** Test an account: `dir` is its login folder, `secret` its key or token ('' for a login). Never throws. */
export async function checkAccount(a: CheckTarget, dir: string, secret: string): Promise<AccountCheck> {
  if (a.kind === 'subscription-login') {
    if (a.cli === 'codex') {
      const ok = !!(await fs.stat(path.join(dir, 'auth.json')).catch(() => null));
      if (!ok) return { signedIn: false, readings: [], note: 'Not signed in yet: tap Sign in.' };
      const readings = codexReadings(await readCodexLimits(dir), Date.now());
      return { signedIn: true, readings, note: readings.length ? '✓ Signed in; usage read.' : '✓ Signed in.' };
    }
    const res = await checkUsage({ CLAUDE_CONFIG_DIR: dir });
    if ('readings' in res) return { signedIn: true, readings: res.readings, note: '✓ Signed in; usage read.' };
    if (res.error === 'failed') return { signedIn: true, readings: [], note: "Signed in, but its usage couldn't be read just now." };
    return { signedIn: false, readings: [], note: res.error === 'expired' ? 'Its sign-in expired: tap Sign in again.' : 'Not signed in yet: tap Sign in.' };
  }
  if (!secret) return { signedIn: false, readings: [], note: 'No key saved yet.' };
  if (a.cli === 'codex') return keyNote(await get('https://api.openai.com/v1/models', { Authorization: `Bearer ${secret}` }), 'OpenAI');
  if (a.kind === 'api-key') return keyNote(await get('https://api.anthropic.com/v1/models?limit=1', { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }), 'Anthropic');
  // A setup token reads its subscription's usage like a login does.
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${secret}`, 'anthropic-beta': 'oauth-2025-04-20' }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) return { signedIn: true, readings: oauthReadings(await res.json(), Date.now()), note: '✓ Anthropic accepted the token.' };
    return keyNote(res.status, 'Anthropic');
  } catch {
    return keyNote(0, 'Anthropic');
  }
}
