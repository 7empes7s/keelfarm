// Providers & accounts (#247): the real Test of an account. A login: is there one in its folder, and (Claude) its
// usage, read as usagePoll.ts does. A key: one free request (the provider's model list). The key goes in that request's
// header and nowhere else, and errors never carry the request.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkUsage, loginOwner, loginPlan, oauthReadings, tokenOf, type UsageCheck } from './usagePoll.ts';
import { readCodexLimits } from './codexLimits.ts';
import { codexReadings } from '../shared/usageSources.ts';
import { codexAuthFile, geminiAuthFile, keyProbe, type AuthProbe } from '../shared/accountAuth.ts';
import type { AccountCli, AccountKind, UsageReading } from '../shared/types.ts';

export interface AccountCheck {
  signedIn: boolean; // a login on file, or a key the provider accepts
  /** What the check found for its sign-in (#637, shared/accountAuth.ts); absent: read from signedIn and refresh. */
  auth?: AuthProbe;
  /** When its login file (.credentials.json, auth.json, oauth_creds.json) was last written: a rewrite after a sign-in failure is a fresh login. */
  fileAt?: number;
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

/** What a check found for its sign-in: its own word, else read from signedIn and refresh (the demo's checks). */
export const probeOf = (r: AccountCheck): AuthProbe => r.auth ?? (!r.signedIn ? 'out' : r.refresh ? 'refresh' : 'ok');

/** A key's check from its HTTP status (pure): a network failure, 429 or 5xx is no news, never a turned-away key. */
export const keyNote = (status: number, who: string): AccountCheck => {
  const auth = keyProbe(status);
  return auth === 'ok'
    ? { signedIn: true, auth, readings: [], note: `✓ ${who} accepted the key.` }
    : auth === 'out'
      ? { signedIn: false, auth, readings: [], note: `${who} turned the key away (${status}): paste a new one.` }
      : { signedIn: true, auth, readings: [], note: `Couldn't reach ${who}${status ? ` (${status})` : ''}: try again in a minute.` };
};

/**
 * A setup token's check on the usage endpoint (pure): 401 turned it away; 403 is the endpoint, not the token (a setup
 * token's inference-only scope may not read usage), so it isn't Signed out; the rest no news.
 */
export const setupTokenNote = (status: number): AccountCheck => (status === 403 ? { signedIn: true, auth: 'ok', readings: [], note: '✓ Anthropic knows the token; its usage isn\'t readable with it.' } : keyNote(status, 'Anthropic'));

/**
 * A Claude login's Test from its usage check (pure). An expired access token with a refresh token on file is signed in:
 * the office never refreshes it (a running session may rotate the refresh token), its next session does (#442).
 */
export function claudeLoginCheck(res: UsageCheck): AccountCheck {
  if ('readings' in res) return { signedIn: true, auth: 'ok', readings: res.readings, ...(res.noFiveHour && { noFiveHour: true }), note: '✓ Signed in; usage read.' };
  // Network, 429, 5xx or an unreadable answer: no news about its sign-in (#637), never Signed out nor a made-up Ready.
  if (res.error === 'failed') return { signedIn: true, auth: 'error', readings: [], note: "Couldn't read its usage just now: its sign-in is shown as last known." };
  if (res.error === 'expired' && res.refresh) return { signedIn: true, auth: 'refresh', readings: [], refresh: true, note: '✓ Signed in; its token refreshes on its next session.' };
  return { signedIn: false, auth: 'out', readings: [], note: res.error === 'expired' ? 'Its sign-in expired: tap Sign in again.' : 'Not signed in yet: tap Sign in.' };
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

/** Each CLI's login file in its folder: where its sign-in and its refreshes write. */
const LOGIN_FILE: Record<AccountCli, string[]> = { claude: ['.credentials.json'], codex: ['auth.json'], gemini: ['.gemini', 'oauth_creds.json'] };

/** Test an account: `dir` is its login folder, `secret` its key or token ('' for a login). Never throws. */
export async function checkAccount(a: CheckTarget, dir: string, secret: string): Promise<AccountCheck> {
  if (a.kind !== 'subscription-login') return checkKey(a, secret);
  const st = await fs.stat(path.join(dir, ...LOGIN_FILE[a.cli])).catch(() => null);
  const r = await checkLogin(a, dir);
  return st && r.auth !== 'out' ? { ...r, fileAt: st.mtimeMs } : r;
}

async function checkLogin(a: CheckTarget, dir: string): Promise<AccountCheck> {
  {
    const read = (...p: string[]) => fs.readFile(path.join(dir, ...p), 'utf8').catch(() => null);
    if (a.cli === 'codex') {
      // Its auth.json read, not just found (#637): an API key, or ChatGPT tokens Codex refreshes itself.
      const auth = codexAuthFile(await read('auth.json'), Date.now());
      if (auth === 'out') return { signedIn: false, auth, readings: [], note: 'Not signed in: tap Sign in.' };
      const readings = codexReadings(await readCodexLimits(dir), Date.now());
      return { signedIn: true, auth, readings, ...(auth === 'refresh' && { refresh: true }), note: auth === 'refresh' ? '✓ Signed in; its token refreshes on its next session.' : readings.length ? '✓ Signed in; usage read.' : '✓ Signed in.' };
    }
    if (a.cli === 'gemini') {
      // Its Google sign-in, where Gemini CLI keeps it: <GEMINI_CLI_HOME>/.gemini/oauth_creds.json, or its encrypted
      // gemini-credentials.json under GEMINI_FORCE_ENCRYPTED_FILE_STORAGE (unreadable here, so its sessions decide).
      // Gemini CLI writes its quota nowhere: limits come from its sessions.
      const creds = await read('.gemini', 'oauth_creds.json');
      const auth = creds === null && (await read('.gemini', 'gemini-credentials.json')) ? 'ok' : geminiAuthFile(creds, Date.now());
      if (auth === 'out') return { signedIn: false, auth, readings: [], note: 'Not signed in: tap Sign in.' };
      return { signedIn: true, auth, readings: [], ...(auth === 'refresh' && { refresh: true }), note: auth === 'refresh' ? '✓ Signed in; its token refreshes on its next session.' : '✓ Signed in.' };
    }
    return { ...claudeLoginCheck(await checkUsage({ CLAUDE_CONFIG_DIR: dir })), ...(await readClaudeLogin(dir)) };
  }
}

async function checkKey(a: CheckTarget, secret: string): Promise<AccountCheck> {
  if (!secret) return { signedIn: false, auth: 'out', readings: [], note: 'No key saved yet.' };
  if (a.cli === 'codex') return keyNote(await get('https://api.openai.com/v1/models', { Authorization: `Bearer ${secret}` }), 'OpenAI');
  if (a.kind === 'api-key') return keyNote(await get('https://api.anthropic.com/v1/models?limit=1', { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }), 'Anthropic');
  // A setup token reads its subscription's usage like a login does.
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${secret}`, 'anthropic-beta': 'oauth-2025-04-20' }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) return { signedIn: true, auth: 'ok', readings: oauthReadings(await res.json(), Date.now()), note: '✓ Anthropic accepted the token.' };
    return setupTokenNote(res.status);
  } catch {
    return keyNote(0, 'Anthropic');
  }
}
