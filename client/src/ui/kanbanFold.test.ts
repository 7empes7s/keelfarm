import { describe, expect, it } from 'vitest';
import type { KanbanCard } from '../store';
import type { QaView } from '../../../shared/types';
import { COLUMN_IDS, foldSummary, isFolded, parseFolds, withFold } from './kanbanFold';

const card = (number: number, extra: Partial<KanbanCard> = {}): KanbanCard => ({ key: `k${number}`, number, title: `#${number}`, ...extra });
const qa = (status: QaView['status']) => ({ status }) as QaView;

describe('which Kanban columns start folded', () => {
  it('folds the Backlog and Merged on a phone, keeping the active columns open', () => {
    const folded = COLUMN_IDS.filter((id) => isFolded({}, 'r', id, true));
    expect(folded).toEqual(['backlog', 'merged']);
  });

  it('opens every column side by side', () => {
    expect(COLUMN_IDS.filter((id) => isFolded({}, 'r', id, false))).toEqual([]);
  });

  it("remembers the manager's choice per floor, over the default", () => {
    let map = withFold({}, 'floor-1', 'backlog', false);
    map = withFold(map, 'floor-1', 'qa', true);
    expect(isFolded(map, 'floor-1', 'backlog', true)).toBe(false);
    expect(isFolded(map, 'floor-1', 'qa', false)).toBe(true);
    expect(isFolded(map, 'floor-2', 'backlog', true)).toBe(true); // another floor keeps the default
    expect(isFolded(map, 'floor-1', 'merged', true)).toBe(true);
  });

  it('reads back what it saved, and nothing from junk', () => {
    const map = withFold(withFold({}, 'a', 'backlog', false), 'b', 'merged', true);
    expect(parseFolds(JSON.stringify(map))).toEqual(map);
    expect(parseFolds(null)).toEqual({});
    expect(parseFolds('{not json')).toEqual({});
    expect(parseFolds('[1]')).toEqual({});
    expect(parseFolds('{"a":{"backlog":"yes","nope":true,"qa":false}}')).toEqual({ a: { qa: false } });
  });
});

describe("a folded column's summary", () => {
  it('counts the Backlog ready and waiting, and names the next one', () => {
    const cards = [card(110, { note: '⏳ after #3' }), card(112), card(113, { tone: 'warn' }), card(114)];
    expect(foldSummary('backlog', cards)).toBe('2 ready · 2 waiting · next #112');
  });

  it('counts QA by state, leaving out the empty ones', () => {
    expect(foldSummary('qa', [card(1, { qa: qa('testing') }), card(2, { qa: qa('needs-human') }), card(3), card(4, { qa: qa('testing') })])).toBe('2 testing · 1 need you · 1 waiting');
  });

  it('says how much is in progress and merged', () => {
    expect(foldSummary('progress', [card(1), card(2, { tone: 'bad' })])).toBe('1 working · 1 need help');
    expect(foldSummary('merged', [card(140), card(120)])).toBe('2 merged · latest #140');
    expect(foldSummary('ready', [card(5)])).toBe('1 passed QA');
    expect(foldSummary('backlog', [])).toBe('');
  });
});
