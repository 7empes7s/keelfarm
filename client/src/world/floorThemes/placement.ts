// Where a floor theme's props stand (#370, #371): in the decoration slots (#210) the floor hasn't filled, sized to fit them,
// so they never block a desk or a walkway (the slots' rooms are kept clear and planned round, decor.ts). An earned
// decoration always keeps its slot: the theme's prop there steps aside. Its big set pieces (#570) stand in the two
// aisles between the desks, kept clear on every floor like the slots. Pure; tested in floorThemes.test.ts.

import { DECOR_SLOTS, type DecorItem, type DecorKind } from '../../../../shared/progress';
import { footprint, spotOf } from '../decor/decor';
import { HALF_D, rect, type Rect } from '../layout';
import type { SetSpot, ThemePack, ThemeProp } from './packs';

/** A prop's size in its own frame (w across its front, d front to back, h tall), the slot kind it goes in, and its solid part. */
interface PropSpec {
  kind: DecorKind;
  w: number;
  d: number;
  h: number;
  /** Turned round in its slot: the TV faces the couch, which is behind the slot's front. */
  flip?: boolean;
  /** What you bump into, when it's less than the whole (a planter's pot, not its leaves). */
  solid?: { w: number; d: number };
}

export const PROP_SPECS: Record<ThemeProp, PropSpec> = {
  arcade: { kind: 'floor', w: 0.8, d: 0.75, h: 1.85 },
  'arcade-pair': { kind: 'big', w: 1.75, d: 0.78, h: 1.85 },
  'tv-console': { kind: 'big', w: 1.9, d: 0.6, h: 1.45, flip: true },
  figurines: { kind: 'floor', w: 0.8, d: 0.45, h: 1.6 },
  'gaming-chair': { kind: 'floor', w: 0.7, d: 0.7, h: 1.3 },
  'neon-pad': { kind: 'wall', w: 1.8, d: 0.06, h: 0.9 },
  'neon-gg': { kind: 'wall', w: 1.4, d: 0.06, h: 0.8 },
  posters: { kind: 'wall', w: 2.3, d: 0.04, h: 1.0 },
  'level-sketch': { kind: 'wall', w: 2.2, d: 0.05, h: 1.2 },
  'neon-rug': { kind: 'rug', w: 0, d: 0, h: 0.01 },
  bull: { kind: 'big', w: 1.5, d: 0.8, h: 1.3 },
  bear: { kind: 'big', w: 1.5, d: 0.8, h: 1.3 },
  'quote-pod': { kind: 'big', w: 1.8, d: 0.6, h: 1.7 },
  'tall-planter': { kind: 'floor', w: 0.6, d: 0.6, h: 1.7, solid: { w: 0.45, d: 0.45 } },
  'chart-screen': { kind: 'wall', w: 2.0, d: 0.06, h: 1.15 },
  'news-screen': { kind: 'wall', w: 2.2, d: 0.06, h: 1.24 },
  'navy-rug': { kind: 'rug', w: 0, d: 0, h: 0.01 },
  // #371
  'drafting-pair': { kind: 'big', w: 2.1, d: 1.0, h: 1.25 },
  'material-shelf': { kind: 'big', w: 2.0, d: 0.5, h: 1.8 },
  easel: { kind: 'floor', w: 0.7, d: 0.6, h: 1.75, solid: { w: 0.55, d: 0.45 } },
  'arc-lamp': { kind: 'floor', w: 0.6, d: 0.6, h: 2.0, solid: { w: 0.4, d: 0.4 } },
  'mood-board': { kind: 'wall', w: 2.3, d: 0.05, h: 1.3 },
  'swatch-strip': { kind: 'wall', w: 2.2, d: 0.04, h: 0.6 },
  'art-print': { kind: 'wall', w: 1.6, d: 0.05, h: 1.1 },
  'swatch-rug': { kind: 'rug', w: 0, d: 0, h: 0.01 },
  'edit-bay': { kind: 'big', w: 2.2, d: 1.25, h: 1.35 },
  'green-screen': { kind: 'big', w: 2.3, d: 1.35, h: 2.4 },
  'ring-light': { kind: 'floor', w: 0.6, d: 0.6, h: 1.8, solid: { w: 0.4, d: 0.4 } },
  softbox: { kind: 'floor', w: 0.8, d: 0.7, h: 1.8, solid: { w: 0.45, d: 0.45 } },
  'film-posters': { kind: 'wall', w: 2.3, d: 0.04, h: 1.0 },
  waveform: { kind: 'wall', w: 2.2, d: 0.06, h: 0.9 },
  'shot-list': { kind: 'wall', w: 2.0, d: 0.04, h: 1.2 },
  'studio-rug': { kind: 'rug', w: 0, d: 0, h: 0.01 },
  'rack-pair': { kind: 'big', w: 1.8, d: 0.9, h: 2.1 },
  'training-room': { kind: 'big', w: 2.3, d: 1.35, h: 2.3 },
  'server-rack': { kind: 'floor', w: 0.75, d: 0.8, h: 2.0 },
  'mobile-board': { kind: 'floor', w: 0.9, d: 0.5, h: 1.8 },
  equations: { kind: 'wall', w: 2.3, d: 0.05, h: 1.2 },
  'net-diagram': { kind: 'wall', w: 2.0, d: 0.05, h: 1.1 },
  'lab-rug': { kind: 'rug', w: 0, d: 0, h: 0.01 },
  'noc-console': { kind: 'big', w: 2.2, d: 1.2, h: 1.3 },
  ups: { kind: 'floor', w: 0.6, d: 0.75, h: 1.2 },
  'network-map': { kind: 'wall', w: 2.2, d: 0.06, h: 1.2 },
  runbook: { kind: 'wall', w: 1.8, d: 0.04, h: 1.1 },
  'grid-rug': { kind: 'rug', w: 0, d: 0, h: 0.01 },
  // #570
  'arcade-row': { kind: 'big', w: 2.45, d: 0.78, h: 1.85 },
  'game-lounge': { kind: 'big', w: 2.4, d: 1.3, h: 1.45 },
  'camera-set': { kind: 'big', w: 2.4, d: 1.3, h: 2.0 },
  'anchor-desk': { kind: 'big', w: 2.4, d: 1.3, h: 2.3 },
  'story-board': { kind: 'big', w: 2.3, d: 0.6, h: 1.9 },
  'paper-stack': { kind: 'floor', w: 0.7, d: 0.5, h: 0.95 },
  'front-pages': { kind: 'wall', w: 2.2, d: 0.04, h: 1.1 },
  'news-rug': { kind: 'rug', w: 0, d: 0, h: 0.01 },
};

