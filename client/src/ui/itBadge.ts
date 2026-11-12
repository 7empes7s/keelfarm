// IT's badge (#580): what the IT department has waiting on the manager, for its menu entry, the 3D HUD and the
// approvals. Open cards (IT's recommendations not snoozed, the review's improvement cards) and the health checks that
// need a look with no open card of their own yet. Pure, from the snapshot's itWatch and itImprove.
import { openRecs, snoozedChecks, type ItWatchView } from '../../../shared/itWatch';
import type { ItImproveView } from '../../../shared/itImprove';

/** The open cards and the checks needing a look (warn or bad) that no open or snoozed card covers. */
export function itWaiting(watch: Pick<ItWatchView, 'checks' | 'recs'> | null, improve: Pick<ItImproveView, 'cards'> | null, now: number): { cards: number; checks: number; total: number } {
  const recs = openRecs(watch?.recs ?? [], now);
  const covered = new Set([...recs.map((r) => r.check), ...snoozedChecks(watch?.recs ?? [], now)]);
  const cards = recs.length + (improve?.cards.length ?? 0);
  const checks = (watch?.checks ?? []).filter((c) => (c.level === 'warn' || c.level === 'bad') && !covered.has(c.id)).length;
  return { cards, checks, total: cards + checks };
}
