import { describe, expect, it } from 'vitest';
import { cleanTouchPrefs, controlTop, decayFling, easeAngle, easeToward, flingVelocity, gyroTurn, isDoubleTap, LEVEL_PITCH, pinchZoom, STICK_RADIUS, stickRest, thumbZone, touchCamera, TOUCH_DEFAULTS, trackLook, ZOOM_MAX, type LookTrail, type TouchCamInput } from './thumbs';

const phone = { width: 390, top: 0, height: 844 };
const wide = { width: 844, top: 0, height: 390 };
const zones = (p = {}) => ({ ...TOUCH_DEFAULTS, ...p });

describe('thumb zones (#123)', () => {
  it('portrait: the bottom 45% is the thumbs\', the stick lower-left, the look lower-right, the world above', () => {
    expect(controlTop(phone)).toBeCloseTo(464.2);
    expect(thumbZone(60, 800, phone, zones())).toBe('stick');
    expect(thumbZone(194, 500, phone, zones())).toBe('stick');
    expect(thumbZone(196, 500, phone, zones())).toBe('look');
    expect(thumbZone(330, 800, phone, zones())).toBe('look');
    expect(thumbZone(60, 400, phone, zones())).toBe('world');
    expect(thumbZone(330, 100, phone, zones())).toBe('world');
  });

  it('swapping the stick side swaps the corners', () => {
    expect(thumbZone(60, 800, phone, zones({ stickSide: 'right' }))).toBe('look');
    expect(thumbZone(330, 800, phone, zones({ stickSide: 'right' }))).toBe('stick');
  });

  it('one thumb: the stick with a look strip above it on its side, the other side the world', () => {
    const p = zones({ oneThumb: true, stickSide: 'right' });
    expect(thumbZone(330, 800, phone, p)).toBe('stick');
    expect(thumbZone(330, 480, phone, p)).toBe('look');
    expect(thumbZone(60, 800, phone, p)).toBe('world');
  });

  it('landscape: wider control area, thumbs at the sides and the middle the world\'s', () => {
    expect(thumbZone(100, 300, wide, zones())).toBe('stick');
    expect(thumbZone(750, 300, wide, zones())).toBe('look');
    expect(thumbZone(422, 300, wide, zones())).toBe('world');
    expect(thumbZone(100, 120, wide, zones())).toBe('world');
  });

  it('classic halves is #83\'s split: top looks, bottom walks, anywhere across', () => {
    const p = zones({ classic: true });
    expect(thumbZone(330, 800, phone, p)).toBe('stick');
    expect(thumbZone(60, 300, phone, p)).toBe('look');
  });

  it('respects the visible part of the page', () => {
    expect(thumbZone(60, 420, { width: 390, top: 100, height: 600 }, zones())).toBe('world');
    expect(thumbZone(60, 440, { width: 390, top: 100, height: 600 }, zones())).toBe('stick');
  });

  it('the ghost rests in its zone, on screen, sized by the stick size', () => {
    const r = stickRest(phone, zones());
    expect(thumbZone(r.x, r.y, phone, zones())).toBe('stick');
    expect(r.y + STICK_RADIUS.medium).toBeLessThan(844);
    const right = stickRest(phone, zones({ stickSide: 'right', stickSize: 'large' }));
    expect(thumbZone(right.x, right.y, phone, zones({ stickSide: 'right' }))).toBe('stick');
    expect(right.x + STICK_RADIUS.large).toBeLessThan(390);
  });
});

describe('touch settings', () => {
  it('defaults: thumb zones, the stick on the left, camera follow on, gyro off', () => {
    expect(cleanTouchPrefs(null)).toEqual({ sensitivity: 1, invertY: false, follow: true, stickSide: 'left', stickSize: 'medium', gyro: false, oneThumb: false, classic: false });
  });

  it('keeps an older device\'s saved sensitivity, clamps it, and drops junk', () => {
    expect(cleanTouchPrefs({ sensitivity: 2 }).sensitivity).toBe(2);
    expect(cleanTouchPrefs({ sensitivity: 99 }).sensitivity).toBe(3);
    expect(cleanTouchPrefs({ stickSide: 'up', stickSize: 'huge', gyro: 'yes', classic: true })).toMatchObject({ stickSide: 'left', stickSize: 'medium', gyro: false, classic: true });
  });
});

