// Checklists (#612): the CEO's checklists for the manager, each `checklist` event replacing its copy by id (a new one first).
import type { ApplyHandlers, SnapshotPart } from './types';

export const handlers = {
  checklist: (ev, { set, get }) => {
    const was = get().checklists;
    const c = ev.checklist;
    set({ checklists: was.some((x) => x.id === c.id) ? was.map((x) => (x.id === c.id ? c : x)) : [c, ...was] });
  },
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => ({ checklists: d.checklists ?? [] });
