// The company: who's signed in, the settings, the coding agents and models, team changes and the CEO's queue.
import { cue } from '../../ui/sfx';
import type { ApplyHandlers, SnapshotPart } from './types';

export const handlers = {
  settings: (ev, { set }) => set({ settings: ev.settings }),
  clis: (ev, { set }) => set({ clis: ev.clis }),
  sdkUpdate: (ev, { set }) => set({ sdkUpdate: ev.sdkUpdate }),
  models: (ev, { set }) => set({ models: ev.models }),
  request: (ev, { set, get, cues }) => {
    const prev = get().requests.find((r) => r.id === ev.request.id);
    if (cues && ev.request.kind === 'hire' && ev.request.status === 'approved' && prev?.status === 'pending') cue('welcome');
    const requests = get().requests.filter((r) => r.id !== ev.request.id);
    requests.push(ev.request);
    set({ requests: requests.sort((a, b) => a.createdAt - b.createdAt) });
  },
  ceo: (ev, { set }) => set({ ceo: ev.ceo }),
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => ({
  user: d.user,
  ghReady: d.ghReady,
  ghError: d.ghError,
  demo: d.demo,
  publicDemo: d.publicDemo ?? null,
  machinesRoot: d.machinesRoot,
  settings: d.settings,
  requests: d.requests,
  ceo: d.ceo,
  clis: d.clis ?? [],
  sdkUpdate: d.sdkUpdate ?? null,
  models: d.models ?? { entries: [], checkedAt: 0 },
});
