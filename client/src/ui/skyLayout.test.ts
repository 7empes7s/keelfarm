import { describe, expect, it } from 'vitest';
import type { MapNode } from '../../../shared/memoryMap';
import { clusterCentres, createSky, labelIds, settleSky, sparkParticles, starDetail, taskLights, tickSky, LABELS_MAX, type Star } from './skyLayout';

const node = (id: string, type: MapNode['type'], repoId: string | null, weight = 1, status: MapNode['status'] = null): MapNode => ({ id, type, label: id, title: id, repoId, at: 0, status, weight, facts: [], objective: null });

const nodes = [node('company', 'company', null, 8), node('floor:a', 'floor', 'a', 6), node('floor:b', 'floor', 'b', 6), node('issue:a#1', 'issue', 'a'), node('issue:a#2', 'issue', 'a'), node('issue:b#1', 'issue', 'b'), node('agent:x', 'agent', 'a', 2, 'working')];
const edges = [
  { source: 'floor:a', target: 'company', kind: 'part-of' as const },
  { source: 'floor:b', target: 'company', kind: 'part-of' as const },
  { source: 'issue:a#1', target: 'issue:a#2', kind: 'depends' as const },
  { source: 'agent:x', target: 'issue:a#1', kind: 'built' as const },
  { source: 'agent:x', target: 'floor:a', kind: 'part-of' as const },
];
const at = (sky: { stars: Star[] }, id: string) => sky.stars.find((s) => s.id === id)!;
const dist = (p: Star, q: { x: number; y: number; z: number }) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

describe('the constellation layout', () => {
  it('pins the company in the middle and the floors apart on a ring, as cluster centres', () => {
    const c = clusterCentres(nodes);
    expect(c.size).toBe(2);
    const [a, b] = [c.get('a')!, c.get('b')!];
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(20);
    const sky = createSky(nodes, edges);
    settleSky(sky, 2000);
    expect(at(sky, 'company')).toMatchObject({ x: 0, y: 0, z: 0, pinned: true });
    expect(dist(at(sky, 'floor:a'), a)).toBeLessThan(1e-9);
  });

  it("settles each floor's work around its floor, nearer it than the other floor, with stars apart", () => {
    const sky = createSky(nodes, edges);
    settleSky(sky, 2000);
    expect(tickSky(sky)).toBe(false);
    const fa = at(sky, 'floor:a');
    const fb = at(sky, 'floor:b');
    for (const id of ['issue:a#1', 'issue:a#2', 'agent:x']) expect(dist(at(sky, id), fa)).toBeLessThan(dist(at(sky, id), fb));
    expect(dist(at(sky, 'issue:b#1'), fb)).toBeLessThan(dist(at(sky, 'issue:b#1'), fa));
    const [p, q] = [at(sky, 'issue:a#1'), at(sky, 'issue:a#2')];
    expect(dist(p, q)).toBeGreaterThan(p.r + q.r);
    expect(sky.stars.every((s) => Number.isFinite(s.x + s.y + s.z))).toBe(true);
  });

  it('is deterministic, keeps placed stars, rests when nothing changed and starts a new one by its neighbour', () => {
    const one = createSky(nodes, edges);
    const two = createSky(nodes, edges);
    expect(one.stars.map((s) => [s.x, s.y, s.z])).toEqual(two.stars.map((s) => [s.x, s.y, s.z]));
    settleSky(one, 2000);
    const prev = new Map(one.stars.map((s) => [s.id, s]));
    const same = createSky(nodes, edges, prev);
    expect(same.alpha).toBe(0);
    expect(at(same, 'issue:a#1').x).toBe(at(one, 'issue:a#1').x);
    const grown = createSky([...nodes, node('pr:a#3', 'pr', 'a')], [...edges, { source: 'pr:a#3', target: 'issue:a#1' }], prev);
    expect(grown.alpha).toBeGreaterThan(0);
    expect(dist(at(grown, 'pr:a#3'), at(one, 'issue:a#1'))).toBeLessThan(3);
  });
});

describe('level of detail', () => {
  const stars = createSky(nodes, edges).stars;

  it('labels only the stars near the camera, the selected one always, and at most the cap', () => {
    const near = at({ stars }, 'issue:b#1');
    const ids = labelIds(stars, { x: near.x, y: near.y, z: near.z + 1 }, ['issue:a#2']);
    expect(ids.has('issue:b#1')).toBe(true);
    expect(ids.has('issue:a#2')).toBe(true);
    expect(ids.has('issue:a#1')).toBe(false);
    const many = Array.from({ length: 60 }, (_, i): Star => ({ id: `s${i}`, x: i * 0.1, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0.4, anchor: { x: 0, y: 0, z: 0 }, pinned: false }));
    expect(labelIds(many, { x: 0, y: 0, z: 2 }).size).toBe(LABELS_MAX);
    expect(labelIds(many, { x: 0, y: 0, z: 500 }).size).toBe(0);
  });

  it('uses coarser spheres for bigger constellations', () => {
    expect(starDetail(50)).toBeGreaterThan(starDetail(400));
    expect(starDetail(400)).toBeGreaterThan(starDetail(1000));
  });
});

describe('what moves', () => {
  it('runs a light only from working agents along what they build, test or fix', () => {
    expect(taskLights({ nodes, edges })).toEqual([{ source: 'agent:x', target: 'issue:a#1' }]);
    expect(taskLights({ nodes: nodes.map((n) => (n.id === 'agent:x' ? { ...n, status: 'idle' as const } : n)), edges })).toEqual([]);
  });

  it('sparks a new node, bursts a merge wider and brighter, and is gone after the effect', () => {
    const o = { x: 0, y: 0, z: 0 };
    const spark = sparkParticles('new', o, 700);
    const burst = sparkParticles('merged', o, 700);
    expect(spark.length).toBeGreaterThan(0);
    expect(burst.length).toBeGreaterThan(spark.length);
    expect(Math.max(...burst.map((p) => Math.hypot(p.x, p.y, p.z)))).toBeGreaterThan(Math.max(...spark.map((p) => Math.hypot(p.x, p.y, p.z))));
    expect(burst.every((p) => p.gold)).toBe(true);
    expect(sparkParticles('merged', o, 5000)).toEqual([]);
    expect(sparkParticles('changed', o, 100)).toEqual([]);
  });
});
