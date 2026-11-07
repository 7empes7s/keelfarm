// The phone's thumb zones (#123), pure: where a finger lands decides what it does, sized for the typing grip.
// The bottom of the screen is the control area: the stick's side (lower-left by default) walks with a floating
// joystick, the other side looks; above it is the world, where a tap walks to what it hits and a drag still looks.
// "One thumb" puts the stick and a look strip above it on the same side; "classic halves" is #83's split (gestures.ts).
// Also here: the touch settings, the look fling, the camera's easing and double-tap recentring.

import { zoneAt, type Zone } from './gestures';

export type StickSide = 'left' | 'right';
export type StickSize = 'small' | 'medium' | 'large';

/** Help → Controls → Touch, saved per device. */
export interface TouchPrefs {
  /** Look drag speed, 0.25-3. */
  sensitivity: number;
  invertY: boolean;
  /** While walking, the view eases back to level (and turns your way on a tap-to-walk). */
  follow: boolean;
  stickSide: StickSide;
  stickSize: StickSize;
  /** Tilting the phone looks around too (DeviceOrientation). */
  gyro: boolean;
  /** The stick and a look strip on the stick's side, for one hand. */
  oneThumb: boolean;
  /** #83's split screen: the top half looks, the bottom half walks, no tap-to-walk. */
  classic: boolean;
}

export const TOUCH_SENS_MIN = 0.25;
export const TOUCH_SENS_MAX = 3;

export const TOUCH_DEFAULTS: TouchPrefs = { sensitivity: 1, invertY: false, follow: true, stickSide: 'left', stickSize: 'medium', gyro: false, oneThumb: false, classic: false };

/** The joystick ring's radius for each size, CSS pixels. */
export const STICK_RADIUS: Record<StickSize, number> = { small: 44, medium: 56, large: 72 };

/** Saved prefs (or anything else) made safe: unknown or broken fields take their defaults. */
export function cleanTouchPrefs(raw: unknown): TouchPrefs {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof TouchPrefs) => (typeof v[k] === 'boolean' ? (v[k] as boolean) : (TOUCH_DEFAULTS[k] as boolean));
  const s = v.sensitivity;
  return {
    sensitivity: typeof s === 'number' && Number.isFinite(s) ? Math.min(TOUCH_SENS_MAX, Math.max(TOUCH_SENS_MIN, s)) : TOUCH_DEFAULTS.sensitivity,
    invertY: bool('invertY'),
    follow: bool('follow'),
    stickSide: v.stickSide === 'right' ? 'right' : 'left',
    stickSize: v.stickSize === 'small' || v.stickSize === 'large' ? v.stickSize : 'medium',
    gyro: bool('gyro'),
    oneThumb: bool('oneThumb'),
    classic: bool('classic'),
  };
}

// ---------- zones ----------

/** The visible part of the page, CSS pixels. */
export interface Screen {
  width: number;
  top: number;
  height: number;
}

/** What a finger landing there does: walk, look, or (above the control area) tap the world. */
export type ThumbZone = Zone | 'world';

const landscape = (s: Screen) => s.width > s.height;

/** Where the control area starts: the bottom 45% of a portrait screen, 60% of a landscape one's. */
export const controlTop = (s: Screen) => s.top + s.height * (landscape(s) ? 0.4 : 0.55);

/** The share of the width each thumb's zone takes from its edge: half in portrait, 40% in landscape (the middle is the world's). */
const sideShare = (s: Screen) => (landscape(s) ? 0.4 : 0.5);

/** Which side of the screen x is on, or null in landscape's middle. */
function sideOf(x: number, s: Screen): StickSide | null {
  const k = sideShare(s);
  if (x < s.width * k) return 'left';
  if (x >= s.width * (1 - k)) return 'right';
  return null;
}

