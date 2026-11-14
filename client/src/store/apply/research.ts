// The Researcher's desk (#664): each `research` event replaces the view.
import type { ApplyHandlers, SnapshotPart } from './types';

export const handlers = {
  research: (ev, { set }) => set({ research: ev.research }),
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => ({ research: d.research ?? null });
