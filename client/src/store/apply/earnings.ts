// Earnings vs. spend (#666): each `earnings` event replaces the view.
import type { ApplyHandlers, SnapshotPart } from './types';

export const handlers = {
  earnings: (ev, { set }) => set({ earnings: ev.earnings }),
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => ({ earnings: d.earnings ?? null });
