// The map room's constellation (#137), pure: the memory map (shared/memoryMap.ts) laid out in 3D. Floors are
// pinned on a ring as cluster centres, the company in the middle, everything else pulled towards its floor's centre
// (or the middle) by springs and a gentle anchor force. Plus the level of detail (which labels show, how fine the
// spheres are), the agents' moving lights along the edges they work on, and the sparks and bursts of live changes.
import type { MapChange, MapNode, MemoryGraph } from '../../../shared/memoryMap';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Star extends Vec3 {
  id: string;
  vx: number;
  vy: number;
  vz: number;
  r: number; // its radius, from its weight
  anchor: Vec3; // its cluster's centre
  pinned: boolean; // floors and the company hold still: they are the clusters
}

export interface Sky {
  stars: Star[];
  links: [number, number][];
  alpha: number;
}

const ALPHA_MIN = 0.004;
const LINK = 4;
const CHARGE = 14;
const ANCHOR = 0.02;
const DECAY = 0.6;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** A star's radius for its node's weight. */
const starRadius = (weight: number) => 0.35 + Math.sqrt(Math.max(0, weight)) * 0.28;

/** How far the floors sit from the middle: wider with more floors, so their clusters don't overlap. */
const ringRadius = (floors: number) => (floors <= 1 ? 0 : 10 + floors * 3.2);

/** Each floor's cluster centre: a ring around the company, in the order the floors come, tilted a little in y. */
export function clusterCentres(nodes: readonly Pick<MapNode, 'id' | 'type' | 'repoId'>[]): Map<string, Vec3> {
  const floors = nodes.filter((n) => n.type === 'floor' && n.repoId);
  const R = ringRadius(floors.length);
  const out = new Map<string, Vec3>();
  floors.forEach((f, i) => {
    const a = (i / floors.length) * Math.PI * 2;
    out.set(f.repoId!, { x: Math.cos(a) * R, y: Math.sin(a * 2) * R * 0.15, z: Math.sin(a) * R });
  });
  return out;
}

/** The i-th of n points on a sphere of radius d (Fibonacci): even, deterministic first placements. */
function spherePoint(i: number, n: number, d: number): Vec3 {
  const y = n <= 1 ? 0 : 1 - (2 * (i + 0.5)) / n;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * GOLDEN;
  return { x: Math.cos(a) * ring * d, y: y * d, z: Math.sin(a) * ring * d };
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The constellation's layout for these nodes: stars already placed keep where they were (a live change only nudges
 * it); a new one starts by a linked neighbour, else on a shell around its cluster's centre.
 */
export function createSky(nodes: readonly Pick<MapNode, 'id' | 'type' | 'repoId' | 'weight'>[], edges: readonly { source: string; target: string }[], prev?: Map<string, Star>): Sky {
  const centres = clusterCentres(nodes);
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const links = edges.flatMap((e): [number, number][] => {
    const a = index.get(e.source);
    const b = index.get(e.target);
    return a === undefined || b === undefined ? [] : [[a, b]];
  });
  const near = new Map<string, string[]>();
  for (const e of edges) {
    near.set(e.source, [...(near.get(e.source) ?? []), e.target]);
    near.set(e.target, [...(near.get(e.target) ?? []), e.source]);
  }
  const perCluster = new Map<string, number>();
  for (const n of nodes) perCluster.set(n.repoId ?? '', (perCluster.get(n.repoId ?? '') ?? 0) + 1);
  const seen = new Map<string, number>();
  const placed = new Map<string, Star>();
  let fresh = 0;
  const stars = nodes.map((n) => {
    const key = n.repoId ?? '';
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    const anchor = (n.repoId && centres.get(n.repoId)) || ORIGIN;
    const pinned = n.type === 'company' || n.type === 'floor';
    const r = starRadius(n.weight);
    const old = prev?.get(n.id);
    let s: Star;
    if (old) s = { ...old, r, anchor, pinned, ...(pinned && { x: anchor.x, y: anchor.y, z: anchor.z }) };
    else {
      fresh++;
      if (pinned) s = { id: n.id, ...anchor, vx: 0, vy: 0, vz: 0, r, anchor, pinned };
      else {
        const by = (near.get(n.id) ?? []).map((id) => placed.get(id) ?? prev?.get(id)).find((b) => b && !b.pinned);
        const p = by ? spherePoint(k, Math.max(8, k + 1), 2.5) : spherePoint(k, perCluster.get(key) ?? 1, 3 + Math.sqrt(perCluster.get(key) ?? 1) * 0.9);
        const o = by ?? anchor;
        s = { id: n.id, x: o.x + p.x, y: o.y + p.y, z: o.z + p.z, vx: 0, vy: 0, vz: 0, r, anchor, pinned };
      }
    }
    placed.set(n.id, s);
    return s;
  });
  const alpha = !prev?.size ? 1 : fresh || stars.length !== prev.size ? 0.35 : 0;
  return { stars, links, alpha };
}

