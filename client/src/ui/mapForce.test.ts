import { describe, expect, it } from 'vitest';
import { createSim, fitView, hitTest, settle, tick, zoomAt, ZOOM_MAX } from './mapForce';

const nodes = [
  { id: 'a', weight: 4 },
  { id: 'b', weight: 1 },
  { id: 'c', weight: 1 },
];
const edges = [
  { source: 'a', target: 'b' },
  { source: 'a', target: 'c' },
];

describe('the map physics', () => {
  it('settles: it cools to rest with every node apart', () => {
    const sim = createSim(nodes, edges);
    settle(sim, 2000);
    expect(tick(sim)).toBe(false);
    const [a, b, c] = sim.bodies;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
    expect(Math.hypot(b.x - c.x, b.y - c.y)).toBeGreaterThan(b.r + c.r);
    expect(sim.bodies.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });

  it('keeps placed nodes where they were, starts a new one by its neighbour, and stays at rest when nothing was added', () => {
    const first = createSim(nodes, edges);
    settle(first, 2000);
    const prev = new Map(first.bodies.map((b) => [b.id, b]));
    const same = createSim(nodes, edges, prev);
    expect(same.alpha).toBe(0);
    expect(same.bodies[0]).toMatchObject({ x: first.bodies[0].x, y: first.bodies[0].y });
    const more = createSim([...nodes, { id: 'd', weight: 1 }], [...edges, { source: 'b', target: 'd' }], prev);
    expect(more.alpha).toBeGreaterThan(0);
    const b = more.bodies[1];
    const d = more.bodies[3];
    expect(Math.hypot(b.x - d.x, b.y - d.y)).toBeLessThan(30);
  });
});

describe('the map view', () => {
  it('zooms around the pointer and within limits', () => {
    const v = zoomAt({ x: 0, y: 0, k: 1 }, 2, 100, 50);
    expect(v).toEqual({ k: 2, x: -100, y: -50 });
    expect(zoomAt(v, 100, 0, 0).k).toBe(ZOOM_MAX);
  });

  it('fits the bodies in the box and finds the one under a tap', () => {
    const sim = createSim(nodes, edges);
    settle(sim, 2000);
    const v = fitView(sim.bodies, 390, 500);
    for (const b of sim.bodies) {
      const sx = v.x + b.x * v.k;
      const sy = v.y + b.y * v.k;
      expect(sx).toBeGreaterThan(0);
      expect(sx).toBeLessThan(390);
      expect(hitTest(sim.bodies, v, sx + 2, sy)?.id).toBe(b.id);
    }
    expect(hitTest(sim.bodies, v, -500, -500)).toBeNull();
  });
});
