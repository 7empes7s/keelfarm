// The 3D models the office loads from client/public/models (#535): CC0 kits only, each listed with its source in
// models/LICENSES.md (registry.test.ts checks both ways). Compressed with gltf-transform (meshopt + quantisation).
// Pure: which file a model is, its URL under the app's base path, and how a model's bounds fit the box it stands in.

const KENNEY_FURNITURE = 'https://kenney.nl/assets/furniture-kit';

export const MODELS = {
  deskChair: { file: 'kenney/chairDesk.glb', source: KENNEY_FURNITURE },
  monitor: { file: 'kenney/computerScreen.glb', source: KENNEY_FURNITURE },
  keyboard: { file: 'kenney/computerKeyboard.glb', source: KENNEY_FURNITURE },
  cabinet: { file: 'kenney/bookcaseClosedDoors.glb', source: KENNEY_FURNITURE },
  plant: { file: 'kenney/pottedPlant.glb', source: KENNEY_FURNITURE },
  box: { file: 'kenney/cardboardBoxClosed.glb', source: KENNEY_FURNITURE },
  bin: { file: 'kenney/trashcan.glb', source: KENNEY_FURNITURE },
} as const;

export type ModelName = keyof typeof MODELS;

/** Where a model is served: the app's base path (Vite's BASE_URL), then models/. */
export const modelUrl = (name: ModelName, base: string) => `${base.endsWith('/') ? base : `${base}/`}models/${MODELS[name].file}`;

type V3 = [number, number, number];

/**
 * How a model with bounds `box` fits a `size` box (x, y, z): one scale for every axis (proportions kept, the tightest
 * side fits), then an offset putting its middle on x and z at the origin and its bottom on the floor (y 0).
 */
export function fitModel(box: { min: V3; max: V3 }, size: V3): { scale: V3; offset: V3 } {
  const ext = box.max.map((v, i) => Math.max(1e-6, v - box.min[i]));
  const s = Math.min(...size.map((v, i) => v / ext[i]));
  const mid = (i: number) => (box.min[i] + box.max[i]) / 2;
  return { scale: [s, s, s], offset: [-mid(0) * s, -box.min[1] * s, -mid(2) * s] };
}
