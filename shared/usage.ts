// How Claude's usage reads, on the server (phone messages, the CEO's company status) and in the office (the usage
// meter, the HUD's pacing chip): clock times and the names of Claude's limits.

import type { UsageCheckError, UsageReading, UsageWarningChoice } from './types.ts';

/** "14:30", with the weekday when it isn't today. */
export function clock(at: number, now: number): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date(now).toDateString() ? hm : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${hm}`;
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'weekly limit',
  seven_day_opus: 'weekly Opus limit',
  seven_day_sonnet: 'weekly Sonnet limit',
};

/** A rate limit type as Claude reports it ("five_hour"), as people say it ("5-hour limit"). */
export const limitName = (type: string) => LIMIT_NAMES[type] ?? type.replace(/_/g, ' ');

/** How full a limit is, 0-100: Claude reports a fraction (0.82) or a percentage (82). */
export const usedPercent = (utilization: number) => Math.round(utilization <= 1 ? utilization * 100 : utilization);

// ---------- the latest readings (#11) ----------

/** The usage meter's order: the 5-hour window, the week, then the per-model weekly limits. */
const ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];

const BAR_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly', seven_day_opus: 'Weekly Opus', seven_day_sonnet: 'Weekly Sonnet' };
const SHORT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: 'week', seven_day_opus: 'week Opus', seven_day_sonnet: 'week Sonnet' };

/** A limit's name on the meter's bar: "5-hour", "Weekly", "Weekly Opus". */
export const barName = (type: string) => BAR_NAMES[type] ?? type.replace(/_/g, ' ');

// Limit types come from hooks' JSON: kept short and plain (they reach the CEO's prompt), and only a few of them.
const LIMIT_TYPE = /^[a-z0-9_]{1,32}$/;
const MAX_READINGS = 8;

/** A reading is "as of" a while ago once no session has reported for this long. */
export const STALE_MS = 5 * 60_000;

/**
 * One limit as Claude reports it, as a reading: `percent` from a status line's used_percentage (42 = 42%), or
 * `fraction` from the SDK's utilization (0.42); resetsAt in epoch seconds or ms. Null when there's no usable number.
 */
export function readingOf(raw: { type: string; percent?: unknown; fraction?: unknown; resetsAt?: unknown }, at: number): UsageReading | null {
  const pct = raw.percent !== undefined && raw.percent !== null ? Number(raw.percent) : raw.fraction !== undefined && raw.fraction !== null ? Number(raw.fraction) * 100 : NaN;
  if (!LIMIT_TYPE.test(raw.type) || !Number.isFinite(pct)) return null;
  const r = Number(raw.resetsAt);
  const resetsAt = Number.isFinite(r) && r > 0 ? (r < 1e12 ? r * 1000 : r) : null;
  return { type: raw.type, pct: Math.max(0, Math.min(100, Math.round(pct))), resetsAt, at };
}

const rank = (type: string) => (ORDER.includes(type) ? ORDER.indexOf(type) : ORDER.length);

/** The latest reading per limit with `next` folded in: the newest reading of each type wins; in the meter's order, at most 8. */
export function mergeReadings(prev: readonly UsageReading[], next: readonly UsageReading[]): UsageReading[] {
  const byType = new Map(prev.map((r) => [r.type, r]));
  for (const r of next) {
    if (!LIMIT_TYPE.test(r.type)) continue;
    const old = byType.get(r.type);
    if (!old || r.at >= old.at) byType.set(r.type, r);
  }
  return [...byType.values()].sort((a, b) => rank(a.type) - rank(b.type) || a.type.localeCompare(b.type)).slice(0, MAX_READINGS);
}

/** Whether `next` is worth sending to the office: a limit's number or reset changed, or one wasn't shown for a minute. */
export function readingsChanged(shown: readonly UsageReading[], next: readonly UsageReading[]): boolean {
  if (shown.length !== next.length) return true;
  return next.some((r) => {
    const s = shown.find((x) => x.type === r.type);
    return !s || s.pct !== r.pct || s.resetsAt !== r.resetsAt || r.at - s.at >= 60_000;
  });
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ago(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} day${h < 48 ? '' : 's'} ago`;
}

