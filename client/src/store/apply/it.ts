// The IT department (#524): its chat, a message at a time, and its view (on, name, working, its Telegram bot); its tickets
// (#542), health checks and recommendations (#525), and the improvements from its records (#543); the problems register's entries (#544).
import type { ApplyHandlers, SnapshotPart } from './types';

export const handlers = {
  it: (ev, { set, get }) => {
    const was = get().it?.messages ?? [];
    const m = ev.message;
    const messages = !m ? was : was.some((x) => x.id === m.id) ? was.map((x) => (x.id === m.id ? m : x)) : [...was, m];
    set({ it: { ...ev.it, messages } });
  },
  itWatch: (ev, { set }) => set({ itWatch: ev.itWatch }),
  itTickets: (ev, { set }) => set({ itTickets: ev.tickets }),
  itImprove: (ev, { set }) => set({ itImprove: ev.itImprove }),
  problems: (ev, { set }) => set({ problems: ev.problems }),
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => ({ it: d.it ?? null, itWatch: d.itWatch ?? null, itTickets: d.itTickets ?? [], itImprove: d.itImprove ?? null, problems: d.problems ?? [] });