// ---------- the set pieces' aisles (#570) ----------

/**
 * The aisles between the desk columns, between the middle and front rows: in view from the elevator on a desktop,
 * clear of the sight lines to the app screen and the north-east picture. Each faces the elevator; w x d is the most a
 * piece there may take.
 */
export const SET_SPOTS: Record<SetSpot, { x: number; z: number; w: number; d: number }> = {
  'aisle-w': { x: -7.3, z: 1.0, w: 2.5, d: 1.4 },
  'aisle-e': { x: 7.3, z: 1.0, w: 2.5, d: 1.4 },
};

/** Both aisles' whole room, on every office floor: people and the roomba plan round it, themed or not. */
export const reservedSetRects = (): Rect[] => Object.values(SET_SPOTS).map((s) => rect(s.x, s.z, s.w, s.d, 2.4));

export interface PlacedProp {
  slot: string;
  prop: ThemeProp;
  /** The middle of its footprint on the floor (y: the middle of a wall prop), facing rotY. */
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** A rug's size, from its slot. */
  w: number;
  d: number;
}

const kindOf = (slot: string) => DECOR_SLOTS.find((d) => d.id === slot)?.kind;

/** Where `prop` stands in `slot`, or null when the slot is unknown or of another kind. */
export function placeProp(slot: string, prop: ThemeProp): PlacedProp | null {
  const s = spotOf(slot);
  const spec = PROP_SPECS[prop];
  if (!s || kindOf(slot) !== spec.kind) return null;
  const rug = spec.kind === 'rug';
  const out = s.back ? spec.d / 2 + 0.02 : 0;
  return {
    slot,
    prop,
    x: s.x + Math.sin(s.rotY) * out,
    y: s.y ?? 0,
    z: s.z + Math.cos(s.rotY) * out,
    rotY: s.rotY + (spec.flip ? Math.PI : 0),
    w: rug ? s.w - 0.3 : spec.w,
    d: rug ? s.d - 0.3 : spec.d,
  };
}

