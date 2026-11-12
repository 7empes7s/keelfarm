// The Approvals review room (#209): why each item needs the manager, how long it has waited, and what a PR touches.
// Pure, from what the snapshot already carries (QA records, PRs' checks and changed paths), for client/src/pocket/.
import { checksCause } from './rounds.ts';
import type { PullInfo, QaView } from './types.ts';

/** Why it needs the manager. outage: GitHub didn't run CI (billing, no runner); checks: QA passed, only CI is red. */
export type ApprovalWhy = 'outage' | 'checks' | 'qa' | 'ready' | 'product' | 'design' | 'team' | 'charter' | 'it';

export const WHY_LABELS: Record<ApprovalWhy, { icon: string; label: string; short: string }> = {
  outage: { icon: '💳', label: 'CI outage, not the code', short: 'CI outage' },
  checks: { icon: '🧪', label: 'Only CI failing', short: 'only CI' },
  qa: { icon: '⚠️', label: 'QA blocked', short: 'QA' },
  ready: { icon: '✅', label: 'Ready to merge', short: 'ready' },
  product: { icon: '🧭', label: 'Product decision', short: 'product' },
  design: { icon: '🎨', label: 'Design approval', short: 'design' },
  team: { icon: '👥', label: 'Team change', short: 'team' },
  charter: { icon: '🎯', label: 'Charter change', short: 'charter' },
  it: { icon: '🔧', label: 'IT', short: 'IT' },
};

/** The order the groups show in: what the manager can clear fastest first. */
export const WHY_ORDER: ApprovalWhy[] = ['design', 'product', 'team', 'charter', 'it', 'qa', 'checks', 'outage', 'ready'];

/**
 * Why a PR is in the approvals: ready once QA passed on a floor that doesn't merge by itself; an outage when every red
 * check never started or the note says GitHub refused to run CI; checks when QA found nothing but CI is red; else QA.
 */
export function prWhy(qa: Pick<QaView, 'status' | 'checks' | 'mergeNote' | 'summary'>, pr: Pick<PullInfo, 'checks' | 'failedChecks'>): ApprovalWhy {
  const failed = pr.failedChecks ?? [];
  if (failed.length && failed.every((c) => c.neverStarted)) return 'outage';
  if (checksCause(qa.mergeNote) === 'outage') return 'outage';
  if (qa.status === 'passed') return pr.checks === 'failing' ? 'checks' : 'ready';
  const qaFound = qa.checks.some((c) => c.result === 'fail');
  if (pr.checks === 'failing' && !qaFound) return 'checks';
  return 'qa';
}

/** "20 need you · 17 only CI · 2 product · 1 design": the counts above the list, biggest group first. */
export function whySummary(whys: readonly ApprovalWhy[]): { total: number; parts: { why: ApprovalWhy; n: number }[] } {
  const counts = new Map<ApprovalWhy, number>();
  for (const w of whys) counts.set(w, (counts.get(w) ?? 0) + 1);
  const parts = [...counts].map(([why, n]) => ({ why, n })).sort((a, b) => b.n - a.n || WHY_ORDER.indexOf(a.why) - WHY_ORDER.indexOf(b.why));
  return { total: whys.length, parts };
}

/** A span as the cards say it: "just now", "5 min", "2 h", "3 days". */
export function span(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** When a PR was put to the manager: kept while it stays needs-human, set as it becomes so (`given`, else now), else none. */
export function stuckSince(was: string, status: string, prev: number | null | undefined, now: number, given?: number | null): number | null {
  if (status !== 'needs-human') return null;
  return was === 'needs-human' && prev ? prev : (given ?? now);
}

/** A wait as the "waiting" lines say it: "<1 min", "12 min", "3 h 12 min", "2 days 3 h". */
export function waitSpan(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}${h % 24 ? ` ${h % 24} h` : ''}`;
}

/**
 * How long a PR has waited and on what (#275), for the Approvals and the Kanban: "waiting 3 h 12 min: conflicts with
 * main → a developer is updating it". Needs-human PRs and PRs back with a developer to resolve a conflict; else null.
 */
export function prWaitLine(qa: Pick<QaView, 'status' | 'stuckAt' | 'stuckWhy' | 'ceoLooking' | 'updatedAt' | 'fixReason'>, base: string, now: number): string | null {
  if (qa.status === 'needs-human') {
    const why = qa.stuckWhy?.replace(/^it /, '') ?? 'it needs a decision';
    return `waiting ${waitSpan(now - (qa.stuckAt ?? qa.updatedAt))}: ${why} → ${qa.ceoLooking ? 'the CEO is looking first' : 'needs you'}`;
  }
  if ((qa.status === 'failed' || qa.status === 'fixing') && qa.fixReason === 'conflict') {
    return `waiting ${waitSpan(now - qa.updatedAt)}: conflicts with ${base} → ${qa.status === 'fixing' ? 'a developer is updating it' : 'the next free developer updates it'}`;
  }
  return null;
}

/** "asked 2 h ago · open 3 days": when it was put to the manager and how long the PR (or request) has been open. */
export function waitLine(askedAt: number, openedAt: number | null, now: number): string {
  const asked = span(now - askedAt);
  const parts = [asked === 'just now' ? 'asked just now' : `asked ${asked} ago`];
  if (openedAt !== null && openedAt < askedAt - 60_000) parts.push(`open ${span(now - openedAt)}`);
  return parts.join(' · ');
}

export type PrAction = 'merge' | 'retry' | 'sendBack' | 'close';

/** The same manual overrides in CardView and PrDetail; active work keeps only its terminal. */
export function prActions(status: QaView['status'], autoMerge: boolean): PrAction[] {
  if (status === 'needs-human' || status === 'failed') return ['retry', 'sendBack', 'merge', 'close'];
  if (status === 'passed' && !autoMerge) return ['merge'];
  return [];
}

/** The decision card's plain sentence for a PR, and the action it recommends (null: nothing to do but wait). */
export function prDecision(why: ApprovalWhy, round: number, autoMerge: boolean, checks?: PullInfo['checks']): { text: string; recommend: PrAction | null } {
  switch (why) {
    case 'outage':
      if (checks === 'passing') return { text: 'CI runs again: retry QA so it can merge.', recommend: 'retry' };
      return autoMerge
        ? { text: "GitHub didn't run CI (billing or no runner), so this isn't the code. It merges by itself once CI runs again.", recommend: null }
        : { text: "GitHub didn't run CI (billing or no runner), so this isn't the code. Merge it anyway if QA's report is enough for you.", recommend: 'merge' };
    case 'checks':
      return { text: 'QA found nothing wrong; only CI is red. Send it back for a CI fix, or merge anyway if the red check is noise.', recommend: 'sendBack' };
    case 'ready':
      return { text: "QA passed. This floor doesn't merge on its own: merge it when you're happy.", recommend: 'merge' };
    default:
      return round >= 3
        ? { text: `QA couldn't pass it in ${round} rounds. Send it back with a note on what to change, or close it.`, recommend: 'sendBack' }
        : { text: "QA is blocked on it. Retry QA if the blocker is gone, or send it back with what's needed.", recommend: 'retry' };
  }
}

