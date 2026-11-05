// Where the viewer was standing, so a refresh puts them back on the same floor and spot.
export interface SavedView {
  floor: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}
const VIEW_KEY = 'cubefarm:view';

export function loadView(): SavedView | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as SavedView | null;
    return v && [v.floor, v.x, v.z, v.yaw, v.pitch].every(Number.isFinite) ? v : null;
  } catch {
    return null;
  }
}

export function saveView(v: SavedView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // storage may be unavailable (private mode); the view just won't be remembered
  }
}
