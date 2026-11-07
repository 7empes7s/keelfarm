import { describe, expect, it } from 'vitest';
import { FLOOR_MIN, floorColumns, statusLine } from './companyLayout';

const GAP = 12;
const cardWidth = (width: number, cols: number) => (width - (cols - 1) * GAP) / cols;
const alone = (count: number, cols: number) => count > cols && count % cols === 1;

describe('floorColumns', () => {
  it('one column for one card, a phone or no width yet', () => {
    expect(floorColumns(1600, 1)).toBe(1);
    expect(floorColumns(366, 3)).toBe(1);
    expect(floorColumns(0, 3)).toBe(1);
  });

  it('three floors share the row at 1000 px instead of 2 + a lonely third (#223)', () => {
    expect(floorColumns(1000, 3)).toBe(3);
    expect(floorColumns(1400, 3)).toBe(3);
    expect(floorColumns(1800, 3)).toBe(3); // never more columns than cards
  });

  it('balances rows: 4 cards in room for 3 make 2 + 2', () => {
    expect(floorColumns(1100, 4)).toBe(2);
    expect(floorColumns(1500, 4)).toBe(4);
    expect(floorColumns(1500, 5)).toBe(3); // 3 + 2, not 4 + 1
  });

  it('keeps a lonely card only when no balanced split fits', () => {
    expect(floorColumns(700, 3)).toBe(2); // 3 columns would be 225 px cards
  });

  it('never makes a card narrower than the minimum, and avoids a lonely card when it can', () => {
    for (let width = 300; width <= 1900; width += 10)
      for (let count = 1; count <= 9; count++) {
        const cols = floorColumns(width, count);
        expect(cols).toBeGreaterThanOrEqual(1);
        expect(cols).toBeLessThanOrEqual(count);
        if (cols > 1) expect(cardWidth(width, cols)).toBeGreaterThanOrEqual(300);
        // narrower than the minimum only to save a card from sitting alone
        if (cols > 1 && cardWidth(width, cols) < FLOOR_MIN) expect(!alone(count, cols) && alone(count, cols - 1)).toBe(true);
      }
  });
});

describe('statusLine', () => {
  const base = { connected: true, loaded: true, restarting: false, update: null };

  it('says nothing while connected and up to date', () => {
    expect(statusLine(base)).toBeNull();
  });

  it('one line through an update: updating, then back in a moment, never also a reconnect', () => {
    expect(statusLine({ ...base, update: '⟳ Updating the office…' })?.text).toBe('⟳ Updating the office…');
    expect(statusLine({ ...base, connected: false, restarting: true, update: '⟳ Updating the office…' })).toEqual({ text: 'Back in a moment…', bad: false, icon: 'refresh-cw' });
  });

  it('a drop nobody expected is a reconnect', () => {
    expect(statusLine({ ...base, connected: false })).toEqual({ text: 'Reconnecting to the office…', bad: true, icon: 'radio-tower' });
    expect(statusLine({ ...base, connected: false, loaded: false })?.text).toBe('Connecting to the office…');
  });
});
