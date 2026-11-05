// Touch input for the 3D view, shared: TouchControls.tsx writes it from the fingers, Player.tsx reads the stick and
// the look like the gamepad's, TouchStick.tsx draws the ring and HoldMenu.tsx the hold menu. The look sensitivity
// (Help → Controls → Touch) and whether the split screen's hints were used are saved in this browser.

import { create } from 'zustand';
import type { Focus } from '../../store';

/** A touch-only screen (phones, tablets): the only devices that get the touch controls. */
export const isTouch = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

/** The stick (x right, y down, -1 to 1), running, and look pixels not yet turned into a view turn. */
export const touchInput = { x: 0, y: 0, run: false, lookX: 0, lookY: 0 };

/** A pixel of look drag turns this many radians at sensitivity 1. */
export const TOUCH_LOOK = 0.006;
export const TOUCH_SENS_MIN = 0.25;
export const TOUCH_SENS_MAX = 3;

interface StickView {
  /** The ring while a finger walks: its centre and the knob's offset, CSS pixels. */
  ring: { cx: number; cy: number; kx: number; ky: number; run: boolean } | null;
  /** A held press that will open the menu when it lifts. */
  armed: { x: number; y: number } | null;
  /** Walked, and looked around, at least once on this device (each half's hint goes away). */
  walked: boolean;
  looked: boolean;
}

const HINTS = 'cubefarm:touch-hints';

function loadHints(): { walked: boolean; looked: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(HINTS) ?? 'null') as { walked?: unknown; looked?: unknown } | null;
    return { walked: v?.walked === true, looked: v?.looked === true };
  } catch {
    return { walked: false, looked: false };
  }
}

export const useTouchStick = create<StickView>(() => ({ ring: null, armed: null, ...(typeof window === 'undefined' ? { walked: false, looked: false } : loadHints()) }));

/** The first walk or look: that half's hint goes away, on this device for good. */
export function markUsed(what: 'walked' | 'looked') {
  useTouchStick.setState({ [what]: true });
  const { walked, looked } = useTouchStick.getState();
  try {
    localStorage.setItem(HINTS, JSON.stringify({ walked, looked }));
  } catch {
    // lasts for this visit
  }
}

export const useHoldMenu = create<{ focus: Focus | null }>(() => ({ focus: null }));

/** Opens the hold menu for `focus`, with a light buzz where the phone can. */
export function openHoldMenu(focus: Focus) {
  try {
    navigator.vibrate?.(12);
  } catch {
    // some browsers throw without a user gesture
  }
  useHoldMenu.setState({ focus });
}

export const closeHoldMenu = () => useHoldMenu.setState({ focus: null });

const KEY = 'cubefarm:touch';

function loadSensitivity(): number {
  try {
    const v = (JSON.parse(localStorage.getItem(KEY) ?? 'null') as { sensitivity?: unknown } | null)?.sensitivity;
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(TOUCH_SENS_MAX, Math.max(TOUCH_SENS_MIN, v)) : 1;
  } catch {
    return 1;
  }
}

export const useTouchLook = create<{ sensitivity: number }>(() => ({ sensitivity: typeof window === 'undefined' ? 1 : loadSensitivity() }));

export function setTouchSensitivity(v: number) {
  const sensitivity = Math.min(TOUCH_SENS_MAX, Math.max(TOUCH_SENS_MIN, v));
  useTouchLook.setState({ sensitivity });
  try {
    localStorage.setItem(KEY, JSON.stringify({ sensitivity }));
  } catch {
    // lasts for this visit
  }
}
