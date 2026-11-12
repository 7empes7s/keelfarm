// The IT department (#524): its chat, a message at a time, and its view (on, name, working, its Telegram bot); its tickets
// (#542), health checks and recommendations (#525).
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
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => ({ it: d.it ?? null, itWatch: d.itWatch ?? null, itTickets: d.itTickets ?? [] });
