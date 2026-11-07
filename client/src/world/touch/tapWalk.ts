// Tap to walk (#123): a tap on the world walks you there along a path round the furniture, and a tap on something
// out of reach walks you up to it and then uses it. The maths is pure; the walk under way lives here, set by
// TouchControls.tsx and stepped by Player.tsx, which turns it into a push of the stick. Any stick, key or panel
// cancels it.

export interface Pt {
  x: number;
  z: number;
}

export interface TapWalk {
  /** Waypoints still ahead, the last one the goal. */
  path: Pt[];
  /** With a thing to use: its point, how close counts as there, and what runs then. */
  aim: { at: Pt; reach: number; arrive: () => void } | null;
  /** Where you were last frame, and how long you've hardly moved (caught on something). */
  last: Pt | null;
  idle: number;
}

/** A waypoint this close is passed. */
const PASS = 0.25;
/** Hardly moving this long, the walk gives up. */
const STUCK_S = 0.6;

/**
 * Where a tap on the floor at `to` takes you from `from`: as far along the line as you can stand, stopping short of
 * the first thing in the way (a wall, a desk), so a tap through a wall doesn't route you round the building.
 */
export function floorTarget(from: Pt, to: Pt, open: (x: number, z: number) => boolean, step = 0.2): Pt | null {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  let best: Pt | null = null;
  for (let s = step; s <= d + 1e-9; s += step) {
    const k = Math.min(1, s / d);
    const p = { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k };
    if (!open(p.x, p.z)) break;
    best = p;
  }
  if (best && open(to.x, to.z) && Math.hypot(to.x - best.x, to.z - best.z) < step) best = to;
  return best && Math.hypot(best.x - from.x, best.z - from.z) >= 0.3 ? best : null;
}

/** Where to stand to use a thing at `at`: the nearest open spot on the line back toward you. */
export function approach(from: Pt, at: Pt, open: (x: number, z: number) => boolean, step = 0.2): Pt {
  const d = Math.hypot(at.x - from.x, at.z - from.z);
  for (let s = 0; s < d; s += step) {
    const k = 1 - s / d;
    const p = { x: from.x + (at.x - from.x) * k, z: from.z + (at.z - from.z) * k };
    if (open(p.x, p.z)) return p;
  }
  return from;
}

export interface WalkStep {
  /** The walking direction (unit), or zero when there. */
  dx: number;
  dz: number;
  /** The yaw that faces the way you're walking (or the thing, once near). */
  heading: number | null;
  done: 'arrived' | 'stuck' | null;
}

/** Facing (dx, dz): yaw 0 looks down -z, as the camera does. */
export const yawOf = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** One frame of a walk from `at`: which way to go, and whether it's over. Mutates `w` (passed waypoints, idleness). */
export function walkStep(w: TapWalk, at: Pt, dt: number, speed: number): WalkStep {
  const none = (done: WalkStep['done']): WalkStep => ({ dx: 0, dz: 0, heading: w.aim ? yawOf(w.aim.at.x - at.x, w.aim.at.z - at.z) : null, done });
  if (w.aim && Math.hypot(w.aim.at.x - at.x, w.aim.at.z - at.z) <= w.aim.reach) return none('arrived');
  while (w.path.length && Math.hypot(w.path[0].x - at.x, w.path[0].z - at.z) <= (w.path.length > 1 ? PASS : 0.08)) w.path.shift();
  if (!w.path.length) return none('arrived');
  if (w.last && dt > 0) {
    w.idle = Math.hypot(at.x - w.last.x, at.z - w.last.z) < speed * dt * 0.2 ? w.idle + dt : 0;
    if (w.idle > STUCK_S) return none('stuck');
  }
  w.last = { x: at.x, z: at.z };
  const next = w.path[0];
  const d = Math.hypot(next.x - at.x, next.z - at.z);
  const dx = (next.x - at.x) / d;
  const dz = (next.z - at.z) / d;
  return { dx, dz, heading: yawOf(dx, dz), done: null };
}

/** A world direction (dx, dz) as a push of the stick for someone facing `yaw` (x right, y back, like a gamepad's). */
export function stickFor(dx: number, dz: number, yaw: number): { x: number; y: number } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return { x: dx * cos - dz * sin, y: dx * sin + dz * cos };
}

// ---------- the walk under way ----------

let current: TapWalk | null = null;

export function startTapWalk(path: Pt[], aim: TapWalk['aim'] = null) {
  current = path.length ? { path, aim, last: null, idle: 0 } : null;
  if (!current && aim) aim.arrive();
}

export const cancelTapWalk = () => {
  current = null;
};

export const tapWalking = () => current;