/** The zone a finger landing at (x, y) is in. */
export function thumbZone(x: number, y: number, s: Screen, p: Pick<TouchPrefs, 'classic' | 'oneThumb' | 'stickSide'>): ThumbZone {
  if (p.classic) return zoneAt(y, s);
  const top = controlTop(s);
  if (y < top) return 'world';
  const side = sideOf(x, s);
  if (!side) return 'world';
  if (!p.oneThumb) return side === p.stickSide ? 'stick' : 'look';
  if (side !== p.stickSide) return 'world';
  // one thumb: the look strip is the control area's upper third, the stick below it
  return y < top + (s.top + s.height - top) / 3 ? 'look' : 'stick';
}

/** Where the idle stick's ghost rests: the middle of its zone's lower part, kept on screen. */
export function stickRest(s: Screen, p: Pick<TouchPrefs, 'stickSide' | 'stickSize'>): { x: number; y: number } {
  const r = STICK_RADIUS[p.stickSize];
  const k = sideShare(s);
  const x = Math.max(r + 16, s.width * k * 0.5);
  return { x: p.stickSide === 'left' ? x : s.width - x, y: s.top + s.height - r - 28 };
}

/** Where the first-time hints go, as percentages of the screen: the stick's zone, the look zone and the world. */
export function zoneHints(s: Screen, p: Pick<TouchPrefs, 'classic' | 'oneThumb' | 'stickSide' | 'stickSize'>): { move: [number, number]; look: [number, number]; world: [number, number] | null } {
  const pc = (x: number, y: number): [number, number] => [(x / s.width) * 100, ((y - s.top) / s.height) * 100];
  if (p.classic) return { move: [50, 75], look: [50, 25], world: null };
  const rest = stickRest(s, p);
  const top = controlTop(s);
  const move = pc(rest.x, rest.y - STICK_RADIUS[p.stickSize] - 24);
  const look = p.oneThumb ? pc(rest.x, top + (s.top + s.height - top) / 6) : pc(s.width - rest.x, rest.y - STICK_RADIUS[p.stickSize] - 24);
  return { move, look, world: [50, ((top - s.top) / s.height) * 50] };
}

// ---------- the look fling ----------

/** A look drag's last moves, for its fling when the finger lets go. */
export type LookTrail = { dx: number; dy: number; t: number }[];

/** Only this recent a stretch of the drag counts for the fling, ms; a finger that stopped first flings nothing. */
const FLING_WINDOW_MS = 80;
/** The fling's speed falls by e every this many seconds. */
const FLING_TAU = 0.15;
/** Slower than this (px/s), the fling stops. */
const FLING_MIN = 30;

export function trackLook(trail: LookTrail, dx: number, dy: number, t: number) {
  trail.push({ dx, dy, t });
  while (trail.length && t - trail[0].t > FLING_WINDOW_MS) trail.shift();
}

/** The look speed (px/s) a finger lifting at `t` leaves behind. */
export function flingVelocity(trail: LookTrail, t: number): { x: number; y: number } {
  const recent = trail.filter((m) => t - m.t <= FLING_WINDOW_MS);
  if (recent.length < 2) return { x: 0, y: 0 };
  const span = Math.max(16, t - recent[0].t) / 1000;
  const sum = recent.slice(1).reduce((a, m) => ({ x: a.x + m.dx, y: a.y + m.dy }), { x: 0, y: 0 });
  return { x: sum.x / span, y: sum.y / span };
}

/** The fling a frame later: slowed, or stopped once it's slow. */
export function decayFling(v: { x: number; y: number }, dt: number): { x: number; y: number } {
  const k = Math.exp(-dt / FLING_TAU);
  const x = v.x * k;
  const y = v.y * k;
  return Math.hypot(x, y) < FLING_MIN ? { x: 0, y: 0 } : { x, y };
}

// ---------- the camera's easing ----------

/** The pitch the view eases back to while walking, and a double tap recentres on. */
export const LEVEL_PITCH = -0.05;