/** "CI / windows, lint (never ran)": the red checks by name. */
const redChecks = (failed: PullInfo['failedChecks']) => failed.map((c) => (c.neverStarted ? `${c.name} (never ran)` : c.name)).join(', ');

/**
 * The Merge confirmation's words from the PR's real state: QA passed (or found nothing and only CI is red) or not, the
 * red checks by name, and that the floor's main goes live with it.
 */
export function mergeConfirmText(
  why: ApprovalWhy,
  qa: Pick<QaView, 'status' | 'checks'>,
  pr: Pick<PullInfo, 'number' | 'title' | 'failedChecks'>,
  repo: { defaultBranch: string; floor: number },
): { title: string; body: string; confirm: string; warn: boolean } {
  const live = `floor ${repo.floor}'s main goes live with it.`;
  if (why === 'ready') return { title: `Merge PR #${pr.number}?`, body: `“${pr.title}” passed QA. It will be squash-merged into ${repo.defaultBranch}, and ${live}`, confirm: 'Squash & merge', warn: false };
  const red = redChecks(pr.failedChecks ?? []);
  const redLine = red ? ` Red: ${red}.` : '';
  const qaPassed = qa.status === 'passed' || why === 'checks' || (why === 'outage' && !qa.checks.some((c) => c.result === 'fail'));
  const anyway = `It will be squash-merged into ${repo.defaultBranch} anyway, and ${live}`;
  return qaPassed
    ? { title: `Merge PR #${pr.number} with CI red?`, body: `“${pr.title}” passed QA; only CI is red.${redLine} ${anyway}`, confirm: 'Merge anyway', warn: true }
    : { title: `Merge PR #${pr.number} without QA?`, body: `“${pr.title}” has not passed QA.${redLine} ${anyway}`, confirm: 'Merge anyway', warn: true };
}

// ---------- impact ----------

type Area = 'client' | 'server' | 'shared' | 'scripts' | 'tests' | 'docs' | 'other';
type RiskFlag = 'self-update' | 'scheduler' | 'merge loop' | 'CEO tools' | 'dependencies' | 'CI';

const RISKS: [RiskFlag, RegExp][] = [
  ['self-update', /^(scripts\/office(Steps)?\.mjs|server\/officeUpdate\.ts|server\/swarm\/update\.ts|bin\/)/],
  ['scheduler', /^server\/(swarm\/scheduling|pacing|health)\.ts$/],
  ['merge loop', /^server\/swarm\/(merge|qa)\.ts$/],
  ['CEO tools', /^server\/(ceo|ceoWaitTools|decisionTool|designTool|swarm\/ceoTools)\.ts$/],
  ['dependencies', /(^|\/)package(-lock)?\.json$/],
  ['CI', /^\.github\//],
];

const areaOf = (p: string): Area => {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || p.startsWith('e2e/')) return 'tests';
  if (/^docs\/|\.md$/i.test(p)) return 'docs';
  const top = p.split('/')[0];
  return top === 'client' || top === 'server' || top === 'shared' || top === 'scripts' ? top : 'other';
};

export interface Impact {
  areas: { area: Area; files: number }[];
  risks: RiskFlag[];
  screens: string[]; // the UI files it changes (client/src/ui, client/src/pocket), by name
  additions: number;
  deletions: number;
}

/** What a PR touches, from its changed paths: files per area (most first), the office's risky parts, and screens. */
export function impactOf(files: readonly string[], additions: number, deletions: number): Impact {
  const counts = new Map<Area, number>();
  for (const f of files) counts.set(areaOf(f), (counts.get(areaOf(f)) ?? 0) + 1);
  const areas = [...counts].map(([area, n]) => ({ area, files: n })).sort((a, b) => b.files - a.files);
  const risks = RISKS.filter(([, re]) => files.some((f) => re.test(f))).map(([flag]) => flag);
  const screens = [...new Set(files.filter((f) => /^client\/src\/(ui|pocket)\/[^/]+\.tsx$/.test(f) && !/\.test\./.test(f)).map((f) => f.replace(/^.*\/|\.tsx$/g, '')))];
  return { areas, risks, screens, additions, deletions };
}

/** The "impact" sort: risky ones first, then the bigger diff. */
export const impactScore = (i: Impact) => i.risks.length * 10_000 + i.additions + i.deletions;
