import { describe, expect, it } from 'vitest';
import { knobOffset, STICK, stickVector } from './joystick';

const R = STICK.radius;

describe('stickVector', () => {
  it('reads nothing inside the dead zone', () => {
    expect(stickVector(0, 0)).toEqual({ x: 0, y: 0, run: false });
    expect(stickVector(R * STICK.deadZone * 0.99, 0)).toEqual({ x: 0, y: 0, run: false });
  });

  it('starts from zero at the dead zone edge and grows to 1 at the rim', () => {
    const edge = stickVector(R * STICK.deadZone + 0.01, 0);
    expect(edge.x).toBeGreaterThan(0);
    expect(edge.x).toBeLessThan(0.01);
    expect(stickVector(R, 0).x).toBeCloseTo(1);
    expect(stickVector(0, -R / 2).y).toBeLessThan(0); // up the screen is forward: negative, like a pad
  });

  it('clamps a push past the rim to length 1, keeping its direction', () => {
    const v = stickVector(R * 3, R * 3);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(v.y);
  });

  it('runs past the run threshold only', () => {
    expect(stickVector(R * (STICK.run - 0.01), 0).run).toBe(false);
    expect(stickVector(R * STICK.run, 0).run).toBe(true);
    expect(stickVector(0, R * 2).run).toBe(true);
  });

  it('never returns NaN for a zero radius push', () => {
    const v = stickVector(0, 0, R, 0);
    expect(v).toEqual({ x: 0, y: 0, run: false });
  });
});

describe('knobOffset', () => {
  it('follows the finger inside the ring and stays on the rim outside it', () => {
    expect(knobOffset(10, -5)).toEqual({ x: 10, y: -5 });
    const k = knobOffset(R * 2, 0);
    expect(k.x).toBeCloseTo(R);
    expect(k.y).toBeCloseTo(0);
  });
});
