// Mission control in the office: how its numbers and Claude's usage read on the lobby wall, the floor signs, the HUD
// chip and the manager's console, and which alarms are new (they sound). Pure, so it's tested without a browser.

import type { OpsAlarm, OpsNumbers, OpsView, UsageView } from '../../shared/types';
import { clock } from '../../shared/usage';

export const EMPTY_NUMBERS: OpsNumbers = {
  ready: 0,
  building: 0,
  inQa: 0,
  fixing: 0,
  toMerge: 0,
  needsYou: 0,
  triage: 0,
  longestWaitMs: null,
  waitTrend: Array.from({ length: 7 }, () => null),
  mergedToday: 0,
  mergedHour: 0,
  spark: new Array<number>(24).fill(0),
  leadMs: null,
  qaWaitMs: null,
  qaPass: null,
  qaPassTrend: Array.from({ length: 7 }, () => null),
  qaFirstPass: null,
  qaRoundsPerMerge: null,
  qaLabErrors: 0,
  ciPass: null,
  ciRuns: 0,
  ciMs: null,
  busy: 0,
  idle: 0,
  errors: 0,
  costToday: 0,
};

export const EMPTY_OPS: OpsView = { floors: [], total: EMPTY_NUMBERS, ceoCostToday: 0, alarms: [] };

/** "45s", "12m", "1h 42m", "2d 3h"; "—" when there's nothing to say. */
export function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** 0.917 → "92%"; "—" without data. */
export const fmtPct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

/** The longest a PR should wait in needs-you (#275). */
export const WAIT_TARGET_MS = 30 * 60_000;

/**
 * Mission control's needs-you wait tile (#275): the longest wait now, its tone against the target (good within it, bad
 * past four times it), and the 7-day trend as bar heights 0-1 (null: nobody waited that day) with the target's height.
 */
export function waitTile(n: Pick<OpsNumbers, 'longestWaitMs' | 'waitTrend'>): { value: string; tone: 'good' | 'warn' | 'bad'; bars: (number | null)[]; target: number } {
  const ms = n.longestWaitMs;
  const top = Math.max(WAIT_TARGET_MS, ...n.waitTrend.map((x) => x ?? 0));
  return {
    value: ms === null ? 'Nothing waiting' : fmtDuration(ms),
    tone: ms === null || ms <= WAIT_TARGET_MS ? 'good' : ms <= 4 * WAIT_TARGET_MS ? 'warn' : 'bad',
    bars: n.waitTrend.map((x) => (x === null ? null : x / top)),
    target: WAIT_TARGET_MS / top,
  };
}

/** Dollars: "$4.20", "$0.35"; whole dollars from $100. */
export const fmtUsd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);

/** The HUD's chip while new work is held back, or runs at full speed through a warning by the manager's choice (#323) (null at plain full speed), e.g. "Paced until Tue 00:00: new issues start when fewer than 3 sessions run". */
export function usageChip(u: UsageView, pacingSessions: number, now: number): string | null {
  if (u.byChoice) return 'Usage high: full speed by your choice';
  if (u.state === 'normal' || u.until === null) return null;
  const until = clock(u.until, now);
  if (u.state === 'paused') return `Paused until ${until}: at Claude's usage limit, nothing new starts`;
  return `Paced until ${until}: new issues start when fewer than ${pacingSessions} session${pacingSessions === 1 ? '' : 's'} run`;
}

/** The usage meter's headline and details: the state, and the last warning's limit, fill and reset time. */
export function usageMeter(u: UsageView, now: number): { state: string; tone: 'good' | 'warn' | 'bad'; limit: string; pct: number | null; resets: string | null } {
  const w = u.warning;
  const resetsAt = u.state === 'normal' ? (w?.resetsAt && w.resetsAt > now ? w.resetsAt : null) : u.until;
  return {
    state: u.state === 'paused' ? 'Paused' : u.state === 'pacing' ? 'Pacing' : u.byChoice ? 'Full speed' : 'Normal',
    tone: u.state === 'paused' ? 'bad' : u.state === 'pacing' || u.byChoice ? 'warn' : 'good',
    limit: w ? `${w.limit ?? "Claude's usage"}${w.pct === null ? '' : ` · ${w.pct}%`}` : 'No usage warnings',
    pct: w?.pct ?? null,
    resets: resetsAt ? clock(resetsAt, now) : null,
  };
}

/** Alarms in `next` that weren't in `prev`: these sound. */
export const newAlarms = (prev: OpsAlarm[], next: OpsAlarm[]) => next.filter((a) => !prev.some((p) => p.id === a.id));

/** One floor's numbers, compact, for its wall sign: "🚀 3 today · ⏱ 1h 42m lead · ✅ CI 92% · 💵 ~$4.20". */
export function signLine(n: OpsNumbers): string {
  return `🚀 ${n.mergedToday} today · ⏱ ${fmtDuration(n.leadMs)} lead · ✅ CI ${fmtPct(n.ciPass)} · 💵 ~${fmtUsd(n.costToday)}`;
}
