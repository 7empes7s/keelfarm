// The 3D view's touch grammar, pure: fingers in, gestures out (TouchControls.tsx feeds it pointer events).
// A tap is a quick press that barely moves: the primary action, aimed at the tap point. A press held still arms the
// hold menu, which opens when the finger lifts. A press that moves past the slop, before or after the hold timer, is
// the walking joystick centred where the finger landed, and never also taps or opens the menu. Any other finger
// down at the same time looks around.

/** Every threshold in one place. Distances are CSS pixels (pointer events' units). */
export const GESTURE = {
  /** A tap ends within this long. */
  tapMs: 250,
  /** Held still this long, the press arms the hold menu. */
  holdMs: 450,
  /** Moving more than this makes a press a drag. */
  slopPx: 10,
  /** At least this many device pixels of slop: a low-DPR touch screen reports coarser positions. */
  minSlopDevicePx: 16,
} as const;

/** The slop for a screen's device pixel ratio, in CSS pixels. */
export const slopFor = (dpr: number) => Math.max(GESTURE.slopPx, GESTURE.minSlopDevicePx / (dpr > 0 && Number.isFinite(dpr) ? dpr : 1));

type Role = 'press' | 'armed' | 'stick' | 'look';

interface Finger {
  role: Role;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
}

export interface Gestures {
  fingers: Map<number, Finger>;
  slop: number;
}

export type GestureEvent =
  | { type: 'tap'; x: number; y: number }
  /** The press is held long enough: the menu opens if it lifts without moving (a haptic now). */
  | { type: 'armed'; x: number; y: number }
  | { type: 'hold'; x: number; y: number }
  /** The joystick: centre (cx, cy), finger at (x, y). */
  | { type: 'stick'; cx: number; cy: number; x: number; y: number }
  | { type: 'stickEnd' }
  | { type: 'look'; dx: number; dy: number };

export const createGestures = (dpr = 1): Gestures => ({ fingers: new Map(), slop: slopFor(dpr) });

const hasStick = (g: Gestures) => [...g.fingers.values()].some((f) => f.role === 'stick');

const stickOf = (f: Finger): GestureEvent => ({ type: 'stick', cx: f.x0, cy: f.y0, x: f.x, y: f.y });

/** A finger lands. A second finger takes any press's tap and menu away: that one walks, the new one looks. */
export function fingerDown(g: Gestures, id: number, x: number, y: number, t: number): GestureEvent[] {
  const out: GestureEvent[] = [];
  const others = [...g.fingers.values()];
  let role: Role = 'press';
  if (others.length) {
    for (const f of others) {
      if (f.role === 'press' || f.role === 'armed') {
        f.role = hasStick(g) ? 'look' : 'stick';
        if (f.role === 'stick') out.push(stickOf(f));
      }
    }
    role = hasStick(g) ? 'look' : 'stick';
  }
  const f: Finger = { role, x0: x, y0: y, x, y, t0: t };
  g.fingers.set(id, f);
  if (role === 'stick') out.push(stickOf(f));
  return out;
}

export function fingerMove(g: Gestures, id: number, x: number, y: number): GestureEvent[] {
  const f = g.fingers.get(id);
  if (!f) return [];
  const dx = x - f.x;
  const dy = y - f.y;
  f.x = x;
  f.y = y;
  if (f.role === 'look') return dx || dy ? [{ type: 'look', dx, dy }] : [];
  if (f.role === 'stick') return [stickOf(f)];
  if (Math.hypot(x - f.x0, y - f.y0) <= g.slop) return [];
  f.role = hasStick(g) ? 'look' : 'stick';
  return f.role === 'stick' ? [stickOf(f)] : [{ type: 'look', dx: x - f.x0, dy: y - f.y0 }];
}

export function fingerUp(g: Gestures, id: number, x: number, y: number, t: number): GestureEvent[] {
  const f = g.fingers.get(id);
  if (!f) return [];
  const out = fingerMove(g, id, x, y);
  g.fingers.delete(id);
  if (f.role === 'stick') out.push({ type: 'stickEnd' });
  else if (f.role === 'armed') out.push({ type: 'hold', x: f.x0, y: f.y0 });
  else if (f.role === 'press' && t - f.t0 <= GESTURE.tapMs) out.push({ type: 'tap', x: f.x0, y: f.y0 });
  return out;
}

/** The browser took the finger (a system gesture, the page losing focus): it stops walking and nothing fires. */
export function fingerCancel(g: Gestures, id: number): GestureEvent[] {
  const f = g.fingers.get(id);
  g.fingers.delete(id);
  return f?.role === 'stick' ? [{ type: 'stickEnd' }] : [];
}

/** Lets go of every finger (a panel opened over the view). */
export function cancelAll(g: Gestures): GestureEvent[] {
  return [...g.fingers.keys()].flatMap((id) => fingerCancel(g, id));
}

/** Call every frame: a lone press held still past holdMs arms the menu. */
export function tickGestures(g: Gestures, t: number): GestureEvent[] {
  if (g.fingers.size !== 1) return [];
  const [f] = g.fingers.values();
  if (f.role !== 'press' || t - f.t0 < GESTURE.holdMs) return [];
  f.role = 'armed';
  return [{ type: 'armed', x: f.x0, y: f.y0 }];
}

/** Whether a finger is holding the menu armed (for the ring's cue). */
export const isArmed = (g: Gestures) => [...g.fingers.values()].some((f) => f.role === 'armed');
