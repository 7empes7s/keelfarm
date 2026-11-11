// Where a tap on a PR goes (#407), pure: a PR reference (a chip, a sticky, a card's title, a notice) opens the PR's
// page on the board (CardView, which has its own Preview button); only an explicit "Preview" opens the app viewer.

import type { PullInfo, RepoView } from '../../../shared/types';
import type { Overlay } from '../store';

type Repo = Pick<RepoView, 'id'> & { pulls: readonly Pick<PullInfo, 'number' | 'state' | 'headSha'>[] };

/** The PR's page: its card on the board (`pr-N` while open, `m-N` once merged), or null when it's closed or unknown (only on GitHub). */
export function prPage(repo: Repo, n: number): Overlay | null {
  const pull = repo.pulls.find((p) => p.number === n);
  if (!pull || pull.state === 'CLOSED') return null;
  return { kind: 'card', repoId: repo.id, key: `${pull.state === 'MERGED' ? 'm' : 'pr'}-${n}`, number: n, pr: true };
}

/** An explicit Preview: the app viewer on the PR while it's open; a merged PR is on main now, which opens saying so. */
export function prPreview(repo: Repo, n: number): Overlay {
  const pull = repo.pulls.find((p) => p.number === n);
  if (pull?.state === 'OPEN') return { kind: 'app', repoId: repo.id, pr: n };
  if (pull?.state === 'MERGED') return { kind: 'app', repoId: repo.id, pr: null, merged: { pr: n, sha: (pull.headSha ?? '').slice(0, 7), path: '/' } };
  return { kind: 'app', repoId: repo.id, pr: null };
}
