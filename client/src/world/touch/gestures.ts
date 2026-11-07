// The 3D view's touch grammar, pure: fingers in, gestures out (TouchControls.tsx feeds it pointer events).
// A tap is a quick press that barely moves: the primary action, aimed at the tap point. A press held still arms the
// hold menu, which opens when the finger lifts. Tap and hold work anywhere. A press that moves past the slop is a drag,
// and the half of the screen it landed in decides what it does (#83): the bottom half walks (the joystick centred
// where the finger landed), the top half looks around (thumbs.ts has #123's thumb zones, which feed the same roles).
// A finger keeps its role until it lifts. Two looking fingers pinch instead.

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

/** What a drag does, from the half of the screen the finger landed in. */
export type Zone = 'stick' | 'look';

/** The visible part of the page (viewport.ts's appViewport): where it starts and how tall it is, CSS pixels. */
export interface View {
  top: number;
  height: number;
}

/** The split screen: a finger landing in the top half looks around, in the bottom half walks. */
export const zoneAt = (y: number, view: View): Zone => (y < view.top + view.height / 2 ? 'look' : 'stick');

interface Finger {
  role: Role;
  zone: Zone;
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
  | { type: 'look'; dx: number; dy: number }
  /** Two looking fingers moved apart (scale > 1) or together. */
  | { type: 'pinch'; scale: number };

export const createGestures = (dpr = 1): Gestures => ({ fingers: new Map(), slop: slopFor(dpr) });

const hasStick = (g: Gestures) => [...g.fingers.values()].some((f) => f.role === 'stick');

const stickOf = (f: Finger): GestureEvent => ({ type: 'stick', cx: f.x0, cy: f.y0, x: f.x, y: f.y });

/** The role a drag takes: its zone's, though there's only one joystick (a second walking finger looks instead). */
const dragRole = (g: Gestures, f: Finger): Role => (f.zone === 'stick' && !hasStick(g) ? 'stick' : 'look');

/** A finger lands in `zone`. A second finger takes any press's tap and menu away: both drag, each by its zone. */
export function fingerDown(g: Gestures, id: number, x: number, y: number, t: number, zone: Zone): GestureEvent[] {
  const out: GestureEvent[] = [];
  const f: Finger = { role: 'press', zone, x0: x, y0: y, x, y, t0: t };
  if (g.fingers.size) {
    for (const o of g.fingers.values()) {
      if (o.role !== 'press' && o.role !== 'armed') continue;
      o.role = dragRole(g, o);
      if (o.role === 'stick') out.push(stickOf(o));
    }
    f.role = dragRole(g, f);
    if (f.role === 'stick') out.push(stickOf(f));
  }
  g.fingers.set(id, f);
  return out;
}

export function fingerMove(g: Gestures, id: number, x: number, y: number): GestureEvent[] {
  const f = g.fingers.get(id);
  if (!f) return [];
  const dx = x - f.x;
  const dy = y - f.y;
  const other = f.role === 'look' ? [...g.fingers.values()].find((o) => o !== f && o.role === 'look') : undefined;
  const before = other ? Math.hypot(f.x - other.x, f.y - other.y) : 0;
  f.x = x;
  f.y = y;
  if (other) return before > 0 && (dx || dy) ? [{ type: 'pinch', scale: Math.hypot(x - other.x, y - other.y) / before }] : [];
  if (f.role === 'look') return dx || dy ? [{ type: 'look', dx, dy }] : [];
  if (f.role === 'stick') return [stickOf(f)];
  if (Math.hypot(x - f.x0, y - f.y0) <= g.slop) return [];
  f.role = dragRole(g, f);
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
