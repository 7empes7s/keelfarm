// One account's sign-in state (#637), pure: every piece of evidence (a probe of its login or key, a session that ran
// or ended on a sign-in, the built-in login's file, a sign-in) folded into one record, which the card, company_status,
// launch eligibility and rotation all read through accountStatus. Rules: newer evidence wins and a stale async probe
// never overwrites it; a probe that couldn't reach the provider keeps what was known (never Signed out, never a
// made-up Ready); a session's sign-in failure on a login that can still refresh is retried a bounded number of times
// before it reads Signed out; a fresh sign-in or a session that ran clears it all.

/** What one probe of an account found. `error`: the provider couldn't be asked (network, 429, 5xx): no news. */
export type AuthProbe = 'ok' | 'refresh' | 'out' | 'error';

/** Where a piece of evidence came from. */
type AuthSource = 'probe' | 'session' | 'signin' | 'file';

export interface AuthEvidence {
  kind: AuthProbe;
  from: AuthSource;
  /** A session's: its CLI showed its own sign-in screen, so its folder has no login it can use: out at once, no retry. */
  hard?: boolean;
  /** When the evidence was gathered: a probe's start, a session's end, a login file's last write. Older than the record's: ignored. */
  at: number;
}

/**
 * - ready: a token the provider accepted, or a session ran on it.
 * - refresh: its access token expired with a refresh token on file; its CLI refreshes it at its next session.
 * - checking: a session ended on a sign-in; a probe is deciding whether that's real (not used meanwhile).
 * - signed-out: no login, a token turned away with nothing to refresh it, or sessions failed to sign in SESSION_TRIES times.
 * - unknown: nothing known yet (never probed, or only probes that couldn't reach the provider).
 */
type AuthState = 'ready' | 'refresh' | 'checking' | 'signed-out' | 'unknown';

export interface AuthRecord {
  state: AuthState;
  /** The newest evidence's time. */
  at: number;
  /** Sessions in a row that ended on a sign-in since the last one that ran (or a sign-in). */
  fails: number;
  /** The last probe couldn't reach the provider: what's shown may be out of date. */
  stale?: boolean;
}

/** Sessions in a row ending on a sign-in that a refreshable login is given before it reads Signed out: bounded, never endless. */
export const SESSION_TRIES = 2;

const UNKNOWN: AuthRecord = { state: 'unknown', at: 0, fails: 0 };

/** The record after one piece of evidence. */
export function authAfter(prev: AuthRecord | undefined, ev: AuthEvidence): AuthRecord {
  const p = prev ?? UNKNOWN;
  if (ev.at < p.at) return p; // a probe that started before newer evidence came in: stale
  // A session that ran or a new sign-in: whatever was said before is obsolete.
  if (ev.from === 'signin' || (ev.from === 'session' && ev.kind === 'ok')) return ev.kind === 'out' ? { state: 'signed-out', at: ev.at, fails: 0 } : { state: 'ready', at: ev.at, fails: 0 };
  if (ev.from === 'session') {
    // A session ended on a sign-in: not believed until a probe has looked, unless it's happened SESSION_TRIES times.
    const fails = ev.hard ? Math.max(p.fails + 1, SESSION_TRIES) : p.fails + 1;
    return { state: fails >= SESSION_TRIES ? 'signed-out' : 'checking', at: ev.at, fails };
  }
  if (ev.kind === 'error') return { ...p, state: p.state === 'checking' ? 'unknown' : p.state, at: Math.max(p.at, ev.at), stale: true };
  if (ev.kind === 'out') return { state: 'signed-out', at: ev.at, fails: p.fails };
  // The login file rewritten with a token after everything else known: a sign-in or its CLI's refresh, so fresh.
  if (ev.from === 'file') return { state: ev.kind === 'ok' ? 'ready' : 'refresh', at: ev.at, fails: 0 };
  // A probe (or the login file) found a token: sessions that kept failing to sign in with it still win.
  if (p.fails >= SESSION_TRIES) return { ...p, at: ev.at, stale: false };
  return { state: ev.kind === 'ok' ? 'ready' : 'refresh', at: ev.at, fails: p.fails };
}

/**
 * Whether a session may start on it: anything but checking or signed out. Never probed: `fallback` (a built-in login or
 * a saved key yes, another login not yet). A probe that couldn't reach the provider found a credential to send, so yes.
 */
export const authUsable = (r: AuthRecord | undefined, fallback: boolean) => (!r || (r.state === 'unknown' && !r.stale) ? fallback : r.state !== 'checking' && r.state !== 'signed-out');

/** One line for its card, when there's something to say. */
export function authNote(r: AuthRecord | undefined): string | null {
  if (!r) return null;
  if (r.state === 'checking') return 'A session found it signed out: checking its sign-in now.';
  if (r.state === 'signed-out' && r.fails >= SESSION_TRIES) return `Its last ${r.fails} sessions couldn't sign in: tap Sign in again.`;
  if (r.state === 'refresh') return 'Its token refreshes on its next session.';
  if (r.stale) return "Couldn't reach the provider just now: shown as last known.";
  return null;
}

// ---------- the CLIs' own login files, read without a request ----------

const parse = (raw: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const str = (v: unknown) => typeof v === 'string' && v.length > 0;

/** A JWT's exp in ms, or null. Only the payload's exp is read; the token itself goes nowhere. */
export function jwtExp(token: unknown): number | null {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const exp = (parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) ?? {}).exp;
    return typeof exp === 'number' && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Codex's auth.json (CODEX_HOME): an API key, or ChatGPT tokens. Expired access token with a refresh token: refresh
 * (Codex refreshes it itself). Missing, empty or malformed: out.
 */
export function codexAuthFile(raw: string | null, now: number): AuthProbe {
  const j = raw === null ? null : parse(raw);
  if (!j) return 'out';
  if (str(j.OPENAI_API_KEY)) return 'ok';
  const t = (j.tokens && typeof j.tokens === 'object' ? j.tokens : {}) as Record<string, unknown>;
  const refresh = str(t.refresh_token);
  if (!str(t.access_token)) return refresh ? 'refresh' : 'out';
  const exp = jwtExp(t.access_token);
  return exp !== null && exp <= now ? (refresh ? 'refresh' : 'out') : 'ok';
}

/** Gemini CLI's oauth_creds.json (<GEMINI_CLI_HOME>/.gemini): a refresh token keeps it signed in; malformed or without tokens: out. */
export function geminiAuthFile(raw: string | null, now: number): AuthProbe {
  const j = raw === null ? null : parse(raw);
  if (!j) return 'out';
  const refresh = str(j.refresh_token);
  if (!str(j.access_token)) return refresh ? 'refresh' : 'out';
  const exp = typeof j.expiry_date === 'number' ? j.expiry_date : null;
  return exp !== null && exp <= now ? (refresh ? 'refresh' : 'out') : 'ok';
}

/** What an HTTP status from a key's or token's check means: 401 turned away; 403 too for a key's model list; the rest no news. */
export const keyProbe = (status: number): AuthProbe => (status >= 200 && status < 300 ? 'ok' : status === 401 || status === 403 ? 'out' : 'error');
