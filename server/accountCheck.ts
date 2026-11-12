// Providers & accounts (#247): the real Test of an account. A login: is there one in its folder, and (Claude) its
// usage, read as usagePoll.ts does. A key: one free request (the provider's model list). The key goes in that request's
// header and nowhere else, and errors never carry the request.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkUsage, loginOwner, loginPlan, oauthReadings, tokenOf, type UsageCheck } from './usagePoll.ts';
import { readCodexLimits } from './codexLimits.ts';
import { codexReadings } from '../shared/usageSources.ts';
import type { AccountCli, AccountKind, UsageReading } from '../shared/types.ts';

export interface AccountCheck {
  signedIn: boolean; // a login on file, or a key the provider accepts
  readings: UsageReading[];
  note: string; // one line for the manager
  refresh?: boolean; // a Claude login whose access token expired: its next session refreshes it (#442)
  plan?: string | null; // the plan a Claude login really has, from its .credentials.json ("Max 20x")
  who?: string | null; // its owner (account id or email), only to spot logins on one subscription; never sent to tabs (#460)
  noFiveHour?: boolean; // Anthropic says this login has no 5-hour window (a verified Ultra plan)
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
  if ('readings' in res) return { signedIn: true, readings: res.readings, ...(res.noFiveHour && { noFiveHour: true }), note: '✓ Signed in; usage read.' };
  if (res.error === 'failed') return { signedIn: true, readings: [], note: "Signed in, but its usage couldn't be read just now." };
  if (res.error === 'expired' && res.refresh) return { signedIn: true, readings: [], refresh: true, note: '✓ Signed in; its token refreshes on its next session.' };
  return { signedIn: false, readings: [], note: res.error === 'expired' ? 'Its sign-in expired: tap Sign in again.' : 'Not signed in yet: tap Sign in.' };
}

/**
 * A Claude login's plan and owner without a request (#460): the plan from its .credentials.json, the owner from the
 * .claude.json in its folder (or ~/.claude.json beside the default ~/.claude). Never a token. Never throws.
 */
export async function readClaudeLogin(dir: string): Promise<{ plan: string | null; who: string | null }> {
  const read = (file: string) => fs.readFile(file, 'utf8').catch(() => '');
  const raw = await read(path.join(dir, '.credentials.json'));
  const cfg = (await read(path.join(dir, '.claude.json'))) || (await read(path.join(path.dirname(dir), `${path.basename(dir)}.json`)));
  return { plan: raw ? loginPlan(raw) : null, who: cfg ? loginOwner(cfg) : null };
}

/** A Claude login's .credentials.json as the office reads it without a request (#579): its token's state and when it last changed. */
export interface LoginFile {
  state: 'in' | 'out' | 'refresh'; // a token; none, or expired with no refresh token; expired with one, for the next session
  changedAt: number;
}

/** The login file's state from its text (pure). */
export function loginFileState(raw: string, now: number): LoginFile['state'] {
  const t = tokenOf(raw, now);
  return 'token' in t ? 'in' : t.refresh ? 'refresh' : 'out';
}

/** The built-in login's .credentials.json, read and stat'ed (no request); null when there's none (a keychain, a token in the environment). Never throws. */
export async function readLoginFile(dir: string, now = Date.now()): Promise<LoginFile | null> {
  const file = path.join(dir, '.credentials.json');
  const [raw, st] = await Promise.all([fs.readFile(file, 'utf8').catch(() => null), fs.stat(file).catch(() => null)]);
  return raw === null || !st ? null : { state: loginFileState(raw, now), changedAt: st.mtimeMs };
}

/**
 * Whether the built-in Claude login is signed in, from its file (#579, pure): not when there's no token or it expired
 * with nothing to refresh it, nor when a session found it signed out (`outAt`) and the file hasn't changed since (a
 * sign-in or a refresh rewrites it). null: no file to judge by, so it stays as it was.
 */
export function loginSignedIn(file: LoginFile | null, outAt: number | null): boolean | null {
  if (!file) return null;
  if (file.state === 'out') return false;
  return outAt === null || file.changedAt > outAt;
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
    return { ...claudeLoginCheck(await checkUsage({ CLAUDE_CONFIG_DIR: dir })), ...(await readClaudeLogin(dir)) };
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