/** Why the office's idle check couldn't read the usage, in plain words. */
function checkNote(error: UsageCheckError): string {
  if (error === 'no-login') return 'office idle, no Claude login to check with';
  if (error === 'expired') return "office idle, Claude's login needs a session to refresh";
  return "office idle, couldn't check";
}

/**
 * Under the meter: why there's nothing to show, "as of 12 min ago" when no reading is recent, else null; with why
 * the office's own check failed when it did ("as of 9 h ago · office idle, couldn't check").
 */
export function readingsNote(readings: readonly UsageReading[], now: number, check: UsageCheckError | null = null): string | null {
  if (!readings.length) return check ? `No reading yet: ${checkNote(check)}` : 'No reading yet: it updates while an agent is working';
  const newest = Math.max(...readings.map((r) => r.at));
  if (now - newest < STALE_MS) return null;
  return check ? `as of ${ago(newest, now)} · ${checkNote(check)}` : `as of ${ago(newest, now)}`;
}

/** One bar on the usage meter: "5-hour", 42%, its tone, and "resets 18:30" (or "reset 18:30" once it has). */
export interface UsageBar {
  type: string;
  name: string;
  pct: number;
  tone: 'good' | 'warn' | 'bad';
  resets: string | null;
}

/** How full is too full on the meter: amber from 75%, red from 90%. */
export const pctTone = (pct: number): UsageBar['tone'] => (pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'good');

/** The usage meter's bars, one per limit. */
export function usageBars(readings: readonly UsageReading[], now: number): UsageBar[] {
  return readings.map((r) => ({
    type: r.type,
    name: barName(r.type),
    pct: r.pct,
    tone: pctTone(r.pct),
    resets: r.resetsAt === null ? null : `${r.resetsAt > now ? 'resets' : 'reset'} ${clock(r.resetsAt, now)}`,
  }));
}

/** The latest numbers for the CEO's company status: "5h 42% · week 61%", with "(as of 12 min ago)" when old; "no reading yet" without any. */
export function readingsLabel(readings: readonly UsageReading[], now: number, check: UsageCheckError | null = null): string {
  if (!readings.length) return 'no reading yet';
  const nums = readings.map((r) => `${SHORT_NAMES[r.type] ?? r.type.replace(/_/g, ' ')} ${r.pct}%`).join(' · ');
  const note = readingsNote(readings, now, check);
  return note ? `${nums} (${note})` : nums;
}

// ---------- when Claude warns that usage is high (#323) ----------

/** Settings → Agents' choices, in the order shown. */
export const USAGE_WARNING_CHOICES: { value: UsageWarningChoice; label: string }[] = [
  { value: 'pace', label: 'Pace new work' },
  { value: 'full', label: 'Keep full speed until the limit' },
  { value: 'ask', label: 'Ask me each time' },
];

/** The saved choice, or 'pace' (the default) for anything else. */
export const usageChoice = (v: unknown): UsageWarningChoice => (v === 'full' || v === 'ask' ? v : 'pace');

/**
 * Pacing the manager waived with Resume full speed, saved before a restart (server/pacing.ts's Waiver), if it still
 * holds: its window isn't over and the choice isn't "Ask me each time", which asks again after a restart.
 */
export function keptWaiver(raw: unknown, choice: unknown, now: number): { until: number; limit: string | null } | null {
  if (usageChoice(choice) === 'ask' || !raw || typeof raw !== 'object') return null;
  const { until, limit } = raw as { until?: unknown; limit?: unknown };
  if (typeof until !== 'number' || !(now < until)) return null;
  return { until, limit: typeof limit === 'string' ? limit : null };
}
