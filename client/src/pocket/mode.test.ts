import { describe, expect, it } from 'vitest';
import { pickMode } from './mode';

describe('pocket mode', () => {
  const screen = { narrow: false, touch: false, saved: null, param: null };

  it('is picked on narrow or touch-only screens', () => {
    expect(pickMode(screen)).toBe('office');
    expect(pickMode({ ...screen, narrow: true })).toBe('pocket');
    expect(pickMode({ ...screen, touch: true })).toBe('pocket');
  });

  it("follows this device's own choice over the screen", () => {
    expect(pickMode({ ...screen, narrow: true, saved: 'office' })).toBe('office');
    expect(pickMode({ ...screen, saved: 'pocket' })).toBe('pocket');
    expect(pickMode({ ...screen, narrow: true, saved: 'nonsense' })).toBe('pocket');
  });

  it('follows ?pocket in the URL over everything', () => {
    expect(pickMode({ ...screen, param: '' })).toBe('pocket');
    expect(pickMode({ ...screen, param: '1' })).toBe('pocket');
    expect(pickMode({ ...screen, narrow: true, saved: 'pocket', param: '0' })).toBe('office');
    expect(pickMode({ ...screen, param: 'false' })).toBe('office');
  });

  it('goes back to pocket mode after the 3D office crashed while starting, whatever this device chose', () => {
    expect(pickMode({ ...screen, saved: 'office', crashed: true })).toBe('pocket');
    expect(pickMode({ ...screen, crashed: true })).toBe('pocket');
    expect(pickMode({ ...screen, saved: 'office', crashed: false })).toBe('office');
    expect(pickMode({ ...screen, crashed: true, param: '0' })).toBe('office'); // the URL still decides one visit
  });
});
