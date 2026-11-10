// Where a floor theme's props stand (#370): in the decoration slots (#210) the floor hasn't filled, sized to fit them,
// so they never block a desk or a walkway (the slots' rooms are kept clear and planned round, decor.ts). An earned
// decoration always keeps its slot: the theme's prop there steps aside. Pure; tested in floorThemes.test.ts.

import { DECOR_SLOTS, type DecorItem, type DecorKind } from '../../../../shared/progress';
import { footprint, spotOf } from '../decor/decor';
import type { Rect } from '../layout';
import type { ThemePack, ThemeProp } from './packs';

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
};

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

/** The pack's props on a floor: every slot it names that no earned decoration fills. */
export function themeProps(pack: ThemePack | null, placed: Record<string, DecorItem> | undefined): PlacedProp[] {
  if (!pack) return [];
  return Object.entries(pack.props)
    .filter(([slot]) => !placed?.[slot])
    .map(([slot, prop]) => placeProp(slot, prop))
    .filter((p): p is PlacedProp => !!p);
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