describe('the look fling', () => {
  it('a fast swipe let go keeps its speed; one that stopped first flings nothing', () => {
    const t: LookTrail = [];
    for (let i = 0; i <= 5; i++) trackLook(t, 10, 0, i * 16);
    expect(flingVelocity(t, 80).x).toBeCloseTo(50 / 0.08, 0);
    expect(flingVelocity(t, 300)).toEqual({ x: 0, y: 0 });
  });

  it('slows down and stops', () => {
    const v = decayFling({ x: 1000, y: 0 }, 0.15);
    expect(v.x).toBeCloseTo(1000 / Math.E);
    expect(decayFling({ x: 31, y: 0 }, 0.1)).toEqual({ x: 0, y: 0 });
  });
});

describe('the camera', () => {
  it('eases toward a target and snaps when close, the same over one frame or two', () => {
    expect(easeToward(0, 1, 0.1, 10)).toBeCloseTo(1 - Math.exp(-1));
    expect(easeToward(easeToward(0, 1, 0.05, 10), 1, 0.05, 10)).toBeCloseTo(easeToward(0, 1, 0.1, 10));
    expect(easeToward(0.9995, 1, 0.01, 1)).toBe(1);
  });

  it('turns the short way round', () => {
    expect(easeAngle(3, -3, 0.1, 10)).toBeGreaterThan(3);
  });

  const input = (p: Partial<TouchCamInput> = {}): TouchCamInput => ({ lookX: 0, lookY: 0, flingX: 0, flingY: 0, looking: false, recentre: false, gyroYaw: 0, gyroPitch: 0, ...p });
  const lim = { min: -1.35, max: 1.35 };

  it('walking with follow on levels the view and turns toward a tap walk\'s heading; off, it leaves it', () => {
    const look = { yaw: 0, pitch: -0.8 };
    touchCamera(look, input(), true, 0.1, true, 1, lim);
    expect(look.pitch).toBeGreaterThan(-0.8);
    expect(look.yaw).toBeGreaterThan(0);
    const off = { yaw: 0, pitch: -0.8 };
    touchCamera(off, input(), false, 0.1, true, 1, lim);
    expect(off).toEqual({ yaw: 0, pitch: -0.8 });
  });

  it('a look finger down wins over the follow', () => {
    const look = { yaw: 0, pitch: -0.8 };
    touchCamera(look, input({ looking: true }), true, 0.1, true, 1, lim);
    expect(look).toEqual({ yaw: 0, pitch: -0.8 });
  });

  it('a double tap recentres to level, then stops', () => {
    const look = { yaw: 0, pitch: 0.9 };
    const i = input({ recentre: true });
    for (let n = 0; n < 60 && i.recentre; n++) touchCamera(look, i, false, 0.016, false, null, lim);
    expect(look.pitch).toBe(LEVEL_PITCH);
    expect(i.recentre).toBe(false);
  });

  it('a fling adds look pixels, the gyro turns the view', () => {
    const look = { yaw: 0, pitch: 0 };
    const i = input({ flingX: 600, gyroYaw: 0.1, gyroPitch: 2 });
    touchCamera(look, i, false, 0.016, false, null, lim);
    expect(i.lookX).toBeCloseTo(9.6);
    expect(look).toEqual({ yaw: 0.1, pitch: 1.35 });
    expect(i.gyroYaw).toBe(0);
  });

  it('double tap: close in time and place', () => {
    expect(isDoubleTap({ x: 300, y: 700, t: 0 }, 310, 705, 250)).toBe(true);
    expect(isDoubleTap({ x: 300, y: 700, t: 0 }, 310, 705, 400)).toBe(false);
    expect(isDoubleTap({ x: 300, y: 700, t: 0 }, 380, 705, 100)).toBe(false);
    expect(isDoubleTap(null, 0, 0, 0)).toBe(false);
  });

  it('pinch zoom stays between 1× and the max', () => {
    expect(pinchZoom(1, 1.5)).toBe(1.5);
    expect(pinchZoom(1, 0.5)).toBe(1);
    expect(pinchZoom(2, 5)).toBe(ZOOM_MAX);
    expect(pinchZoom(2, NaN)).toBe(2);
  });

  it('gyro: turning and tilting the phone, a flip ignored', () => {
    const a = { alpha: 10, beta: 90, gamma: 0 };
    expect(gyroTurn(a, { alpha: 12, beta: 91, gamma: 0 }, 0).yaw).toBeCloseTo((2 * Math.PI) / 180);
    expect(gyroTurn({ ...a, alpha: 359 }, { ...a, alpha: 1 }, 0).yaw).toBeCloseTo((2 * Math.PI) / 180);
    expect(gyroTurn(a, { alpha: 10, beta: 150, gamma: 0 }, 0)).toEqual({ yaw: 0, pitch: 0 });
  });
});
