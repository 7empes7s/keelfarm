import { describe, expect, it } from 'vitest';
import { DIRECTORY_PX, directoryRowAt, directoryRows, type DirectoryFloor } from './lobbyDirectory';

const floor = (n: number, theme: unknown): DirectoryFloor => ({ floor: n, name: `demo-co/f${n}`, color: '#123456', theme, team: 4, working: 1, prs: 2 });

describe('the lobby directory (#371)', () => {
  it("lists every floor top first with its theme's glyph, name and colour, then the lobby", () => {
    const rows = directoryRows([floor(1, 'office'), floor(3, 'ops-control'), floor(2, 'design-studio')]);
    expect(rows.map((r) => r.floor)).toEqual([3, 2, 1, 0]);
    expect(rows[0]).toMatchObject({ glyph: '🛰️', theme: 'Ops control room', accent: '#22e39b', stats: '1/4 busy · 2 PR' });
    expect(rows[1]).toMatchObject({ theme: 'Design studio', glyph: '🎨' });
    expect(rows[2]).toMatchObject({ theme: 'Office' });
    expect(directoryRows([floor(1, 'casino')])[0].theme).toBe('Office'); // an unknown theme is the plain office
  });

  it('fits every floor on the board however many there are, rows stacked without gaps', () => {
    for (const n of [0, 3, 7, 20]) {
      const rows = directoryRows(Array.from({ length: n }, (_, i) => floor(i + 1, 'trading')));
      expect(rows).toHaveLength(n + 1);
      const last = rows[rows.length - 1];
      expect(last.y + last.h).toBeLessThanOrEqual(DIRECTORY_PX.bottom + 1e-6);
      for (let i = 1; i < rows.length; i++) expect(rows[i].y).toBeCloseTo(rows[i - 1].y + rows[i - 1].h);
      expect(rows[0].h).toBeLessThanOrEqual(DIRECTORY_PX.maxRow);
    }
  });

  it("finds the floor under a tap, and nothing on the board's title", () => {
    const rows = directoryRows([floor(1, 'office'), floor(2, 'media-studio')]);
    const mid = (r: (typeof rows)[number]) => (r.y + r.h / 2) / DIRECTORY_PX.h;
    expect(directoryRowAt(rows, mid(rows[0]))?.floor).toBe(2);
    expect(directoryRowAt(rows, mid(rows[1]))?.floor).toBe(1);
    expect(directoryRowAt(rows, mid(rows[2]))?.floor).toBe(0);
    expect(directoryRowAt(rows, 0.05)).toBeNull();
    expect(directoryRowAt(rows, 0.99)).toBeNull();
  });
});
