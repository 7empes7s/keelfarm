// Claude's usage while the office is idle (#89): sessions report readings as they run, so when none has for a while
// the office reads the subscription's usage itself, from the endpoint Claude Code's own /usage screen calls
// (GET /api/oauth/usage with the login's OAuth token). No model tokens; the token is read, sent there and nowhere else,
// and the credentials file is never refreshed or written (the agents' next session refreshes an expired login).
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readingOf } from '../shared/usage.ts';
import type { UsageCheckError, UsageReading } from '../shared/types.ts';

export type UsageCheck = { readings: UsageReading[] } | { error: UsageCheckError };

// ---------- when to check (pure) ----------

/** Check only once no session has given a reading for this long: while sessions report, they are the meter. */
export const IDLE_MS = 10 * 60_000;
/** At most one check this often. */
export const POLL_MS = 12 * 60_000;
/** Failed checks back off, doubling up to this. */
export const MAX_BACKOFF_MS = 2 * 60 * 60_000;

export interface PollState {
  lastTry: number; // when the office last checked (0: never)
  failures: number; // failed checks in a row
}

/** How long after the last check the next may run: POLL_MS, doubling with each failure in a row, at most MAX_BACKOFF_MS. */
export const pollWait = (failures: number) => Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.max(0, failures));

/** Is a check due? Never while a session gave a reading in the last IDLE_MS; else once the wait since the last try is up. */
export function pollDue(newestReading: number, s: PollState, now: number): boolean {
  if (now - newestReading < IDLE_MS) return false;
  return now - s.lastTry >= pollWait(s.failures);
}

/** The state after a check. */
export const afterPoll = (s: PollState, ok: boolean, now: number): PollState => ({ lastTry: now, failures: ok ? 0 : s.failures + 1 });

// ---------- the endpoint's answer (pure) ----------

/** The endpoint's limits ({ five_hour: { utilization: 42, resets_at: "2026-…Z" }, … }) as readings. */
export function oauthReadings(body: unknown, now: number): UsageReading[] {
  if (!body || typeof body !== 'object') return [];
  return Object.entries(body as Record<string, unknown>).flatMap(([type, l]) => {
    if (!l || typeof l !== 'object') return [];
    const { utilization, resets_at } = l as { utilization?: unknown; resets_at?: unknown };
    const resetsAt = typeof resets_at === 'string' ? Date.parse(resets_at) : resets_at;
    return readingOf({ type, percent: utilization, resetsAt }, now) ?? [];
  });
}

/** The login's access token from .credentials.json, unless it's missing or expired. */
export function tokenOf(raw: string, now: number): { token: string } | { error: UsageCheckError } {
  let oauth: { accessToken?: unknown; expiresAt?: unknown } | undefined;
  try {
    oauth = (JSON.parse(raw) as { claudeAiOauth?: typeof oauth }).claudeAiOauth;
  } catch {
    return { error: 'no-login' };
  }
  if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) return { error: 'no-login' };
  const exp = Number(oauth.expiresAt);
  if (Number.isFinite(exp) && exp > 0 && exp <= now) return { error: 'expired' };
  return { token: oauth.accessToken };
}

// ---------- the real check ----------

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

/** Read the subscription's usage with the agents' Claude login (CLAUDE_CONFIG_DIR, else ~/.claude). Never throws. */
export async function checkUsage(env: NodeJS.ProcessEnv = process.env): Promise<UsageCheck> {
  const dir = env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');
  const raw = await fs.readFile(path.join(dir, '.credentials.json'), 'utf8').catch(() => null);
  if (raw === null) return { error: 'no-login' };
  const cred = tokenOf(raw, Date.now());
  if ('error' in cred) return cred;
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${cred.token}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return { error: 'expired' };
    if (!res.ok) return { error: 'failed' };
    const readings = oauthReadings(await res.json(), Date.now());
    return readings.length ? { readings } : { error: 'failed' };
  } catch {
    return { error: 'failed' }; // never the error itself: it could carry the request
  }
}
