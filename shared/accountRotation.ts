// Account rotation (#248, docs/accounts.md), pure: reading a dead account from a session's output (usage limits, 429s,
// expired logins, an API key's billing errors), the next account a session starts on, the switch's words, and the
// numbers Providers & accounts shows.
import { accountStatus, type StatusInput } from './accounts.ts';
import { keyTrouble } from './keyTrouble.ts';
import type { TaskAccounts } from './accountDefault.ts';
import type { AccountCli, AccountSwitch, PhoneMessage, ProviderAccount, RotationSettings, RotationStats, UsageReading } from './types.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Usage this full counts as out, before a session fails on it. */
export const NEAR_OUT_PCT = 95;
/** When a limit message says nothing about its reset. */
const LIMIT_DEFAULT_MS = HOUR;
/** A 429 or an overloaded API: worth another account for a few minutes. */
const BUSY_MS = 5 * MIN;
/** At most this many minutes saved per switch: a 5-hour window. */
const SAVED_CAP_MIN = 5 * 60;

const DEFAULT_ROTATION: RotationSettings = { on: true, apiLast: true, ceoClis: [], agentsSwitchCli: true };

/** Saved or patched rotation settings, checked. */
export function rotationSettings(base: RotationSettings | undefined, patch: unknown): RotationSettings {
  const b = { ...DEFAULT_ROTATION, ...base };
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof RotationSettings, unknown>>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const clis = Array.isArray(p.ceoClis) ? p.ceoClis.filter((c): c is AccountCli => c === 'claude' || c === 'codex') : b.ceoClis;
  return { on: bool(p.on, b.on), apiLast: bool(p.apiLast, b.apiLast), ceoClis: [...new Set(clis)], agentsSwitchCli: bool(p.agentsSwitchCli, b.agentsSwitchCli) };
}

/** Saved task accounts (#390, shared/accountDefault.ts), checked. */
export function loadTaskAccounts(raw: unknown): TaskAccounts {
  if (!raw || typeof raw !== 'object') return {};
  const out: TaskAccounts = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = v as Partial<TaskAccounts[string]> | null;
    if (r && typeof r.account === 'string') out[k] = { account: r.account, ...(r.move ? { move: true } : {}) };
  }
  return out;
}

// ---------- a dead account ----------

export type LimitHit = { kind: 'limited'; until: number } | { kind: 'signed-out' };

const USAGE_LIMIT = [
  /usage limit reached/i, // Claude Code: "Claude AI usage limit reached|1730000000", "Claude usage limit reached. Your limit will reset at 3pm"
  /\b(?:5-hour|five-hour|weekly|opus|opus weekly|weekly opus|session) limit reached/i, // Claude Code: "5-hour limit reached ∙ resets 3pm"
  // Claude Code and Codex: "You've hit your limit · resets 4pm", "You’ve hit your weekly limit · resets Nov 13, 2pm (UTC)",
  // "You've hit your Opus limit", "You've hit your usage limit. … try again in 2 hours"
  /you['’]ve hit your (?:usage |weekly |(?:weekly )?opus |session |5-hour )?limit/i,
  /usage_limit_reached/i, // Codex
  /exhausted your (?:daily )?(?:capacity|quota)/i, // Gemini CLI: "You have exhausted your capacity on this model. Your quota will reset after 10m."
  /stopped: rate limit/i, // cliRunner's StopFailure line
];
const BUSY = [/(?:API Error|status):? 429\b/i, /rate_limit_error/i, /rate limit reached/i, /429 too many requests/i, /overloaded_error/i, /API Error:? 529\b/i];
const SIGNED_OUT = [
  /not logged in/i,
  /please run \/login/i,
  /oauth token (?:has )?expired/i,
  /stopped: authentication failed/i,
  /token_expired/i,
  /refresh token was already used/i, // Codex
  /please log (?:out and sign )?in again/i,
  /not signed in/i,
  /\b401\b[^\n]*unauthori[sz]ed/i,
];

/**
 * What a failed session's output says about its account: out of usage (until when), or signed out; null: something
 * else went wrong. An API key out of credit counts as limited until tomorrow, one turned away as signed out.
 */
export function detectLimit(text: string, now: number): LimitHit | null {
  if (!text) return null;
  const trouble = keyTrouble(text);
  if (trouble === 'out-of-credit' || /stopped: billing error/i.test(text)) return { kind: 'limited', until: startOfDay(now) + DAY };
  if (USAGE_LIMIT.some((r) => r.test(text))) return { kind: 'limited', until: resetTime(text, now) ?? now + LIMIT_DEFAULT_MS };
  if (trouble === 'invalid' || SIGNED_OUT.some((r) => r.test(text))) return { kind: 'signed-out' };
  if (BUSY.some((r) => r.test(text))) return { kind: 'limited', until: resetTime(text, now) ?? now + BUSY_MS };
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A wall-clock time in an IANA time zone ("UTC", "Europe/Berlin") as epoch ms; the computer's own zone when it's unknown. */
function zoned(y: number, mo: number, d: number, h: number, mi: number, zone: string | undefined): number {
  const local = new Date(y, mo, d, h, mi).getTime();
  if (!zone) return local;
  const guess = Date.UTC(y, mo, d, h, mi);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(guess).map((x) => [x.type, Number(x.value)]));
    return guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess);
  } catch {
    return local;
  }
}

