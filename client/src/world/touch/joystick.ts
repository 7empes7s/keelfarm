// The floating joystick's maths, pure: a finger's offset from where it landed becomes a walking vector in the
// gamepad's convention (x right, y down, at most 1 long), with a dead zone in the middle and running near the rim.

export const STICK = {
  /** The ring's radius, CSS pixels: a full push. */
  radius: 56,
  /** Inside this share of the radius, nothing moves (a thumb resting never quite still). */
  deadZone: 0.12,
  /** Pushed past this share of the radius, you run. */
  run: 0.8,
} as const;

export interface StickVector {
  /** -1 to 1, right positive. */
  x: number;
  /** -1 to 1, down (backwards) positive, like a gamepad's stick. */
  y: number;
  run: boolean;
}

/** The walking vector for a finger (dx, dy) pixels from the joystick's centre. */
export function stickVector(dx: number, dy: number, radius: number = STICK.radius, deadZone: number = STICK.deadZone, run: number = STICK.run): StickVector {
  const m = Math.hypot(dx, dy) / radius;
  if (!(m > deadZone)) return { x: 0, y: 0, run: false };
  const k = Math.min(1, (m - deadZone) / (1 - deadZone)) / m / radius;
  return { x: dx * k, y: dy * k, run: m >= run };
}

/** Where the knob is drawn: the finger, held inside the ring. */
export function knobOffset(dx: number, dy: number, radius: number = STICK.radius): { x: number; y: number } {
  const m = Math.hypot(dx, dy);
  if (m <= radius) return { x: dx, y: dy };
  return { x: (dx / m) * radius, y: (dy / m) * radius };
}
