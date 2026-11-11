// The themed floors' screen kit (#370, #371), shared by both lazy scene files (scenes.tsx, studioScenes.tsx): pictures
// drawn once and kept, their glowing materials, and pictures and screens hung on a wall prop's face.

import * as THREE from 'three';
import { vertexToon } from '../decor/parts';
import { BLOOM } from '../gfx/bloomMarks';
import type { PlacedProp } from './placement';
import * as M from './themeModels';

export type Pose = { x: number; y: number; z: number; rotY: number };

// ---------- pictures drawn once ----------

const statics = new Map<string, THREE.CanvasTexture>();

/** A picture that never changes, drawn the first time it's asked for and kept for the session (shared by every copy). */
export function staticTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  let t = statics.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    statics.set(key, t);
  }
  return t;
}

const mats = new Map<THREE.Texture, THREE.MeshBasicMaterial>();

/** The glowing material for a picture, made once per picture like the picture itself. */
export function screenMat(map: THREE.Texture, transparent = false) {
  let m = mats.get(map);
  if (!m) mats.set(map, (m = new THREE.MeshBasicMaterial({ map, toneMapped: false, transparent, userData: BLOOM })));
  return m;
}

/** A plane on a wall prop's face, a little out from the wall. */
export function WallPicture({ at, w, h, map, transparent }: { at: PlacedProp; w: number; h: number; map: THREE.Texture; transparent?: boolean }) {
  return (
    <mesh position={[at.x + Math.sin(at.rotY) * 0.05, at.y, at.z + Math.cos(at.rotY) * 0.05]} rotation={[0, at.rotY, 0]} material={screenMat(map, transparent)}>
      <planeGeometry args={[w, h]} />
    </mesh>
  );
}

/** A screen hung on the wall: its housing and its picture. */
export function WallScreen({ at, w, h, map }: { at: PlacedProp; w: number; h: number; map: THREE.Texture }) {
  return (
    <>
      <mesh geometry={M.wallScreenModel(w, h)} material={vertexToon} position={[at.x, at.y, at.z]} rotation={[0, at.rotY, 0]} />
      <WallPicture at={at} w={w} h={h} map={map} />
    </>
  );
}
