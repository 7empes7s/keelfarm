import { describe, expect, it } from 'vitest';
import { FLOOR_THEME_INFO } from '../../../shared/floorThemes';
import { plateTint, scrollToShow } from './floorPlates';

describe('floor picker plates', () => {
  it('tint each plate with its floor theme, the plain office for an unknown one', () => {
    expect(plateTint('game-studio')).toBe(FLOOR_THEME_INFO['game-studio'].swatch[1]);
    expect(plateTint('trading')).toBe(FLOOR_THEME_INFO.trading.swatch[1]);
    for (const raw of [undefined, 'casino']) expect(plateTint(raw)).toBe(FLOOR_THEME_INFO.office.swatch[1]);
  });
});

describe('scrollToShow keeps the picked plate in its row', () => {
  it('leaves the row alone when the plate is already in view', () => {
    expect(scrollToShow(100, 300, 150, 80)).toBe(100);
  });
  it('scrolls left to a plate cut off at the start', () => {
    expect(scrollToShow(100, 300, 40, 80)).toBe(40);
  });
  it('scrolls right just enough for a plate cut off at the end', () => {
    expect(scrollToShow(0, 300, 280, 80)).toBe(60);
  });
  it('shows the start of a plate wider than the row', () => {
    expect(scrollToShow(0, 100, 50, 200)).toBe(50);
  });
});