/** A set piece in its aisle, facing the elevator. */
function placeSetPiece(spot: SetSpot, prop: ThemeProp): PlacedProp {
  const s = SET_SPOTS[spot];
  const spec = PROP_SPECS[prop];
  return { slot: spot, prop, x: s.x, y: 0, z: s.z, rotY: 0, w: spec.w, d: spec.d };
}

/** The pack's props on a floor: its set pieces, and every slot it names that no earned decoration fills. */
export function themeProps(pack: ThemePack | null, placed: Record<string, DecorItem> | undefined): PlacedProp[] {
  if (!pack) return [];
  const pieces = Object.entries(pack.setPieces).map(([spot, prop]) => placeSetPiece(spot as SetSpot, prop));
  const slots = Object.entries(pack.props)
    .filter(([slot]) => !placed?.[slot])
    .map(([slot, prop]) => placeProp(slot, prop))
    .filter((p): p is PlacedProp => !!p);
  return [...pieces, ...slots];
}

/** What you (and the toys) bump into: the props standing on the floor. */
export function themePropRects(pack: ThemePack | null, placed: Record<string, DecorItem> | undefined): Rect[] {
  return themeProps(pack, placed)
    .filter((p) => PROP_SPECS[p.prop].kind === 'floor' || PROP_SPECS[p.prop].kind === 'big')
    .map((p) => {
      const spec = PROP_SPECS[p.prop];
      const solid = spec.solid ?? spec;
      return footprint(p.x, p.z, solid.w, solid.d, p.rotY, spec.h);
    });
}

// ---------- the ops control room's curved status wall (#371) ----------

/** Its panels: COLS across a gentle arc (radius R) centred on the north wall's big-screen spot, ROWS high. */
export const NOC_BANK = { x: 10, wallZ: -HALF_D + 0.06, cols: 4, rows: 2, w: 0.9, h: 0.78, gap: 0.06, r: 5, y0: 1.6 };

/** Where each panel of the status wall hangs and which way it faces, row by row from the top left. */
export function nocPanels(): { x: number; y: number; z: number; rotY: number }[] {
  const b = NOC_BANK;
  const step = (b.w + b.gap) / b.r;
  const out: { x: number; y: number; z: number; rotY: number }[] = [];
  for (let row = 0; row < b.rows; row++)
    for (let c = 0; c < b.cols; c++) {
      const a = (c - (b.cols - 1) / 2) * step;
      out.push({ x: b.x + b.r * Math.sin(a), y: b.y0 + (b.rows - 1 - row) * (b.h + b.gap), z: b.wallZ + b.r * (1 - Math.cos(a)), rotY: -a });
    }
  return out;
}

/** What the status wall takes up on the floor (it hangs low enough to bump into): its panels' outer edges, from the wall. */
export function nocBankRect(): Rect {
  const b = NOC_BANK;
  const edges = nocPanels().flatMap((p) => [-1, 1].map((s) => ({ x: p.x + s * (b.w / 2) * Math.cos(p.rotY), z: p.z - s * (b.w / 2) * Math.sin(p.rotY) })));
  return { minX: Math.min(...edges.map((e) => e.x)), maxX: Math.max(...edges.map((e) => e.x)), minZ: -HALF_D, maxZ: Math.max(...edges.map((e) => e.z)) + 0.06, h: b.y0 + b.rows * (b.h + b.gap) };
}

/** A theme's pieces hung on the walls that you can bump into: the ops room's status wall. */
export const themeWallRects = (pack: ThemePack | null): Rect[] => (pack?.wallScreen === 'noc' ? [nocBankRect()] : []);
