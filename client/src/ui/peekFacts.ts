// What the hover cards (#213) say, pure: who's on an issue or PR, a check's first failing line, an issue body's first
// lines, "how long ago", today's merges. Read from what the store already has: no fetches.
import type { CareerView } from '../../../shared/careers';
import type { QaCheck, QaView, UsageShares } from '../../../shared/types';
import { clock } from '../../../shared/usage';

interface Worker {
  id: string;
  name: string;
  repoId: string | null;
  task: string | null;
  issueNumber: number | null;
  prNumber: number | null;
}

/** Who's working on issue or PR `n` of a floor right now, with what they do ("Ada building", "Bo testing"). */
export function whoIsOn(repoId: string, n: number, agents: Worker[], qa?: Pick<QaView, 'devAgentId' | 'qaAgentId'> | null): string[] {
  const doing: Record<string, string> = { issue: 'building', qa: 'testing', fix: 'fixing' };
  const on = agents.filter((a) => a.repoId === repoId && a.task && (a.issueNumber === n || a.prNumber === n)).map((a) => `${a.name} ${doing[a.task!] ?? 'on it'}`);
  if (on.length || !qa?.devAgentId) return on;
  const author = agents.find((a) => a.id === qa.devAgentId);
  return author ? [`${author.name} wrote it`] : [];
}

/** The first failing check and its first non-empty line, or null when none failed. */
export function firstFailing(checks: QaCheck[] | undefined): { name: string; line: string } | null {
  const c = checks?.find((x) => x.result === 'fail');
  if (!c) return null;
  const line = c.details.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return { name: c.name, line: line.length > 140 ? `${line.slice(0, 139)}…` : line };
}

/** A check's state as a word and a glyph (never colour alone). */
export const checkWord = (r: QaCheck['result']) => (r === 'pass' ? 'passed' : r === 'fail' ? 'failed' : 'skipped');

/** An issue body's first `max` lines of prose: headings, list marks, images, comments and blank lines dropped. */
export function bodyLines(body: string, max = 3): string[] {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ x]\]\s+)?|\d+\.\s+|>\s?)/i, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\*\*|__|`/g, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, max)
    .map((l) => (l.length > 160 ? `${l.slice(0, 159)}…` : l));
}

/** "just now", "12 min ago", "3 h ago", "2 d ago". */
export function agoText(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Merges since local midnight. */
export function mergesToday(c: Pick<CareerView, 'week'>, now: number): number {
  const d = new Date(now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return c.week.filter((t) => t >= midnight && t <= now).length;
}

/** A usage bar's floor shares (#334) as the hover card's rows: "Floor 3 · keelfarm" → "61% · $412", the CEO's, then others. */
export function shareStats(s: Pick<UsageShares, 'rows' | 'others'>, floorOf: (repoId: string) => string | undefined, usd: (n: number) => string): [string, string][] {
  const rows = s.rows.map((r): [string, string] => [r.repoId ? (floorOf(r.repoId) ?? 'A removed floor') : 'CEO (lobby)', `${r.pct}% · ${usd(r.usd)}`]);
  return s.others ? [...rows, [`Others (${s.others.count})`, `${s.others.pct}% · ${usd(s.others.usd)}`]] : rows;
}

/** Under the shares: whose spend they divide, since when, and that use outside the office isn't in it. */
export const sharesNote = (s: Pick<UsageShares, 'since' | 'usd'>, now: number, usd: (n: number) => string) =>
  `Office share of the office’s spend since ${clock(s.since, now)} (${usd(s.usd)} in all). Other (outside the office): your own Claude use isn’t counted.`;

/** What a PR waiting on the manager needs, and the action to take (the Approvals list's peek). */
export function prAdvice(qa: Pick<QaView, 'status' | 'round' | 'ceoLooking'>, ready: boolean): { why: string; recommend: string } {
  if (ready) return { why: 'QA passed and this floor doesn’t merge by itself.', recommend: 'Merge it' };
  if (qa.status === 'needs-human') return { why: `QA couldn’t finish round ${qa.round} on its own${qa.ceoLooking ? '; the CEO is looking at it' : ''}.`, recommend: qa.round >= 3 ? 'Send it back with a note' : 'Retry QA' };
  return { why: `QA failed round ${qa.round}, and it has run out of automatic fixes.`, recommend: 'Send it back with a note' };
}
