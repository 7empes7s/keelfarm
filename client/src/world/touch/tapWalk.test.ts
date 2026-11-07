import { describe, expect, it } from 'vitest';
import { approach, floorTarget, stickFor, walkStep, yawOf, type TapWalk } from './tapWalk';

const openAll = () => true;
const wallAt5 = (x: number) => x < 5;

describe('floorTarget', () => {
  it('a tap on open floor goes all the way there', () => {
    expect(floorTarget({ x: 0, z: 0 }, { x: 3, z: 0 }, openAll)).toEqual({ x: 3, z: 0 });
  });

  it('a tap past a wall stops short of it', () => {
    const t = floorTarget({ x: 0, z: 0 }, { x: 9, z: 0 }, wallAt5)!;
    expect(t.x).toBeLessThan(5);
    expect(t.x).toBeGreaterThan(4.5);
  });

  it('a tap right at your feet, or with something in the way at once, is no walk', () => {
    expect(floorTarget({ x: 0, z: 0 }, { x: 0.1, z: 0 }, openAll)).toBeNull();
    expect(floorTarget({ x: 0, z: 0 }, { x: 4, z: 0 }, () => false)).toBeNull();
  });
});

describe('approach', () => {
  it('stands at the nearest open spot in front of the thing', () => {
    const p = approach({ x: 0, z: 0 }, { x: 6, z: 0 }, wallAt5);
    expect(p.x).toBeLessThan(5);
    expect(p.x).toBeGreaterThan(4.5);
  });
});

const walk = (path: TapWalk['path'], aim: TapWalk['aim'] = null): TapWalk => ({ path, aim, last: null, idle: 0 });

describe('walkStep', () => {
  it('heads for the next waypoint, passes it, and arrives at the last', () => {
    const w = walk([{ x: 0, z: -2 }, { x: 2, z: -2 }]);
    const s = walkStep(w, { x: 0, z: 0 }, 0.016, 3.6);
    expect(s.done).toBeNull();
    expect(s.dx).toBeCloseTo(0);
    expect(s.dz).toBeCloseTo(-1);
    expect(s.heading).toBeCloseTo(0); // straight ahead is -z
    expect(walkStep(w, { x: 0, z: -1.9 }, 0.016, 3.6).dx).toBeCloseTo(1);
    expect(w.path).toHaveLength(1);
    expect(walkStep(w, { x: 2, z: -2 }, 0.016, 3.6).done).toBe('arrived');
  });

  it('with a thing to use, arrives once in reach of it', () => {
    const w = walk([{ x: 0, z: -5 }], { at: { x: 0, z: -6 }, reach: 2.8, arrive: () => undefined });
    expect(walkStep(w, { x: 0, z: 0 }, 0.016, 3.6).done).toBeNull();
    expect(walkStep(w, { x: 0, z: -3.3 }, 0.016, 3.6).done).toBe('arrived');
  });

  it('gives up when caught on something', () => {
    const w = walk([{ x: 0, z: -5 }]);
    let done = null;
    for (let i = 0; i < 60 && !done; i++) done = walkStep(w, { x: 0, z: 0 }, 0.016, 3.6).done;
    expect(done).toBe('stuck');
  });
});

describe('stickFor', () => {
  it('turns a world direction into the stick push that walks it, whichever way you face', () => {
    for (const yaw of [0, 0.7, -2, 3]) {
      const dir = { x: Math.cos(1.1), z: Math.sin(1.1) };
      const st = stickFor(dir.x, dir.z, yaw);
      // Player.tsx: forward is -y, strafe is x
      const fwd = -st.y;
      const strafe = st.x;
      expect(-Math.sin(yaw) * fwd + Math.cos(yaw) * strafe).toBeCloseTo(dir.x);
      expect(-Math.cos(yaw) * fwd - Math.sin(yaw) * strafe).toBeCloseTo(dir.z);
    }
    expect(yawOf(0, -1)).toBeCloseTo(0);
  });
});
