// What a floor's project screens show (#536), pure, from the office's own data: the board screen every floor has
// (its Kanban counts, latest merge, preview and team), the backup vault's tenant status, the video studio's launch
// countdown and clips counter, the town hall's notices and the server room's terminal. Nothing is made up: an empty
// floor shows zeros and dashes.

import type { AgentStatus, IssueInfo, PullInfo, QaView } from '../../../../shared/types';
import type { KanbanColumns } from '../../store';

type Pull = Pick<PullInfo, 'number' | 'title' | 'state' | 'mergedAt'>;

const sameDay = (iso: string, now: Date) => new Date(iso).toDateString() === now.toDateString();

/** The floor's merged PRs, newest first. */
const merged = (pulls: readonly Pull[]) => pulls.filter((p) => p.state === 'MERGED' && p.mergedAt).sort((a, b) => b.mergedAt!.localeCompare(a.mergedAt!));

export interface FloorBoard {
  progress: number;
  qa: number;
  ready: number;
  mergedToday: number;
}

/** The board screen's four numbers: the Kanban's In progress, In QA and Ready columns, and today's merges. */
export function floorBoard(cols: Pick<KanbanColumns, 'progress' | 'qa' | 'ready'>, pulls: readonly Pull[], now: Date): FloorBoard {
  return { progress: cols.progress.length, qa: cols.qa.length, ready: cols.ready.length, mergedToday: merged(pulls).filter((p) => sameDay(p.mergedAt!, now)).length };
}

/** The latest merged PR, for the board screen's headline. */
export function latestMerge(pulls: readonly Pull[]): { number: number; title: string; at: number } | null {
  const p = merged(pulls)[0];
  return p ? { number: p.number, title: p.title, at: Date.parse(p.mergedAt!) } : null;
}

export interface TeamStatus {
  working: number;
  free: number;
  help: number;
}

/** The team on the board screen: who's working, who's free and who needs help (the CEO isn't on a floor's team). */
export function teamStatus(agents: readonly { role: string; status: AgentStatus }[]): TeamStatus {
  const out: TeamStatus = { working: 0, free: 0, help: 0 };
  for (const a of agents) {
    if (a.role === 'ceo') continue;
    if (a.status === 'working' || a.status === 'preparing') out.working++;
    else if (a.status === 'error') out.help++;
    else out.free++;
  }
  return out;
}

/** "5 min ago", "3 h ago", "2 d ago", or a dash for never. */
export function ago(at: number | null, now: number): string {
  if (at === null || !Number.isFinite(at)) return '—';
  const min = Math.max(0, Math.round((now - at) / 60_000));
  return min < 60 ? `${min} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
}

// ---------- the backup vault's tenant status ----------

export interface Gate {
  number: number;
  title: string;
  checks: PullInfo['checks'];
  qa: QaView['status'] | null;
}

/**
 * The tenant status screen: when the floor last shipped (its latest merge) and the restore gates its open PRs must
 * pass: each one's checks and QA, newest first, at most `max`.
 */
export function tenantStatus(
  repoId: string,
  pulls: readonly (Pull & Pick<PullInfo, 'checks' | 'untrusted'>)[],
  qa: Readonly<Record<string, Pick<QaView, 'status'> | undefined>>,
  max = 3,
): { lastMerge: number | null; gates: Gate[]; open: number } {
  const open = pulls.filter((p) => p.state === 'OPEN' && !p.untrusted).sort((a, b) => b.number - a.number);
  return {
    lastMerge: latestMerge(pulls)?.at ?? null,
    gates: open.slice(0, max).map((p) => ({ number: p.number, title: p.title, checks: p.checks, qa: qa[`${repoId}#${p.number}`]?.status ?? null })),
    open: open.length,
  };
}

// ---------- the video studio ----------

/**
 * The launch countdown: the first date (YYYY-MM-DD) in the floor's mission or charter that is today or later, and the
 * days to it; null when there's none.
 */
export function launchCountdown(texts: readonly string[], now: Date): { date: string; days: number } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const t of texts)
    for (const m of t.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) {
      const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
      if (at >= today) return { date: m[0], days: Math.round((at - today) / 86_400_000) };
    }
  return null;
}

/** The clips-approved counter: PRs merged today and in the floor's recent list. */
export const clipsApproved = (pulls: readonly Pull[], now: Date) => ({ today: merged(pulls).filter((p) => sameDay(p.mergedAt!, now)).length, total: merged(pulls).length });

// ---------- the town hall and the server room ----------

/** The noticeboard's notices: the floor's newest open issues (outsiders' left off), at most `max`. */
export const notices = (issues: readonly Pick<IssueInfo, 'number' | 'title' | 'untrusted'>[], max = 4) =>
  issues
    .filter((i) => !i.untrusted)
    .sort((a, b) => b.number - a.number)
    .slice(0, max)
    .map((i) => ({ number: i.number, title: i.title }));

/** The terminal wall's lines: the latest merges as a git log, newest first. */
export const gitLog = (pulls: readonly Pull[], max = 6) => merged(pulls).slice(0, max).map((p) => `#${p.number} ${p.title}`);
