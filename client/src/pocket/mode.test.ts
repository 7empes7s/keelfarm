import { describe, expect, it } from 'vitest';
import { otherMode, pickLayout, pickMode } from './mode';

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

describe("pocket mode's layout (#104)", () => {
  const at = (width: number, touch = false, height = 800) => pickLayout({ width, height, touch });

  it('is the phone layout up to 760 px, the rail from 761 px and side by side from 1024 px', () => {
    expect([360, 390, 430, 760].map((w) => at(w))).toEqual(['compact', 'compact', 'compact', 'compact']);
    expect([761, 900, 1023].map((w) => at(w))).toEqual(['medium', 'medium', 'medium']);
    expect([1024, 1280, 1920].map((w) => at(w))).toEqual(['expanded', 'expanded', 'expanded']);
  });

  it('keeps touch-only screens on the phone layout until they are a tablet (#212)', () => {
    expect(at(390, true)).toBe('compact');
    expect(at(766, true)).toBe('compact');
    expect(at(820, true, 1180)).toBe('medium'); // an iPad upright: the rail, the chat a drawer
    expect(at(932, true, 430)).toBe('compact'); // a big phone on its side
    expect(at(1180, true, 820)).toBe('expanded'); // the iPad sideways: the chat docked
    expect(at(1366, true)).toBe('expanded');
  });

  it('switches between the two offices', () => {
    expect(otherMode('pocket')).toBe('office');
    expect(otherMode('office')).toBe('pocket');
  });
});
