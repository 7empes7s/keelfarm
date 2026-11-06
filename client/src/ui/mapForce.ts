// The memory map's physics (#136): a small force-directed layout like Obsidian's graph view (charge between every
// pair, springs along links, a gentle pull to the middle), plus the view's pan and zoom maths. Pure and
// dependency-free: a few hundred nodes is n² cheap, and positions carry over between builds so a live change only
// nudges the map.

export interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // its radius on the map, from its weight
}

export interface Sim {
  bodies: Body[];
  links: [number, number][];
  alpha: number; // the heat: it cools to 0 and the map comes to rest
}

export const ALPHA_MIN = 0.004;
const LINK = 46;
const CHARGE = 900;
const GRAVITY = 0.012;
const DECAY = 0.55;

/** A node's radius for its weight. */
const radiusOf = (weight: number) => 4 + Math.sqrt(Math.max(0, weight)) * 2.6;

/** A layout for these nodes, keeping where the ones already placed were; new ones start by a linked neighbour. */
export function createSim(nodes: readonly { id: string; weight: number }[], edges: readonly { source: string; target: string }[], prev?: Map<string, Body>): Sim {
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
  const placed = new Map<string, Body>();
  let fresh = 0;
  const bodies = nodes.map((n, i) => {
    const old = prev?.get(n.id);
    let b: Body;
    if (old) b = { ...old, r: radiusOf(n.weight) };
    else {
      fresh++;
      const by = (near.get(n.id) ?? []).map((id) => placed.get(id) ?? prev?.get(id)).find(Boolean);
      // a spiral (the golden angle) keeps first placements apart and deterministic
      const a = i * 2.39996;
      const d = by ? 18 : 12 * Math.sqrt(i + 1);
      b = { id: n.id, x: (by?.x ?? 0) + Math.cos(a) * d, y: (by?.y ?? 0) + Math.sin(a) * d, vx: 0, vy: 0, r: radiusOf(n.weight) };
    }
    placed.set(n.id, b);
    return b;
  });
  const alpha = !prev?.size ? 1 : fresh || bodies.length !== prev.size ? 0.35 : 0;
  return { bodies, links, alpha };
}

/** One step of the physics; returns false once the map is at rest. */
export function tick(sim: Sim): boolean {
  if (sim.alpha < ALPHA_MIN) return false;
  const { bodies, links } = sim;
  const a = sim.alpha;
  const n = bodies.length;
  for (let i = 0; i < n; i++) {
    const p = bodies[i];
    for (let j = i + 1; j < n; j++) {
      const q = bodies[j];
      let dx = q.x - p.x;
      let dy = q.y - p.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        dx = (j - i) * 0.1;
        dy = 0.1;
        d2 = dx * dx + dy * dy;
      }
      if (d2 > 160_000) continue; // far apart: too weak to matter
      const f = (CHARGE * a) / d2;
      p.vx -= dx * f * 0.05;
      p.vy -= dy * f * 0.05;
      q.vx += dx * f * 0.05;
      q.vy += dy * f * 0.05;
    }
  }
  for (const [i, j] of links) {
    const p = bodies[i];
    const q = bodies[j];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const k = ((d - LINK - p.r - q.r) / d) * a * 0.12;
    p.vx += dx * k;
    p.vy += dy * k;
    q.vx -= dx * k;
    q.vy -= dy * k;
  }
  for (const b of bodies) {
    b.vx = (b.vx - b.x * GRAVITY * a) * DECAY;
    b.vy = (b.vy - b.y * GRAVITY * a) * DECAY;
    b.x += b.vx;
    b.y += b.vy;
  }
  sim.alpha *= 0.975;
  return true;
}

/** Runs the physics until it rests (or `max` steps): reduced motion shows the map settled at once. */
export function settle(sim: Sim, max = 300) {
  for (let i = 0; i < max && tick(sim); i++);
}

// ---------- the view ----------

export interface View {
  x: number; // the map's middle on screen, px
  y: number;
  k: number; // zoom
}

const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 5;
const clampK = (k: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

/** Zooms by `factor` around a screen point, keeping the map under it still (wheel and pinch). */
export function zoomAt(v: View, factor: number, sx: number, sy: number): View {
  const k = clampK(v.k * factor);
  const f = k / v.k;
  return { k, x: sx - (sx - v.x) * f, y: sy - (sy - v.y) * f };
}

/** A view that fits these bodies in a w×h box. */
export function fitView(bodies: readonly Body[], w: number, h: number, pad = 32): View {
  if (!bodies.length) return { x: w / 2, y: h / 2, k: 1 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of bodies) {
    x0 = Math.min(x0, b.x - b.r);
    y0 = Math.min(y0, b.y - b.r);
    x1 = Math.max(x1, b.x + b.r);
    y1 = Math.max(y1, b.y + b.r);
  }
  const k = clampK(Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0), 2));
  return { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
}

/** The body under a screen point (with a finger's slack), the nearest first. */
export function hitTest(bodies: readonly Body[], v: View, sx: number, sy: number, slack = 10): Body | null {
  const mx = (sx - v.x) / v.k;
  const my = (sy - v.y) / v.k;
  let best: Body | null = null;
  let bestD = Infinity;
  for (const b of bodies) {
    const d = Math.hypot(b.x - mx, b.y - my);
    if (d <= b.r + slack / v.k && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}
