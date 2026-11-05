// The phone graphics profile (#79): a touch-only or phone-sized screen opens the 3D office lighter, because
// iOS WebKit kills (and reloads) a tab whose GPU memory runs over, with no error the page can catch. Pure; perf.tsx,
// useGraphics.ts and DayLights.tsx read DEVICE_PROFILE.

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

export const DEVICE_PROFILE: DeviceProfile =
  typeof window === 'undefined' || typeof matchMedia !== 'function'
    ? DESKTOP_PROFILE
    : deviceProfile({
        touchOnly: matchMedia('(hover: none) and (pointer: coarse)').matches,
        width: screen.width,
        height: screen.height,
      });
