// The phone graphics profile (#79): a touch-only or phone-sized screen opens the 3D office lighter, because
// iOS WebKit kills (and reloads) a tab whose GPU memory runs over, with no error the page can catch. Pure; perf.tsx,
// useGraphics.ts and DayLights.tsx read DEVICE_PROFILE. The test lab's profile (#301) draws the same scene and UI at the
// lowest cost, since its headless browser renders in software: `?gfx=lab`, or the lab's own browser (testLabRunner.ts).

import type { Tier } from './quality';

export interface DeviceInfo {
  /** (hover: none) and (pointer: coarse): a phone or tablet. */
  touchOnly: boolean;
  /** The screen in CSS pixels. */
  width: number;
  height: number;
}

export interface DeviceProfile {
  phone: boolean;
  /** The highest pixel ratio the canvas draws at. */
  maxDpr: number;
  /** The highest tier Auto may pick (a preset chosen in Help → Graphics is still honoured). */
  maxTier: Tier;
  /** The sun's shadow map, in texels per side. */
  shadowMap: number;
}

export const DESKTOP_PROFILE: DeviceProfile = { phone: false, maxDpr: 1.75, maxTier: 'high', shadowMap: 2048 };
export const PHONE_PROFILE: DeviceProfile = { phone: true, maxDpr: 1.25, maxTier: 'low', shadowMap: 1024 };

/** A touch-only screen, or one whose short side is phone-sized (430 px or less), gets the phone profile. */
export function deviceProfile(d: DeviceInfo): DeviceProfile {
  return d.touchOnly || Math.min(d.width, d.height) <= 430 ? PHONE_PROFILE : DESKTOP_PROFILE;
}

/**
 * What the lab profile turns down besides labProfile: frames a second and visitors drawn. Shadows, antialiasing and the
 * weather's rain, snow and wet glass are off (Game.tsx, Weather.tsx). The layout, the HUD and every panel stay the same.
 */
export const LAB_GFX_LIMITS = { fps: 30, visitors: 4 } as const;

/** `?gfx=lab`, or the flag the test lab's browser sets before the page loads (window.__swarmLabGfx). */
export function labGraphics(search: string, flag: unknown): boolean {
  return flag === true || new URLSearchParams(search).get('gfx') === 'lab';
}

/** A device's profile in the lab: pixel ratio 1 at most, no post-processing on Auto, the smallest shadow map. */
export function labProfile(p: DeviceProfile): DeviceProfile {
  return { ...p, maxDpr: Math.min(1, p.maxDpr), maxTier: 'low', shadowMap: 512 };
}

/** The test lab's graphics profile is on in this tab. Real viewers never get it. */
export const LAB_GFX = typeof window !== 'undefined' && labGraphics(window.location?.search ?? '', (window as unknown as { __swarmLabGfx?: unknown }).__swarmLabGfx);

const detected: DeviceProfile =
  typeof window === 'undefined' || typeof matchMedia !== 'function'
    ? DESKTOP_PROFILE
    : deviceProfile({
        touchOnly: matchMedia('(hover: none) and (pointer: coarse)').matches,
        width: screen.width,
        height: screen.height,
      });

export const DEVICE_PROFILE: DeviceProfile = LAB_GFX ? labProfile(detected) : detected;
