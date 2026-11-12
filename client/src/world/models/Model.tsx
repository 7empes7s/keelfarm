// The registry's models in the scene (#535): each file loaded once (three's GLTFLoader and meshopt decoder, imported
// lazily so they stay out of the first download), its colours redrawn in the office's toon materials, and every
// placement of a model drawn as one instanced mesh per part. A model that fails to load (a 404, a broken file) never
// throws: its placements draw their fallback shapes instead, as they do while it loads. `window.__swarmModels` says
// how each one went, for QA.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { toon } from '../materials';
import { fitModel, modelUrl, type ModelName } from './registry';

type V3 = [number, number, number];

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4; // the part's place in the model
}
interface Loaded {
  parts: Part[];
  box: { min: V3; max: V3 };
}

const cache = new Map<ModelName, Promise<Loaded | null>>();
const status: Record<string, 'loading' | 'ok' | 'failed'> = {};
(window as unknown as { __swarmModels?: typeof status }).__swarmModels = status;

async function load(name: ModelName): Promise<Loaded | null> {
  status[name] = 'loading';
  try {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')]);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const { scene } = await loader.loadAsync(modelUrl(name, import.meta.env.BASE_URL));
    scene.updateMatrixWorld(true);
    const parts: Part[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      parts.push({ geometry: mesh.geometry, material: toon(`#${m.color?.getHexString() ?? 'cccccc'}`), matrix: mesh.matrixWorld.clone() });
    });
    const b = new THREE.Box3().setFromObject(scene);
    status[name] = 'ok';
    return { parts, box: { min: b.min.toArray(), max: b.max.toArray() } };
  } catch {
    status[name] = 'failed';
    return null;
  }
}

/** The model, once loaded; null while loading, or for good when it failed. */
function useLoaded(name: ModelName): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let alive = true;
    let p = cache.get(name);
    if (!p) cache.set(name, (p = load(name)));
    void p.then((l) => alive && setLoaded(l));
    return () => {
      alive = false;
    };
  }, [name]);
  return loaded;
}

/** Where one copy stands: its middle on the floor at x, z (y up from there), turned rotY. */
export interface Placement {
  x: number;
  z: number;
  y?: number;
  rotY?: number;
}

function Instances({ part, matrices }: { part: Part; matrices: THREE.Matrix4[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);
  return <instancedMesh ref={ref} args={[part.geometry, part.material, matrices.length]} castShadow receiveShadow />;
}

/**
 * A registry model at each of `at`, scaled to fit `size` (x, y, z; proportions kept), its middle on x and z and its
 * bottom on the floor. `fallback` draws one placement in shapes, for while it loads or if it can't.
 */
export function Model({ name, at, size, fallback }: { name: ModelName; at: Placement[]; size: V3; fallback: (p: Placement, i: number) => ReactNode }) {
  const loaded = useLoaded(name);
  const per = useMemo(() => {
    if (!loaded) return null;
    const fit = fitModel(loaded.box, size);
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...fit.offset), new THREE.Quaternion(), new THREE.Vector3(...fit.scale));
    const turn = new THREE.Quaternion();
    const places = at.map((p) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), turn.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.rotY ?? 0).clone(), new THREE.Vector3(1, 1, 1)).multiply(local));
    return loaded.parts.map((part) => ({ part, matrices: places.map((m) => m.clone().multiply(part.matrix)) }));
    // size and at are literals at the call sites: their contents are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, JSON.stringify(size), JSON.stringify(at)]);
  if (!per) return <>{at.map((p, i) => <Fragment key={i}>{fallback(p, i)}</Fragment>)}</>;
  return (
    <>
      {per.map(({ part, matrices }, i) => (
        <Instances key={i} part={part} matrices={matrices} />
      ))}
    </>
  );
}
