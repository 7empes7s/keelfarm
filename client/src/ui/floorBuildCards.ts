// "What's new on this floor" (#129): the cards above a floor's board, pure. The floor's live app on main first, then
// what its agents built lately, newest first: issues still being built, open PRs where QA has them, recent merges.

import type { PreviewStatus, PrPreviewView, QaView, RepoView } from '../../../shared/types';
import { qaShotUrl } from './channels';
import { prPages } from './prChangesRules';

export type BuildStatus = 'live' | 'building' | 'qa' | 'fixing' | 'passed' | 'failed' | 'needs-you' | 'open' | 'merged';

export interface BuildCard {
  key: string;
  /** The PR it previews; null for the live app on main and for work with no PR yet. */
  pr: number | null;
  title: string;
  status: BuildStatus;
  agentId: string | null;
  /** QA's latest screenshot of it, if any. */
  shot: string | null;
  /** Its preview's state; null when there's nothing to run yet (still being built). */
  preview: PreviewStatus | null;
  at: number;
  /** A merged PR: its head commit and the first page it changes, where main's preview opens (#225). */
  merged?: { sha: string; path: string };
}

/** What tapping a card does (#225): never a dead click, so a card with nothing to open isn't a button at all (null). */
export type CardAction = { kind: 'terminal'; agentId: string } | { kind: 'app'; pr: number | null; merged?: { pr: number; sha: string; path: string } } | null;

export function cardAction(c: BuildCard): CardAction {
  if (c.preview == null) return c.agentId ? { kind: 'terminal', agentId: c.agentId } : null;
  // A merged PR is on main: main's preview opens, at its page, saying so. "Didn't run" opens main's error and log.
  if (c.status === 'merged' && c.pr != null) return { kind: 'app', pr: null, merged: { pr: c.pr, sha: c.merged?.sha ?? '', path: c.merged?.path ?? '/' } };
  return { kind: 'app', pr: c.pr };
}

/** The card's call to action. */
export function cardActionLabel(c: BuildCard, action: CardAction): string | null {
  if (!action) return null;
  if (action.kind === 'terminal') return 'Watch them build';
  if (c.preview === 'error') return "Didn't run: see why";
  if (c.preview === 'preparing' || c.preview === 'installing' || c.preview === 'starting') return 'Starting…';
  return action.merged ? 'Open on main' : 'Open preview';
}

export const BUILD_LABEL: Record<BuildStatus, string> = {
  live: 'Live on main',
  building: 'Building',
  qa: 'In QA',
  fixing: 'Fixing',
  passed: 'Passed',
  failed: 'QA failed',
  'needs-you': 'Needs you',
  open: 'Open',
  merged: 'Merged',
};

/** Merged PRs shown at most: the floor's recent history, not its whole log. */
const MERGED_SHOWN = 3;

type Worker = { id: string; repoId: string; role: string; status: string; task: string | null; issueNumber: number | null; issueTitle: string | null; prNumber: number | null; startedAt: number | null };

const QA_STATUS: Record<QaView['status'], BuildStatus> = { queued: 'qa', testing: 'qa', fixing: 'fixing', passed: 'passed', failed: 'failed', 'needs-human': 'needs-you' };

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/** The floor's cards, newest first after the live app's. */
export function floorBuilds(repo: RepoView, agents: Worker[], qa: Record<string, QaView>, prPreviews: Record<string, PrPreviewView>): BuildCard[] {
  const team = agents.filter((a) => a.repoId === repo.id && a.role !== 'ceo');
  const live: BuildCard = { key: 'main', pr: null, title: 'Live app on main', status: 'live', agentId: null, shot: null, preview: repo.preview.status, at: Infinity };
  const building: BuildCard[] = team
    .filter((a) => a.task === 'issue' && (a.status === 'working' || a.status === 'preparing') && a.issueNumber != null && a.prNumber == null)
    .map((a) => ({ key: `issue-${a.issueNumber}`, pr: null, title: a.issueTitle ?? `Issue #${a.issueNumber}`, status: 'building', agentId: a.id, shot: null, preview: null, at: a.startedAt ?? 0 }));
  const prs: BuildCard[] = [];
  let merged = 0;
  for (const p of [...repo.pulls].sort((a, b) => time(b.mergedAt ?? b.createdAt) - time(a.mergedAt ?? a.createdAt))) {
    if (p.state === 'CLOSED' || (p.state === 'OPEN' && p.untrusted) || (p.state === 'MERGED' && ++merged > MERGED_SHOWN)) continue; // an outsider's PR is never previewed (#185)
    const q = qa[`${repo.id}#${p.number}`];
    const author = q?.devAgentId ?? team.find((a) => a.prNumber === p.number && a.task !== 'qa')?.id ?? null;
    const open = p.state === 'OPEN';
    prs.push({
      key: `pr-${p.number}`,
      pr: p.number,
      title: p.title,
      status: open ? (q ? QA_STATUS[q.status] : 'open') : 'merged',
      agentId: author,
      shot: q?.shots?.length ? qaShotUrl(repo.id, p.number, 0, q.updatedAt) : null,
      // A merged PR is on main now: its preview is main's.
      preview: open ? (prPreviews[`${repo.id}#${p.number}`]?.status ?? 'stopped') : repo.preview.status,
      at: Math.max(time(p.mergedAt ?? p.createdAt), q?.updatedAt ?? 0),
      ...(!open && { merged: { sha: (p.headSha ?? '').slice(0, 7), path: prPages(repo.fullName, q?.shots, p.files)[0]?.path ?? '/' } }),
    });
  }
  return [live, ...[...building, ...prs].sort((a, b) => b.at - a.at)];
}
