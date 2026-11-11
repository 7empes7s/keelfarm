// Providers & accounts (#247): the real Test of an account. A login: is there one in its folder, and (Claude) its
// usage, read as usagePoll.ts does. A key: one free request (the provider's model list). The key goes in that request's
// header and nowhere else, and errors never carry the request.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkUsage, loginPlan, oauthReadings, type UsageCheck } from './usagePoll.ts';
import { readCodexLimits } from './codexLimits.ts';
import { codexReadings } from '../shared/usageSources.ts';
import type { AccountCli, AccountKind, UsageReading } from '../shared/types.ts';

export interface AccountCheck {
  signedIn: boolean; // a login on file, or a key the provider accepts
  readings: UsageReading[];
  note: string; // one line for the manager
  refresh?: boolean; // a Claude login whose access token expired: its next session refreshes it (#442)
  plan?: string | null; // the plan a Claude login really has, from its .credentials.json ("Max 20x")
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

/**
 * A Claude login's Test from its usage check (pure). An expired access token with a refresh token on file is signed in:
 * the office never refreshes it (a running session may rotate the refresh token), its next session does (#442).
 */
export function claudeLoginCheck(res: UsageCheck): AccountCheck {
  if ('readings' in res) return { signedIn: true, readings: res.readings, note: '✓ Signed in; usage read.' };
  if (res.error === 'failed') return { signedIn: true, readings: [], note: "Signed in, but its usage couldn't be read just now." };
  if (res.error === 'expired' && res.refresh) return { signedIn: true, readings: [], refresh: true, note: '✓ Signed in; its token refreshes on its next session.' };
  return { signedIn: false, readings: [], note: res.error === 'expired' ? 'Its sign-in expired: tap Sign in again.' : 'Not signed in yet: tap Sign in.' };
}

/** Test an account: `dir` is its login folder, `secret` its key or token ('' for a login). Never throws. */
export async function checkAccount(a: CheckTarget, dir: string, secret: string): Promise<AccountCheck> {
  if (a.kind === 'subscription-login') {
    if (a.cli === 'codex') {
      const ok = !!(await fs.stat(path.join(dir, 'auth.json')).catch(() => null));
      if (!ok) return { signedIn: false, readings: [], note: 'Not signed in yet: tap Sign in.' };
      const readings = codexReadings(await readCodexLimits(dir), Date.now());
      return { signedIn: true, readings, note: readings.length ? '✓ Signed in; usage read.' : '✓ Signed in.' };
    }
    if (a.cli === 'gemini') {
      // Its Google sign-in, in <GEMINI_CLI_HOME>/.gemini. Gemini CLI writes its quota nowhere: limits come from its sessions.
      const ok = !!(await fs.stat(path.join(dir, '.gemini', 'oauth_creds.json')).catch(() => null));
      return ok ? { signedIn: true, readings: [], note: '✓ Signed in.' } : { signedIn: false, readings: [], note: 'Not signed in yet: tap Sign in.' };
    }
    const raw = await fs.readFile(path.join(dir, '.credentials.json'), 'utf8').catch(() => '');
    return { ...claudeLoginCheck(await checkUsage({ CLAUDE_CONFIG_DIR: dir })), plan: raw ? loginPlan(raw) : null };
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
