// Comms (#668): each `comms` event replaces the view.
import type { ApplyHandlers, SnapshotPart } from './types';

export const handlers = {
  comms: (ev, { set }) => set({ comms: ev.comms }),
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => ({ comms: d.comms ?? null });
