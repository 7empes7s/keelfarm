// The live pieces of the second batch of floor themes (#371), pure: what each one shows from the office's own data.
// The media studio's ON AIR light and content calendar, the research lab's rack LEDs and loss curve, the design
// studio's gallery of the latest screenshots, and the ops control room's alert beacon, status wall and clock colour.
// Nothing here makes numbers up: an empty office shows empty screens.

import type { AgentStatus, IssueInfo, PreviewStatus, PullInfo, QaView } from '../../../../shared/types';

const BUSY: readonly AgentStatus[] = ['preparing', 'working'];

type Person = { role: string; status: AgentStatus };
const busy = (agents: readonly Person[]) => agents.filter((a) => a.role !== 'ceo' && BUSY.includes(a.status)).length;

/** The media studio's ON AIR light: lit while anyone on the floor is working. */
export const onAir = (agents: readonly Person[]) => busy(agents) > 0;

/**
 * The research lab's rack LEDs, in blinks a second: a slow idle pulse with no sessions running on the floor, faster
 * with each one, up to a busy flicker.
 */
export function ledBlinkHz(agents: readonly Person[]): number {
  const n = busy(agents);
  return n === 0 ? 0.3 : Math.min(6, 0.8 + n * 1.1);
}

type OpenPull = Pick<PullInfo, 'number' | 'state'>;

/** The ops control room's red beacon: on while any open PR on any floor is needs-human (the CEO looking or not). */
export function alertBeacon(repos: readonly { id: string; pulls: readonly OpenPull[] }[], qa: Readonly<Record<string, Pick<QaView, 'status'> | undefined>>): boolean {
  return repos.some((r) => r.pulls.some((p) => p.state === 'OPEN' && qa[`${r.id}#${p.number}`]?.status === 'needs-human'));
}

/** The design studio's gallery: the floor's latest screenshot from each agent's browser, newest first, at most `max`. */
export function galleryShots(agents: readonly { id: string; name: string }[], screens: Readonly<Record<string, number>>, max = 6): { id: string; at: number; name: string }[] {
  return agents
    .flatMap((a) => (screens[a.id] ? [{ id: a.id, at: screens[a.id], name: a.name }] : []))
    .sort((a, b) => b.at - a.at)
    .slice(0, max);
}

// ---------- the media studio's content calendar ----------

export interface CalendarDay {
  label: string; // "MON 10"
  today: boolean;
  items: { number: number; title: string; live: boolean }[];
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const PER_DAY = 3;

/**
 * The floor's open issues as a week of content: what agents are on now goes out today, live, and the rest of the
 * backlog (oldest first, skipping ones not trusted to build) fills the following working days, PER_DAY a day.
 * `later`: what doesn't fit in the five days.
 */
export function contentCalendar(issues: readonly Pick<IssueInfo, 'number' | 'title' | 'createdAt' | 'untrusted'>[], building: ReadonlySet<number>, now: Date): { days: CalendarDay[]; later: number } {
  const days: CalendarDay[] = [];
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  while (days.length < 5) {
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push({ label: `${DAYS[d.getDay()]} ${d.getDate()}`, today: d.toDateString() === now.toDateString(), items: [] });
    d.setDate(d.getDate() + 1);
  }
  const open = issues.filter((i) => !i.untrusted);
  const live = open.filter((i) => building.has(i.number));
  const rest = open.filter((i) => !building.has(i.number)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number);
  const first = days[0];
  first.items.push(...live.map((i) => ({ number: i.number, title: i.title, live: true })));
  let later = 0;
  let day = 0;
  for (const i of rest) {
    while (day < days.length && days[day].items.length >= PER_DAY) day++;
    if (day >= days.length) later++;
    else days[day].items.push({ number: i.number, title: i.title, live: false });
  }
  return { days, later };
}

// ---------- the research lab's loss curve ----------

/**
 * The floor's QA pass rate per day (oldest first) as a training run's loss: 1 - pass rate, so a better week curves
 * down. Days without QA rounds are skipped; `pass` is the latest day's rate.
 */
export function lossCurve(trend: readonly (number | null)[]): { points: { day: number; loss: number }[]; pass: number | null } {
  const points = trend.flatMap((v, day) => (v === null ? [] : [{ day, loss: 1 - v }]));
  return { points, pass: points.length ? 1 - points[points.length - 1].loss : null };
}

// ---------- the ops control room's status wall ----------

export type Level = 'ok' | 'warn' | 'alert';

export interface NocFloor {
  floor: number;
  name: string;
  preview: PreviewStatus;
  checks: { passing: number; failing: number; pending: number };
  needsHuman: number;
  level: Level;
}

const PREVIEW_LEVEL: Record<PreviewStatus, Level> = { running: 'ok', stopped: 'ok', unconfigured: 'ok', preparing: 'warn', installing: 'warn', starting: 'warn', error: 'alert' };

/** A floor's tile on the status wall: its preview, its open PRs' checks and its needs-human PRs, and how it's doing. */
export function nocFloor(repo: { id: string; floor: number; fullName: string; preview: { status: PreviewStatus }; pulls: readonly Pick<PullInfo, 'number' | 'state' | 'checks'>[] }, qa: Readonly<Record<string, Pick<QaView, 'status'> | undefined>>): NocFloor {
  const open = repo.pulls.filter((p) => p.state === 'OPEN');
  const checks = { passing: 0, failing: 0, pending: 0 };
  for (const p of open) if (p.checks !== 'none') checks[p.checks]++;
  const needsHuman = open.filter((p) => qa[`${repo.id}#${p.number}`]?.status === 'needs-human').length;
  const level: Level = needsHuman || PREVIEW_LEVEL[repo.preview.status] === 'alert' ? 'alert' : checks.failing || PREVIEW_LEVEL[repo.preview.status] === 'warn' ? 'warn' : 'ok';
  return { floor: repo.floor, name: repo.fullName.split('/')[1] ?? repo.fullName, preview: repo.preview.status, checks, needsHuman, level };
}

export interface NocSystem {
  memoryPct: number | null; // memory in use, 0-100
  diskFreeGb: number | null; // the tightest disk's free space
  diskLevel: 'ok' | 'warn' | 'hold' | null;
  running: number;
  level: Level;
}

/** The office's own machine on the status wall, from the health strip's numbers (null before the first reading). */
export function nocSystem(h: { memory: { availableMb: number; totalMb: number } | null; running: number; disk?: { level: 'ok' | 'warn' | 'hold'; disks: { freeMb: number }[] } | null } | null): NocSystem {
  const m = h?.memory;
  const memoryPct = m && m.totalMb > 0 ? Math.round((1 - m.availableMb / m.totalMb) * 100) : null;
  const disks = h?.disk?.disks ?? [];
  const diskFreeGb = disks.length ? Math.min(...disks.map((d) => d.freeMb)) / 1024 : null;
  const diskLevel = h?.disk?.level ?? null;
  const level: Level = diskLevel === 'hold' || (memoryPct ?? 0) >= 92 ? 'alert' : diskLevel === 'warn' || (memoryPct ?? 0) >= 80 ? 'warn' : 'ok';
  return { memoryPct, diskFreeGb, diskLevel, running: h?.running ?? 0, level };
}

/** The status clock's colour: the worst of the floors and the machine. */
export function overallLevel(levels: readonly Level[]): Level {
  return levels.includes('alert') ? 'alert' : levels.includes('warn') ? 'warn' : 'ok';
}
