import { describe, expect, it } from 'vitest';
import { phoneWindow, stepFont, termFontSize, termGrid, unzoomedFont } from './termLayout';

// The terminal-first window on phones (#86): one header row (~56 px) and one bottom bar (~60 px) around the terminal.
const phoneBox = (width: number, height: number) => termGrid(width, height - 56 - 60, termFontSize(true, width, null));

describe('the agent window on phones', () => {
  it('is terminal first at phone widths or on a touch screen short of a computer', () => {
    expect(phoneWindow(390, true)).toBe(true);
    expect(phoneWindow(700, false)).toBe(true);
    expect(phoneWindow(1024, true)).toBe(true);
    expect(phoneWindow(1024, false)).toBe(false);
    expect(phoneWindow(1280, true)).toBe(false);
    expect(phoneWindow(1440, false)).toBe(false);
  });

  it('uses 11-12 px text on phones and keeps 13 px on a computer', () => {
    expect(termFontSize(false, 1440, null)).toBe(13);
    for (const width of [360, 390, 430]) {
      const size = termFontSize(true, width, null);
      expect(size).toBeGreaterThanOrEqual(11);
      expect(size).toBeLessThanOrEqual(12);
    }
  });

  it('shows at least 40 rows by 50 columns at 390 × 844, and 50 columns from 360 px', () => {
    const grid = phoneBox(390, 844);
    expect(grid.rows).toBeGreaterThanOrEqual(40);
    expect(grid.cols).toBeGreaterThanOrEqual(50);
    expect(phoneBox(360, 780).cols).toBeGreaterThanOrEqual(50);
    expect(phoneBox(430, 932).cols).toBeGreaterThanOrEqual(50);
  });

  it("undoes the phone's UI zoom so the text shows at its size", () => {
    expect(unzoomedFont(12, 100)).toBe(12);
    expect(unzoomedFont(11.5, 115)).toBeCloseTo(10, 5);
  });

  it("keeps the device's A−/A+ choice, within limits", () => {
    expect(termFontSize(true, 390, 15)).toBe(15);
    expect(termFontSize(false, 1440, 9)).toBe(9);
    expect(termFontSize(true, 390, 99)).toBe(20);
    expect(stepFont(12, 1)).toBe(13);
    expect(stepFont(8, -1)).toBe(8);
    expect(stepFont(20, 1)).toBe(20);
  });
});
