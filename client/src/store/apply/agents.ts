// Agents: who is in the office, their terminal lines and chats for the panels this tab shows, and their screenshots.
import type { LogLine } from '../../../../shared/types';
import { careerOfRow } from '../../../../shared/careers';
import { latestListed } from '../../../../shared/watch';
import { mergeChat } from '../../../../shared/agentChat';
import type { Agent } from '../../store';
import { cue } from '../../ui/sfx';
import type { ApplyHandlers, SnapshotPart } from './types';

const LOG_KEEP = 600;

export const handlers = {
  agent: (ev, { set, get, cues }) => {
    const prev = get().agents[ev.agent.id];
    if (cues && !prev && ev.agent.role !== 'ceo') cue('welcome');
    if (cues && prev && prev.status !== 'error' && ev.agent.status === 'error') cue('error');
    set({ agents: { ...get().agents, [ev.agent.id]: ev.agent } });
  },
  agents: (ev, { set, get, cues }) => {
    // a batch of changes (server/outbox.ts): one update for all of them
    const agents = { ...get().agents };
    for (const patch of ev.agents) {
      const prev = agents[patch.id];
      if (!prev && patch.name === undefined) continue; // a change to someone this tab no longer has
      const next = { ...prev, ...patch } as Agent;
      if (cues && !prev && next.role !== 'ceo') cue('welcome');
      if (cues && prev && prev.status !== 'error' && next.status === 'error') cue('error');
      agents[patch.id] = next;
    }
    set({ agents });
  },
  agentRemoved: (ev, { set, get }) => {
    const { [ev.agentId]: _gone, ...agents } = get().agents;
    set({ agents });
  },
  logs: (ev, { set, get }) => {
    const logs = { ...get().logs };
    const latest = { ...get().latest };
    for (const [id, lines] of Object.entries(ev.tails)) {
      // a catch-up replaces the buffer; live lines it already had (sent again after one) are skipped
      const prev = ev.catchUp ? [] : (logs[id] ?? []);
      const last = prev.length ? prev[prev.length - 1].id : -1;
      const fresh = ev.catchUp ? lines : lines.filter((l) => l.id > last);
      if (!fresh.length && !ev.catchUp) continue;
      const next = prev.concat(fresh);
      logs[id] = next.length > LOG_KEEP ? next.slice(-LOG_KEEP) : next;
      const listed = latestListed(fresh, 80);
      if (listed) latest[id] = listed;
    }
    set({ logs, latest });
  },
  latest: (ev, { set, get }) => set({ latest: { ...get().latest, ...ev.lines } }),
  agentChat: (ev, { set, get }) => {
    const chats = { ...get().agentChat };
    for (const [id, items] of Object.entries(ev.chats)) chats[id] = mergeChat(ev.catchUp ? [] : (chats[id] ?? []), items);
    set({ agentChat: chats });
  },
  screen: (ev, { set, get }) => {
    const a = get().agents[ev.agentId];
    set({
      screens: { ...get().screens, [ev.agentId]: ev.at },
      shotTimes: { ...get().shotTimes, [ev.agentId]: ev.earlier ?? [] },
      agents: a ? { ...get().agents, [ev.agentId]: { ...a, hasScreenshot: true, screenshotAt: ev.at, browserUrl: ev.url || a.browserUrl } } : get().agents,
    });
  },
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => {
  const agents: Record<string, Agent> = {};
  const logs: Record<string, LogLine[]> = {};
  const screens: Record<string, number> = {};
  for (const { log, ...a } of d.agents) {
    agents[a.id] = d.careers?.[a.id] ? { ...a, career: careerOfRow(d.careers[a.id]) } : a;
    logs[a.id] = log;
    if (a.screenshotAt) screens[a.id] = a.screenshotAt;
  }
  return { agents, logs, latest: {}, screens };
};