/**
 * The reset a limit message names: an epoch ("|1730000000"), "resets Nov 13, 2pm (UTC)", "resets Nov 13 at 2pm",
 * "resets 4pm", "reset at 16:30", "try again in 2 hours 5 minutes", "try again at 3:15 PM", Gemini CLI's "reset after
 * 19h14m47s", "retry in 44.09s" and "Access resets at 4:15 PM UTC" (its computer's own time).
 */
export function resetTime(text: string, now: number): number | null {
  const epoch = /limit reached\|(\d{10})\b/i.exec(text);
  if (epoch) return Number(epoch[1]) * 1000;
  const date = /resets?\s+(?:on\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,|\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)\s]{1,40})\)|\s+(UTC|GMT)\b)?/i.exec(text);
  const month = date ? MONTHS.indexOf(date[1].toLowerCase()) : -1;
  if (date && month >= 0) {
    const h = (Number(date[3]) % (date[5] ? 12 : 24)) + (date[5]?.toLowerCase() === 'pm' ? 12 : 0);
    const year = new Date(now).getFullYear();
    const zone = date[6] ?? date[7];
    const at = zoned(year, month, Number(date[2]), h, Number(date[4] ?? 0), zone);
    return at < now - DAY ? zoned(year + 1, month, Number(date[2]), h, Number(date[4] ?? 0), zone) : at; // "Jan 2" read in late December
  }
  const after = /(?:reset after|retry in)\s+((?:\d+(?:\.\d+)?(?:ms|h|m|s))+)/i.exec(text);
  if (after) {
    let ms = 0;
    for (const m of after[1].matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/gi)) ms += Number(m[1]) * ({ ms: 1, h: HOUR, m: MIN, s: 1000 } as Record<string, number>)[m[2].toLowerCase()];
    if (ms > 0) return now + Math.ceil(ms);
  }
  const rel = /try again in ((?:\s*\d+\s*(?:days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)[\s,]*(?:and)?)+)/i.exec(text);
  if (rel) {
    let ms = 0;
    for (const m of rel[1].matchAll(/(\d+)\s*(d|h|m|s)/gi)) ms += Number(m[1]) * ({ d: DAY, h: HOUR, m: MIN, s: 1000 } as Record<string, number>)[m[2].toLowerCase()];
    if (ms > 0) return now + ms;
  }
  const at = /(?:resets?|try again)(?: at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (!at || (!at[2] && !at[3])) return null; // a bare number isn't a time
  let h = Number(at[1]) % (at[3] ? 12 : 24);
  if (at[3]?.toLowerCase() === 'pm') h += 12;
  const d = new Date(now);
  d.setHours(h, Number(at[2] ?? 0), 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** The latest reset of a usage reading at NEAR_OUT_PCT or more: rotation leaves such an account alone until then. */
function nearOut(usage: readonly UsageReading[], now: number): number | null {
  const full = usage.filter((r) => r.pct >= NEAR_OUT_PCT && r.resetsAt && r.resetsAt > now).map((r) => r.resetsAt!);
  return full.length ? Math.max(...full) : null;
}

// ---------- the next account ----------

/** An account with what rotation needs to know about it now. */
export type Candidate = Omit<StatusInput, 'now'>;

export interface PickOptions {
  cli: AccountCli;
  apiLast: boolean;
  skip?: readonly string[]; // tried already this session
  sticky?: string; // the account the session's task started on (#390): next after the pinned one, while it's usable
}

const isApi = (a: ProviderAccount) => a.kind === 'api-key';

/**
 * The account a session starts on: the binding first (the pinned account, which runs even while paused), then its
 * task's account (`sticky`), then the pinned tag's, then the rest by priority, API keys after subscriptions when `apiLast`. Accounts that are paused,
 * limited, signed out, over their daily cap or at NEAR_OUT_PCT of a limit are skipped; near-out ones are taken only
 * when nothing else is left. null: none is usable (the caller runs as before rotation).
 */
export function pickAccount(binding: string | undefined, candidates: readonly Candidate[], now: number, o: PickOptions): ProviderAccount | null {
  const mine = candidates.filter((c) => c.account.cli === o.cli && !c.account.removing && !o.skip?.includes(c.account.id));
  const rank = (c: Candidate) => (o.apiLast && isApi(c.account) ? 1 : 0);
  const sorted = [...mine].sort((x, y) => rank(x) - rank(y) || x.account.priority - y.account.priority);
  const b = (binding ?? '').trim().toLowerCase();
  const pinned = b ? sorted.find((c) => c.account.id === b) : undefined;
  const sticky = o.sticky ? sorted.find((c) => c.account.id === o.sticky) : undefined;
  const order = [...new Set([...(pinned ? [pinned] : []), ...(sticky ? [sticky] : []), ...(b ? sorted.filter((c) => c.account.tags.includes(b)) : []), ...sorted])];
  const free = (c: Candidate) => {
    const { status } = accountStatus({ ...c, account: c === pinned ? { ...c.account, enabled: true } : c.account, now });
    return status === 'ready' || status === 'near';
  };
  return (order.find((c) => free(c) && !nearOut(c.usage, now)) ?? order.find(free))?.account ?? null;
}

// ---------- words ----------

/** "Main Max is limited until 16:00" / "Main Max is signed out". */
const outLine = (label: string, why: AccountSwitch['why'], until: number | null, clock: (t: number) => string) => (why === 'signed-out' ? `${label} is signed out` : `${label} is limited${until ? ` until ${clock(until)}` : ''}`);

const CARRIED: Record<NonNullable<AccountSwitch['carried']>, string> = {
  conversation: ' Memory and conversation carried over.',
  handover: ' Picked up from a handover: the latest messages, the notes and memory.',
};

/** The chat pill: "Switched to Backup Max: Main Max is limited until 16:00. Memory and conversation carried over." */
export const switchText = (s: Pick<AccountSwitch, 'from' | 'to' | 'why' | 'until' | 'carried'>, clock: (t: number) => string) => `🔀 Switched to ${s.to}: ${outLine(s.from, s.why, s.until, clock)}.${s.carried ? CARRIED[s.carried] : ''}`;

const HANDOVER_MESSAGES = 6;
const HANDOVER_CHARS = 400;

/**
 * What a fresh CEO session starts with when its conversation couldn't come along (another coding agent): the chat's
 * latest messages, clipped, and where its notes are. No model call.
 */
export function switchHandover(messages: readonly Pick<PhoneMessage, 'from' | 'text'>[], notesFile: string): string {
  const who = { ceo: 'You', manager: 'Manager', office: 'Office' } as const;
  const lines = messages
    .filter((m) => m.text.trim())
    .slice(-HANDOVER_MESSAGES)
    .map((m) => `${who[m.from]}: ${m.text.length > HANDOVER_CHARS ? `${m.text.slice(0, HANDOVER_CHARS)}…` : m.text}`);
  return `Your previous session hit an account limit and its conversation couldn't come along, so this is a fresh session. Your notes are in ${notesFile}. The chat's latest messages:\n${lines.join('\n') || '(none)'}`;
}

/** The one message when every account is out: when the first is back, and the API key the manager can turn on. */
export function allOutText(cliName: string, first: number | null, clock: (t: number) => string, key: string | null): string {
  const back = first ? `The first one is back at ${clock(first)}; new work waits until then.` : 'New work waits until one is signed in again.';
  return `⏸ Every ${cliName} account is out. ${back}${key ? ` Or tap Use API key to carry on now on ${key}, billed per token.` : ''}`;
}

/** What the CEO's next job hears about agents' switches. */
export const switchesForCeo = (list: readonly AccountSwitch[], clock: (t: number) => string) => list.map((s) => `${s.agentName}'s session moved from ${s.from} to ${s.to} (${outLine(s.from, s.why, s.until, clock).replace(`${s.from} `, '')}).`);

// ---------- numbers ----------

const startOfDay = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Switches today, the minutes they saved (each would have waited for its reset, up to 5 hours) and the API spend they caused. */
export function rotationStats(switches: readonly AccountSwitch[], now: number): RotationStats {
  const today = switches.filter((s) => s.at >= startOfDay(now));
  const saved = today.reduce((n, s) => n + (s.until ? Math.min(SAVED_CAP_MIN, Math.max(0, Math.round((s.until - s.at) / MIN))) : 0), 0);
  const apiUsd = today.reduce((n, s) => n + (s.api ? s.usd : 0), 0);
  return { switchesToday: today.length, minutesSaved: saved, apiUsd: Math.round(apiUsd * 100) / 100, recent: [...switches].sort((a, b) => b.at - a.at).slice(0, 5) };
}

/** An account's limited spans kept: the last 7 days, the new one merged into one it overlaps. */
export function addSpan(spans: readonly [number, number][] | undefined, from: number, until: number, now: number): [number, number][] {
  const kept = (spans ?? []).filter(([, to]) => now - to <= 7 * DAY);
  const last = kept.at(-1);
  if (last && from <= last[1]) return [...kept.slice(0, -1), [last[0], Math.max(last[1], until)]];
  return [...kept, [from, until]];
}

/** The spans within the last `windowMs`, as fractions of it (0 = its start, 1 = now), for the timeline bar. */
export function spanBars(spans: readonly [number, number][] | undefined, now: number, windowMs = DAY): { left: number; width: number }[] {
  const from = now - windowMs;
  return (spans ?? [])
    .filter(([, to]) => to > from)
    .map(([a, b]) => {
      const l = Math.max(a, from);
      const r = Math.min(b, now);
      return { left: (l - from) / windowMs, width: Math.max(0.005, (r - l) / windowMs) };
    })
    .filter((s) => s.left < 1);
}
