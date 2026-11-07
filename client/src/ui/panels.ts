// The panel manager (#212): the order of what's open beside the pages and the CEO chat on a desktop or tablet (pocket
// mode's console and its pane), so whatever was opened or touched last is on top. Pure rules, then the live store.
// A panel in a slot that's taken replaces what was there, past `max` the oldest goes, and either leaves a back chip.
import { create } from 'zustand';

export interface PanelEntry<T = unknown> {
  key: string;
  /** Where it shows: one panel per slot. */
  slot: string;
  /** What the back chip says ("Ada's terminal"). */
  label: string;
  /** What reopens it from the back chip. */
  value: T;
}

export interface Panels<T = unknown> {
  /** Bottom to top. */
  open: PanelEntry<T>[];
  /** The last panel something replaced: the back chip, until it's used or that slot closes. */
  back: PanelEntry<T> | null;
}

/** At most two content panels beside the chat. */
const MAX_PANELS = 2;

export const noPanels: Panels<never> = { open: [], back: null };

/** Opens `p` on top: already open, it comes up; else it takes its slot's place, and past `max` the oldest goes. */
export function openPanel<T>(s: Panels<T>, p: PanelEntry<T>, max = MAX_PANELS): Panels<T> {
  if (s.open.some((x) => x.key === p.key)) return { ...s, open: [...s.open.filter((x) => x.key !== p.key), p] };
  const taken = s.open.find((x) => x.slot === p.slot);
  let open = [...s.open.filter((x) => x !== taken), p];
  let back = taken ?? s.back;
  if (open.length > max) {
    back = open[0];
    open = open.slice(open.length - max);
  }
  return { open, back: back?.key === p.key ? null : back };
}

/** Brings an open panel to the top (a click or focus in it); unknown keys change nothing. */
export function focusPanel<T>(s: Panels<T>, key: string): Panels<T> {
  const p = s.open.find((x) => x.key === key);
  return !p || s.open[s.open.length - 1] === p ? s : { ...s, open: [...s.open.filter((x) => x !== p), p] };
}

/** Closes `key`, or the top panel when none is given (Esc, Back). */
export function closePanel<T>(s: Panels<T>, key?: string): Panels<T> {
  const p = key === undefined ? s.open[s.open.length - 1] : s.open.find((x) => x.key === key);
  return p ? { open: s.open.filter((x) => x !== p), back: s.back?.slot === p.slot ? null : s.back } : s;
}

/** Closes every panel in `slot`. */
export function closeSlot<T>(s: Panels<T>, slot: string): Panels<T> {
  return s.open.some((x) => x.slot === slot) ? { open: s.open.filter((x) => x.slot !== slot), back: s.back?.slot === slot ? null : s.back } : s;
}

export const topPanel = <T>(s: Panels<T>): PanelEntry<T> | null => s.open[s.open.length - 1] ?? null;

/** A slot's stacking order among the panels: 1 at the bottom, 0 when nothing is open there. */
export const layerOf = (s: Panels, slot: string) => s.open.findIndex((x) => x.slot === slot) + 1;

/** The docked CEO chat's width on a desktop: dragged or nudged between these, remembered on the device. */
export const DOCK_MIN = 360;
export const DOCK_MAX = 520;
export const DOCK_DEFAULT = 380;

/** A saved or dragged chat width, kept within the dock's range (nonsense: the default). */
export function dockWidth(v: unknown): number {
  const n = typeof v === 'string' && v.trim() ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, n))) : DOCK_DEFAULT;
}

// ---------- the live store ----------

export const usePanels = create<Panels>(() => noPanels);

export const panels = {
  open: (p: PanelEntry) => usePanels.setState((s) => openPanel(s, p)),
  focus: (key: string) => usePanels.setState((s) => focusPanel(s, key)),
  close: (key?: string) => usePanels.setState((s) => closePanel(s, key)),
  closeSlot: (slot: string) => usePanels.setState((s) => closeSlot(s, slot)),
  dropBack: () => usePanels.setState({ back: null }),
};
