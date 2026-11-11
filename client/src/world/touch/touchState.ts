// Touch input for the 3D view, shared: TouchControls.tsx writes it from the fingers, Player.tsx reads the stick and
// the look like the gamepad's, TouchStick.tsx draws the ring and HoldMenu.tsx the hold menu. The touch settings
// (Help → Controls → Touch; thumbs.ts) and whether the zones' hints were used are saved in this browser.

import { create } from 'zustand';
import type { Focus } from '../../store';
import { cleanTouchPrefs, TOUCH_DEFAULTS, type TouchPrefs } from './thumbs';
import { gateAllows } from '../../ui/tourGate';

/** A touch-only screen (phones, tablets): the only devices that get the touch controls. */
export const isTouch = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

/**
 * The stick (x right, y down, -1 to 1), running, look pixels not yet turned into a view turn, the fling a look drag
 * left (px/s), a look finger down, a double tap's recentring, the pinch's zoom and the gyro's turn not yet applied (radians).
 */
export const touchInput = { x: 0, y: 0, run: false, lookX: 0, lookY: 0, flingX: 0, flingY: 0, looking: false, recentre: false, zoom: 1, gyroYaw: 0, gyroPitch: 0 };

/** A pixel of look drag turns this many radians at sensitivity 1. */
export const TOUCH_LOOK = 0.006;

interface StickView {
  /** The ring while a finger walks: its centre, radius and the knob's offset, CSS pixels. */
  ring: { cx: number; cy: number; r: number; kx: number; ky: number; run: boolean } | null;
  /** A held press that will open the menu when it lifts. */
  armed: { x: number; y: number } | null;
  /** Walked, looked around and walked by a tap at least once on this device (each zone's hint goes away). */
  walked: boolean;
  looked: boolean;
  tapped: boolean;
}

const HINTS = 'cubefarm:touch-hints';

function loadHints(): { walked: boolean; looked: boolean; tapped: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(HINTS) ?? 'null') as { walked?: unknown; looked?: unknown; tapped?: unknown } | null;
    return { walked: v?.walked === true, looked: v?.looked === true, tapped: v?.tapped === true };
  } catch {
    return { walked: false, looked: false, tapped: false };
  }
}

export const useTouchStick = create<StickView>(() => ({ ring: null, armed: null, ...(typeof window === 'undefined' ? { walked: false, looked: false, tapped: false } : loadHints()) }));

/** The first walk, look or tap's walk: that zone's hint goes away, on this device for good. */
export function markUsed(what: 'walked' | 'looked' | 'tapped') {
  useTouchStick.setState({ [what]: true });
  const { walked, looked, tapped } = useTouchStick.getState();
  try {
    localStorage.setItem(HINTS, JSON.stringify({ walked, looked, tapped }));
  } catch {
    // lasts for this visit
  }
}

export const useHoldMenu = create<{ focus: Focus | null }>(() => ({ focus: null }));

/** Opens the hold menu for `focus`, with a light buzz where the phone can, unless the tour's step says no. */
export function openHoldMenu(focus: Focus) {
  if (!gateAllows({ kind: 'hold' })) return; // the tour owns the screen (#406)
  try {
    navigator.vibrate?.(12);
  } catch {
    // some browsers throw without a user gesture
  }
  useHoldMenu.setState({ focus });
}

export const closeHoldMenu = () => useHoldMenu.setState({ focus: null });

const KEY = 'cubefarm:touch';

function loadPrefs(): TouchPrefs {
  try {
    return cleanTouchPrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return TOUCH_DEFAULTS;
  }
}

/** The touch settings (thumbs.ts's TouchPrefs), this device's. */
export const useTouchLook = create<TouchPrefs>(() => (typeof window === 'undefined' ? TOUCH_DEFAULTS : loadPrefs()));

export function setTouchPrefs(patch: Partial<TouchPrefs>) {
  const next = cleanTouchPrefs({ ...useTouchLook.getState(), ...patch });
  useTouchLook.setState(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // lasts for this visit
  }
}

/** Asks for motion access where the browser wants a tap's say-so first (iOS); true when tilting can be read. */
export async function requestGyro(): Promise<boolean> {
  const D = (typeof DeviceOrientationEvent === 'undefined' ? null : DeviceOrientationEvent) as unknown as { requestPermission?: () => Promise<string> } | null;
  if (!D) return false;
  if (typeof D.requestPermission !== 'function') return true;
  try {
    return (await D.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}
