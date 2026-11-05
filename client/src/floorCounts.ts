// A floor's PR counts for the lobby, the floor signs and the billboards, matching the Kanban's columns (store.ts kanbanFor).
import type { QaView, RepoView } from '../../shared/types';
import { needsManager } from './qaCard';

export interface FloorPrCounts {
  /** Open PRs in the Kanban's In QA column: queued, testing, failed, fixing, needs-human and untested ones. */
  inQa: number;
  /** Open PRs that passed QA (the Ready to merge column). */
  ready: number;
  /** Open PRs waiting on the manager (needs-human, and the CEO isn't triaging them); also counted in inQa. */
  needsYou: number;
}

/**
 * A floor's PR counts, matching kanbanFor's columns. Only open PRs count: QA records outlive their PR's merge or
 * close, so counting records instead drifts further from the board with every merge.
 */
export function floorPrCounts(repo: RepoView, qaRecords: Record<string, QaView>): FloorPrCounts {
  const counts: FloorPrCounts = { inQa: 0, ready: 0, needsYou: 0 };
  for (const p of repo.pulls) {
    if (p.state !== 'OPEN') continue;
    const rec = qaRecords[`${repo.id}#${p.number}`];
    if (rec?.status === 'passed') counts.ready++;
    else counts.inQa++;
    if (needsManager(rec)) counts.needsYou++;
  }
  return counts;
}