/** One step of the physics; false once it rests. */
export function tickSky(sky: Sky): boolean {
  if (sky.alpha < ALPHA_MIN) return false;
  const { stars, links } = sky;
  const a = sky.alpha;
  const n = stars.length;
  for (let i = 0; i < n; i++) {
    const p = stars[i];
    for (let j = i + 1; j < n; j++) {
      const q = stars[j];
      let dx = q.x - p.x;
      let dy = q.y - p.y;
      let dz = q.z - p.z;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 0.0001) {
        dx = (j - i) * 0.01;
        dy = 0.01;
        dz = 0.01;
        d2 = dx * dx + dy * dy + dz * dz;
      }
      if (d2 > 400) continue; // far apart: too weak to matter
      const f = (CHARGE * a) / d2 / Math.sqrt(d2);
      p.vx -= dx * f;
      p.vy -= dy * f;
      p.vz -= dz * f;
      q.vx += dx * f;
      q.vy += dy * f;
      q.vz += dz * f;
    }
  }
  for (const [i, j] of links) {
    const p = stars[i];
    const q = stars[j];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dz = q.z - p.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    // links to a pinned hub (a floor, the company) are longer and weaker: they'd crush the cluster otherwise
    const hub = p.pinned || q.pinned;
    const k = ((d - (hub ? LINK * 1.6 : LINK) - p.r - q.r) / d) * a * (hub ? 0.04 : 0.1);
    p.vx += dx * k;
    p.vy += dy * k;
    p.vz += dz * k;
    q.vx -= dx * k;
    q.vy -= dy * k;
    q.vz -= dz * k;
  }
  for (const s of stars) {
    if (s.pinned) {
      s.vx = s.vy = s.vz = 0;
      continue;
    }
    s.vx = (s.vx - (s.x - s.anchor.x) * ANCHOR * a) * DECAY;
    s.vy = (s.vy - (s.y - s.anchor.y) * ANCHOR * a) * DECAY;
    s.vz = (s.vz - (s.z - s.anchor.z) * ANCHOR * a) * DECAY;
    s.x += s.vx;
    s.y += s.vy;
    s.z += s.vz;
  }
  sky.alpha *= 0.975;
  return true;
}

/** Runs the physics until it rests (or `max` steps): reduced motion shows it settled at once. */
export function settleSky(sky: Sky, max = 300) {
  for (let i = 0; i < max && tickSky(sky); i++);
}

/** The middle and size of what's drawn, for the camera's first view and "fit". */
export function bounds(stars: readonly Vec3[]): { centre: Vec3; radius: number } {
  if (!stars.length) return { centre: ORIGIN, radius: 10 };
  const c = { x: 0, y: 0, z: 0 };
  for (const s of stars) {
    c.x += s.x / stars.length;
    c.y += s.y / stars.length;
    c.z += s.z / stars.length;
  }
  let r = 0;
  for (const s of stars) r = Math.max(r, Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z));
  return { centre: c, radius: Math.max(6, r) };
}

// ---------- level of detail ----------

export const LABELS_MAX = 14;
const LABEL_NEAR = 14;

/**
 * Which stars get a label: the nearest to the camera, big ones from farther away (distance over size), within reach,
 * at most `max`; the selected and hovered ones always. Labels are DOM, so few of them keeps the frame rate.
 */
export function labelIds(stars: readonly Star[], cam: Vec3, always: readonly (string | null)[] = [], max = LABELS_MAX): Set<string> {
  const scored: [string, number][] = [];
  for (const s of stars) {
    const d = Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z) / (1 + s.r);
    if (d <= LABEL_NEAR) scored.push([s.id, d]);
  }
  scored.sort((a, b) => a[1] - b[1]);
  const out = new Set(always.filter((id): id is string => !!id && stars.some((s) => s.id === id)));
  for (const [id] of scored) {
    if (out.size >= max) break;
    out.add(id);
  }
  return out;
}

/** How fine the stars' spheres are (an icosahedron's detail): fewer triangles as the constellation grows. */
export const starDetail = (count: number) => (count > 600 ? 0 : count > 200 ? 1 : 2);

// ---------- what moves ----------

/** The agents at work: a light runs along each edge from an agent who's working to what they build, test or fix. */
export function taskLights(g: Pick<MemoryGraph, 'nodes' | 'edges'>): { source: string; target: string }[] {
  const working = new Set(g.nodes.filter((n) => (n.type === 'agent' || n.type === 'ceo') && n.status === 'working').map((n) => n.id));
  return g.edges.filter((e) => (e.kind === 'built' || e.kind === 'tested' || e.kind === 'fixed') && working.has(e.source)).map(({ source, target }) => ({ source, target }));
}

/** Where a task light is along its edge (0 at the agent, 1 at the work) at time `t` seconds; lights don't move in step. */
export const lightAt = (t: number, i: number) => (t * 0.45 + i * 0.37) % 1;

export const SPARK_MS = 1400;

export interface Particle extends Vec3 {
  size: number;
  fade: number; // 1 bright → 0 gone
  gold: boolean; // a merge's burst; else a new thing's spark
}

/** A live change's particles at `ms` after it: a new node sparks (a few, close), a merge bursts (more, farther). */
export function sparkParticles(kind: MapChange['kind'], at: Vec3, ms: number): Particle[] {
  if (ms < 0 || ms >= SPARK_MS || kind === 'changed') return [];
  const t = ms / SPARK_MS;
  const merge = kind === 'merged';
  const n = merge ? 14 : 6;
  const reach = (merge ? 4 : 1.8) * Math.sqrt(t);
  return Array.from({ length: n }, (_, i) => {
    const p = spherePoint(i, n, reach);
    return { x: at.x + p.x, y: at.y + p.y, z: at.z + p.z, size: (merge ? 0.22 : 0.16) * (1 - t * 0.5), fade: 1 - t, gold: merge };
  });
}
