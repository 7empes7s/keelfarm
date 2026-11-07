import { describe, expect, it } from 'vitest';
import { DESKTOP_PROFILE, deviceProfile, LAB_GFX, LAB_GFX_LIMITS, labGraphics, labProfile, PHONE_PROFILE } from './device';

describe('the phone graphics profile', () => {
  it('goes to touch-only and phone-sized screens', () => {
    expect(deviceProfile({ touchOnly: true, width: 390, height: 844 })).toBe(PHONE_PROFILE);
    expect(deviceProfile({ touchOnly: true, width: 1024, height: 1366 })).toBe(PHONE_PROFILE); // a tablet
    expect(deviceProfile({ touchOnly: false, width: 844, height: 390 })).toBe(PHONE_PROFILE); // a phone with a mouse
  });

  it('leaves a desktop as it was', () => {
    expect(deviceProfile({ touchOnly: false, width: 1280, height: 800 })).toBe(DESKTOP_PROFILE);
    expect(deviceProfile({ touchOnly: false, width: 800, height: 450 })).toBe(DESKTOP_PROFILE); // the e2e window
    expect(DESKTOP_PROFILE).toEqual({ phone: false, maxDpr: 1.75, maxTier: 'high', shadowMap: 2048 });
  });

  it('draws a phone lighter: lower pixel ratio, no post-processing on Auto, smaller shadows', () => {
    expect(PHONE_PROFILE.maxDpr).toBeLessThan(DESKTOP_PROFILE.maxDpr);
    expect(PHONE_PROFILE.maxTier).toBe('low');
    expect(PHONE_PROFILE.shadowMap).toBeLessThan(DESKTOP_PROFILE.shadowMap);
  });
});

describe("the test lab's graphics profile (#301)", () => {
  it('is on only for ?gfx=lab or the lab browser\'s flag', () => {
    expect(labGraphics('?gfx=lab', undefined)).toBe(true);
    expect(labGraphics('?stats&gfx=lab', undefined)).toBe(true);
    expect(labGraphics('', true)).toBe(true);
    expect(labGraphics('', undefined)).toBe(false);
    expect(labGraphics('?gfx=high', 'yes')).toBe(false);
    expect(LAB_GFX).toBe(false); // real viewers (and these tests) draw as always
  });

  it('draws at the lowest cost: pixel ratio 1, no post-processing, small shadows, 30 fps, few visitors', () => {
    for (const base of [DESKTOP_PROFILE, PHONE_PROFILE]) {
      const lab = labProfile(base);
      expect(lab.maxDpr).toBeLessThanOrEqual(1);
      expect(lab.maxTier).toBe('low');
      expect(lab.shadowMap).toBeLessThan(base.shadowMap);
      expect(lab.phone).toBe(base.phone); // same layout: a phone stays a phone
    }
    expect(LAB_GFX_LIMITS).toEqual({ fps: 30, visitors: 4 });
  });
});