/** `from` moved toward `to` at `rate` per second (frame-rate independent), snapping when close. */
export function easeToward(from: number, to: number, dt: number, rate: number): number {
  const next = from + (to - from) * (1 - Math.exp(-dt * rate));
  return Math.abs(to - next) < 0.001 ? to : next;
}

/** Like easeToward for an angle: it turns the short way round. */
export function easeAngle(from: number, to: number, dt: number, rate: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return easeToward(from, from + d, dt, rate);
}

/** Two taps this close in time and place are a double tap. */
const DOUBLE_TAP = { ms: 300, px: 40 } as const;

export const isDoubleTap = (prev: { x: number; y: number; t: number } | null, x: number, y: number, t: number) =>
  !!prev && t - prev.t <= DOUBLE_TAP.ms && Math.hypot(x - prev.x, y - prev.y) <= DOUBLE_TAP.px;

/** Pinching zooms the view in, between 1× and this. */
export const ZOOM_MAX = 2.5;

export const pinchZoom = (zoom: number, scale: number) => (Number.isFinite(scale) && scale > 0 ? Math.min(ZOOM_MAX, Math.max(1, zoom * scale)) : zoom);

/** A phone's tilt between two DeviceOrientation readings (degrees) as a view turn (radians); a jump (a flip past straight up) is none. */
export function gyroTurn(prev: { alpha: number; beta: number; gamma: number }, cur: { alpha: number; beta: number; gamma: number }, screenAngle: number): { yaw: number; pitch: number } {
  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
  const yaw = wrap(cur.alpha - prev.alpha);
  const side = Math.abs(screenAngle) === 90;
  const pitch = side ? (cur.gamma - prev.gamma) * (screenAngle === 90 ? -1 : 1) : cur.beta - prev.beta;
  if (Math.abs(yaw) > 20 || Math.abs(pitch) > 20) return { yaw: 0, pitch: 0 };
  const rad = Math.PI / 180;
  return { yaw: yaw * rad, pitch: pitch * rad };
}

// ---------- a frame of the touch camera ----------

/** What the touch camera reads and clears each frame (touchState.ts's touchInput). */
export interface TouchCamInput {
  lookX: number;
  lookY: number;
  flingX: number;
  flingY: number;
  looking: boolean;
  recentre: boolean;
  gyroYaw: number;
  gyroPitch: number;
}

/**
 * One frame, before the look drag is applied: the fling adds its share of look pixels, the gyro turns the view, a
 * double tap eases it level, and walking (with `follow` on, no look finger down) eases it level and, on a tap's
 * walk, toward `heading`. Mutates `look` and `input`.
 */
export function touchCamera(look: { yaw: number; pitch: number }, input: TouchCamInput, follow: boolean, dt: number, walking: boolean, heading: number | null, pitchLimits: { min: number; max: number }) {
  if (input.flingX || input.flingY) {
    input.lookX += input.flingX * dt;
    input.lookY += input.flingY * dt;
    const v = decayFling({ x: input.flingX, y: input.flingY }, dt);
    input.flingX = v.x;
    input.flingY = v.y;
  }
  if (input.gyroYaw || input.gyroPitch) {
    look.yaw += input.gyroYaw;
    look.pitch = Math.max(pitchLimits.min, Math.min(pitchLimits.max, look.pitch + input.gyroPitch));
    input.gyroYaw = 0;
    input.gyroPitch = 0;
  }
  if (input.looking) input.recentre = false;
  if (input.recentre) {
    look.pitch = easeToward(look.pitch, LEVEL_PITCH, dt, 12);
    if (look.pitch === LEVEL_PITCH) input.recentre = false;
    return;
  }
  if (!follow || !walking || input.looking) return;
  look.pitch = easeToward(look.pitch, LEVEL_PITCH, dt, 1.5);
  if (heading != null) look.yaw = easeAngle(look.yaw, heading, dt, 5);
}
