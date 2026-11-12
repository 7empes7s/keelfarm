// The project props' CC0 models (#536): small GLB files in client/public/models (listed in its LICENSES.md), loaded once
// each and kept, turned into one vertex-coloured geometry like the office's home-made models (decor/parts.ts), so they
// share its toon material and outline-free look. Each is fitted into the box its prop asks for. A model that fails to
// load (offline, missing, corrupt) resolves to null and its prop keeps the plain-shape stand-in.

import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { mergeParts, type Part } from '../decor/parts';

/** The models the props use, by name, as paths under /models/. */
export const MODEL_FILES = {
  shelf: 'kenney/bookcaseClosedWide.glb',
  desk: 'kenney/desk.glb',
  table: 'kenney/table.glb',
  screen: 'kenney/computerScreen.glb',
} as const;
export type ModelName = keyof typeof MODEL_FILES;

/** How a model sits in its box: w across its front (x), h tall (y), d front to back (z); `turn` it about y first. */
export interface Fit {
  w: number;
  h: number;
  d: number;
  turn?: number;
}

/** A plain copy of an attribute in float32, as quantized models store them in normalized ints. */
function floats(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, n: number) {
  const out = new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    out[i * n] = a.getX(i);
    out[i * n + 1] = a.getY(i);
    if (n > 2) out[i * n + 2] = a.getZ(i);
  }
  return new THREE.BufferAttribute(out, n);
}

/** A loaded scene as parts: each mesh's geometry in the scene's frame, its material's colour baked in. */
export function sceneParts(root: THREE.Object3D): Part[] {
  root.updateMatrixWorld(true);
  const parts: Part[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', floats(src.getAttribute('position'), 3));
    if (src.index) geo.setIndex(src.index.clone());
    geo.applyMatrix4(mesh.matrixWorld);
    geo.computeVertexNormals();
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    parts.push({ geo, color: `#${(mat?.color ?? new THREE.Color('#cccccc')).getHexString()}` });
  });
  return parts;
}

/** Fits a geometry into its box: turned, scaled on each axis, centred across and front to back, standing on y 0. */
export function fitGeometry(geo: THREE.BufferGeometry, fit: Fit): THREE.BufferGeometry {
  if (fit.turn) geo.rotateY(fit.turn);
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const size = b.getSize(new THREE.Vector3());
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.scale(fit.w / (size.x || 1), fit.h / (size.y || 1), fit.d / (size.z || 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// ---------- loading, once per file ----------

const loads = new Map<ModelName, Promise<Part[] | null>>();
const fitted = new Map<string, THREE.BufferGeometry>();

const modelUrl = (name: ModelName) => `${import.meta.env.BASE_URL}models/${MODEL_FILES[name]}`;

/** A model's parts, loaded the first time it's asked for; null when it can't be. */
export function loadModel(name: ModelName, load: (url: string) => Promise<THREE.Object3D> = defaultLoad): Promise<Part[] | null> {
  let p = loads.get(name);
  if (!p) {
    p = load(modelUrl(name)).then(
      (root) => sceneParts(root),
      (err: unknown) => {
        console.warn(`model ${MODEL_FILES[name]} didn't load; drawing its stand-in`, err);
        return null;
      },
    );
    loads.set(name, p);
  }
  return p;
}

async function defaultLoad(url: string): Promise<THREE.Object3D> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  return (await new GLTFLoader().loadAsync(url)).scene;
}

/** A model fitted into a box, once it's loaded (null until then, and for good if it fails). */
export function useModel(name: ModelName, fit: Fit): THREE.BufferGeometry | null {
  const key = `${name}:${fit.w}x${fit.h}x${fit.d}:${fit.turn ?? 0}`;
  const [geo, setGeo] = useState(() => fitted.get(key) ?? null);
  useEffect(() => {
    if (geo) return;
    let live = true;
    void loadModel(name).then((parts) => {
      if (!live || !parts?.length) return;
      let g = fitted.get(key);
      if (!g) fitted.set(key, (g = fitGeometry(mergeParts(parts.map((p) => ({ ...p, geo: p.geo.clone() }))), fit)));
      setGeo(g);
    });
    return () => {
      live = false;
    };
  }, [key, geo, name, fit]);
  return geo;
}
