// The back gesture and the browser's Back close the top overlay, never the app (#129). Every open panel, sheet or
// viewer is a layer with a history entry of ours; each entry carries its depth, so a popstate says how many layers
// should still be open. Opening one panel in place of another (same tick) nets out to no history change.
import { raiseIn } from './dialogFocus';

/** History steps that make our `depth` entries match `layers` open layers: > 0 push that many, < 0 go back that many. */
export const stepsTo = (layers: number, depth: number) => layers - depth;

/** How many of the top layers a Back that landed on `depth` closes. */
export const toClose = (layers: number, depth: number) => Math.max(0, layers - depth);

/** Our depth in a history entry's state (0: the app itself, or an entry that isn't ours). */
export function depthOf(state: unknown): number {
  const d = (state as { cubefarmBack?: unknown } | null)?.cubefarmBack;
  return typeof d === 'number' && Number.isInteger(d) && d > 0 ? d : 0;
}

/** A layer's history state: what was there, plus our depth (ConsoleNav keeps the state when it rewrites the hash). */
export const withDepth = (state: unknown, depth: number) => ({ ...(state && typeof state === 'object' ? state : {}), cubefarmBack: depth });

// ---------- the live stack ----------

const layers: { close: () => void }[] = [];
let depth = 0;
let waiting = false; // a history.go() of ours is on its way
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let lastPopBack = false; // the latest popstate answered our go() or closed layers: a Back, not a link

/** Whether the latest popstate was a Back (ours, or the manager's closing layers), for the hashchange after it. */
export const lastPopWasBack = () => lastPopBack;

function reconcile() {
  timer = null;
  if (waiting) return;
  const n = stepsTo(layers.length, depth);
  for (let i = 0; i < n; i++) history.pushState(withDepth(history.state, ++depth), '');
  if (n < 0) {
    waiting = true;
    history.go(n);
    // A go() past what the browser has never answers: don't wait for it forever.
    setTimeout(() => void (waiting && ((waiting = false), schedule())), 800);
  }
}

function schedule() {
  if (!timer) timer = setTimeout(reconcile, 0);
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  depth = depthOf(history.state);
  window.addEventListener('popstate', (e) => {
    depth = depthOf(e.state);
    lastPopBack = waiting || toClose(layers.length, depth) > 0;
    waiting = false;
    for (const layer of layers.slice(layers.length - toClose(layers.length, depth)).reverse()) layer.close();
    schedule();
  });
}

/**
 * Adds a layer that Back closes with `close`; returns its removal (call it when the layer goes, however it closed),
 * whose `raise` makes it the layer Back closes first (a panel beside another one clicked or focused, #212).
 */
export function pushLayer(close: () => void): (() => void) & { raise: () => void } {
  install();
  const layer = { close };
  layers.push(layer);
  schedule();
  const remove = () => {
    const i = layers.indexOf(layer);
    if (i < 0) return;
    layers.splice(i, 1);
    schedule();
  };
  return Object.assign(remove, { raise: () => void raiseIn(layers, layer) });
}
