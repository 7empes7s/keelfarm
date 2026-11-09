// The memory map's 2D / 3D switch (#314): which stage it draws with (the flat canvas or the map room's constellation),
// remembered on this device, and 2D only where the 3D one can't run (no WebGL, or a low-power device).
export type MapView = '2d' | '3d';

const KEY = 'cubefarm:map-view';

/** Why this device stays on 2D, in plain words, or null when the constellation can run. */
export function no3dReason(x: { webgl: boolean; lowPower: boolean }): string | null {
  if (!x.webgl) return 'This browser can’t draw 3D, so the map stays in 2D.';
  if (x.lowPower) return 'This device is low on power, so the map stays in 2D.';
  return null;
}

/** The stage to show: the saved choice, 2D when nothing is saved or 3D can't run here. */
export function pickMapView(saved: string | null, can3d: boolean): MapView {
  return saved === '3d' && can3d ? '3d' : '2d';
}

export function savedMapView(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // no storage: 2D
  }
}

export function saveMapView(view: MapView) {
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // remembered for this visit only
  }
}

/** Whether this browser has WebGL and isn't a low-power device (data saver, or 2 GB of memory or less). */
export function deviceFor3d(): { webgl: boolean; lowPower: boolean } {
  let webgl = false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    webgl = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // no WebGL
  }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const lowPower = !!nav.connection?.saveData || (nav.deviceMemory !== undefined && nav.deviceMemory <= 2);
  return { webgl, lowPower };
}
