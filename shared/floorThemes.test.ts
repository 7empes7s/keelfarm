import { describe, expect, it } from 'vitest';
import { cleanFloorTheme, FLOOR_THEME_INFO, FLOOR_THEMES, floorThemeOf } from './floorThemes.ts';

describe('floor themes', () => {
  it('reads missing, old or corrupt themes as the plain office', () => {
    for (const raw of [undefined, null, '', 'casino', 3, {}]) expect(floorThemeOf(raw)).toBe('office');
    for (const t of FLOOR_THEMES) expect(floorThemeOf(t)).toBe(t);
  });

  it('refuses an unknown theme with the ones it could be', () => {
    expect(cleanFloorTheme('trading')).toBe('trading');
    expect(() => cleanFloorTheme('casino')).toThrow(/office, game-studio, trading/);
  });

  it('has a card for every theme', () => {
    expect(Object.keys(FLOOR_THEME_INFO).sort()).toEqual([...FLOOR_THEMES].sort());
  });
});
