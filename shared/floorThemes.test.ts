import { describe, expect, it } from 'vitest';
import { cleanFloorTheme, FLOOR_THEME_INFO, FLOOR_THEMES, floorThemeOf, themeAfterUseCase, themeForUseCase, upgradeFloorTheme } from './floorThemes.ts';
import { USE_CASES } from './useCases.ts';

describe('floor themes', () => {
  it('reads missing, old or corrupt themes as the plain office', () => {
    for (const raw of [undefined, null, '', 'casino', 3, {}]) expect(floorThemeOf(raw)).toBe('office');
    for (const t of FLOOR_THEMES) expect(floorThemeOf(t)).toBe(t);
  });

  it('refuses an unknown theme with the ones it could be', () => {
    expect(cleanFloorTheme('trading')).toBe('trading');
    expect(() => cleanFloorTheme('casino')).toThrow(/office, game-studio, trading, design-studio, media-studio, research-lab, ops-control, newsroom/);
  });

  it('has a card for every theme', () => {
    expect(Object.keys(FLOOR_THEME_INFO).sort()).toEqual([...FLOOR_THEMES].sort());
  });

  it('maps each use case to its theme, the rest to the office (#528)', () => {
    expect(themeForUseCase('video')).toBe('media-studio');
    expect(themeForUseCase('game-3d')).toBe('game-studio');
    expect(themeForUseCase('design')).toBe('design-studio');
    expect(themeForUseCase('research')).toBe('research-lab');
    expect(themeForUseCase('ops')).toBe('ops-control');
    expect(themeForUseCase('marketing')).toBe('newsroom');
    for (const u of ['web-app', 'api', 'static-site', 'cli-library', 'mobile'] as const) expect(themeForUseCase(u)).toBe('office');
    for (const u of USE_CASES) expect(FLOOR_THEMES).toContain(themeForUseCase(u.id));
  });

  it('dresses a news site, an editorial tool or a blog as the newsroom when its use case has no look of its own (#570)', () => {
    expect(themeForUseCase('static-site', { fullName: 'acme/dev-blog' })).toBe('newsroom');
    expect(themeForUseCase('web-app', { fullName: 'acme/site', description: 'The editorial calendar for our news desk' })).toBe('newsroom');
    expect(themeForUseCase('web-app', { fullName: 'acme/shop', mission: 'Sell more socks' })).toBe('office');
    expect(themeForUseCase('game-3d', { fullName: 'acme/news-game' })).toBe('game-studio'); // a use case's own look wins
    expect(themeAfterUseCase({ fullName: 'acme/daily-headlines', themeByHand: false }, 'static-site')).toBe('newsroom');
    expect(upgradeFloorTheme({ fullName: 'acme/newsletter', setup: { useCase: 'web-app', guessed: false } })).toEqual({ theme: 'newsroom', themeByHand: false });
  });

  it("follows the use case until the manager picks a theme by hand", () => {
    expect(themeAfterUseCase({ theme: 'office', themeByHand: false }, 'video')).toBe('media-studio');
    expect(themeAfterUseCase({ theme: 'media-studio', themeByHand: false }, 'api')).toBe('office');
    expect(themeAfterUseCase({ theme: 'office', themeByHand: true }, 'video')).toBe('office');
    expect(themeAfterUseCase({ theme: 'trading', themeByHand: true }, 'game-3d')).toBe('trading');
  });

  it('upgrades old floors once: a saved theme was a hand pick, a confirmed use case maps, a guess is skipped', () => {
    expect(upgradeFloorTheme({ setup: { useCase: 'video', guessed: false } })).toEqual({ theme: 'media-studio', themeByHand: false });
    expect(upgradeFloorTheme({ setup: { useCase: 'game-3d', guessed: true } })).toEqual({ theme: undefined, themeByHand: false });
    expect(upgradeFloorTheme({})).toEqual({ theme: undefined, themeByHand: false });
    expect(upgradeFloorTheme({ theme: 'office', setup: { useCase: 'video', guessed: false } })).toEqual({ theme: 'office', themeByHand: true });
    // already upgraded: left alone, so a later restart never re-maps or re-marks it
    expect(upgradeFloorTheme({ theme: 'media-studio', themeByHand: false, setup: { useCase: 'api', guessed: false } })).toEqual({ theme: 'media-studio', themeByHand: false });
    expect(upgradeFloorTheme({ themeByHand: true, setup: { useCase: 'video', guessed: false } })).toEqual({ theme: undefined, themeByHand: true });
  });
});
