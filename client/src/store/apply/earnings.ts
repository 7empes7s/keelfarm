// Earnings vs. spend (#666) and the agency floors' opportunities (#667), both on the Company page: each event replaces its view.
import type { ApplyHandlers, SnapshotPart } from './types';

export const handlers = {
  earnings: (ev, { set }) => set({ earnings: ev.earnings }),
  agency: (ev, { set }) => set({ agency: ev.agency }),
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => ({ earnings: d.earnings ?? null, agency: d.agency ?? null });
