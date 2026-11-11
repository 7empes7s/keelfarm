// One of each page (#396): which pages and sheets are on screen (the threads, what the CEO remembers), so a side
// panel never shows one that's already open, and asking for it again brings the open one to the front instead of a
// copy. Pure rules, then the live store.
import { useEffect, useId } from 'react';
import { create } from 'zustand';

export type SurfaceId = 'threads' | 'memory';

/** What's on screen: each entry one place (`by`) showing a surface, the latest last. */
export type Surfaces = readonly { id: SurfaceId; by: string }[];

/** `by` shows `id`, on top. */
export const showSurface = (s: Surfaces, id: SurfaceId, by: string): Surfaces => [...s.filter((x) => x.by !== by), { id, by }];

/** `by` closed. */
export const hideSurface = (s: Surfaces, by: string): Surfaces => (s.some((x) => x.by === by) ? s.filter((x) => x.by !== by) : s);

/** Whether `id` is already on screen, somewhere other than `by` (a side panel asking about its own copy). */
export const isShowing = (s: Surfaces, id: SurfaceId, by?: string) => s.some((x) => x.id === id && x.by !== by);

// ---------- the live store ----------

const useSurfaces = create<{ open: Surfaces }>(() => ({ open: [] }));

/** Registers this component as showing `id` while `on`. */
export function useSurface(id: SurfaceId | undefined, on = true) {
  const by = useId();
  useEffect(() => {
    if (!id || !on) return;
    useSurfaces.setState((s) => ({ open: showSurface(s.open, id, by) }));
    return () => useSurfaces.setState((s) => ({ open: hideSurface(s.open, by) }));
  }, [id, on, by]);
}

/** Whether `id` is on screen (a side panel hides its own copy then). */
export const useShowing = (id: SurfaceId) => useSurfaces((s) => isShowing(s.open, id));

/** Opens `id` with `open`, unless it's already on screen: then that one takes the focus instead of a copy opening. */
export function openOnce(id: SurfaceId, open: () => void) {
  if (!isShowing(useSurfaces.getState().open, id)) return open();
  setTimeout(() => document.querySelector<HTMLElement>(`[data-surface="${id}"]`)?.focus(), 0); // after a sheet closing hands its focus back
}
