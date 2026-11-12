import { describe, expect, it } from 'vitest';
import type { ItCheck, ItRecommendation } from '../../../shared/itWatch';
import type { ItImproveCard } from '../../../shared/itImprove';
import { itWaiting } from './itBadge';

const check = (id: ItCheck['id'], level: ItCheck['level']): ItCheck => ({ id, label: id, level, line: '', facts: [], at: 0 });
const rec = (id: string, c: ItCheck['id'], snoozedUntil: number | null = null): ItRecommendation => ({ id, check: c, title: id, evidence: '', options: [], at: 0, by: 'Iris', snoozedUntil });
const card = { id: 'i-1-1' } as ItImproveCard;

describe("IT's badge", () => {
  it('counts open cards and the checks needing a look that no card covers', () => {
    const watch = { checks: [check('disk', 'bad'), check('memory', 'warn'), check('load', 'warn'), check('docker', 'good'), check('certs', 'off')], recs: [rec('r1', 'disk'), rec('r2', 'load', 2000)] };
    // disk has its open card, load's card is snoozed (quiet till then), memory needs a look on its own
    expect(itWaiting(watch, { cards: [card] }, 1000)).toEqual({ cards: 2, checks: 1, total: 3 });
    // once the snooze is over, load's card is open again
    expect(itWaiting(watch, { cards: [card] }, 3000)).toEqual({ cards: 3, checks: 1, total: 4 });
  });

  it('is zero before the first check or review', () => {
    expect(itWaiting(null, null, 0)).toEqual({ cards: 0, checks: 0, total: 0 });
  });
});
