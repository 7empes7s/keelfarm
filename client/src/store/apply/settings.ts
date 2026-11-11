// Settings' panels and the console's tabs: voice, weather, the activity ticker, notification channels, cloud agents,
// accounts, Tools & skills, the lab, the manager's changes and History.
import { EMPTY_CLOUD } from '../../../../shared/cloud';
import { emptyLabView } from '../../../../shared/experiments';
import { EMPTY_WEATHER_VIEW } from '../../../../shared/outside';
import { EMPTY_INVENTORY } from '../../../../shared/tooling';
import type { ApplyHandlers, SnapshotPart } from './types';

const TICKER_KEEP = 120; // ticker lines kept across every floor

export const handlers = {
  voiceKey: (ev, { set }) => set({ voiceKeySet: ev.voiceKeySet, voiceKeyHint: ev.voiceKeyHint }),
  voiceCache: (ev, { set }) => set({ voiceCache: ev.voiceCache }),
  weather: (ev, { set }) => set({ weather: ev.weather }),
  ticker: (ev, { set, get }) => set({ ticker: [...get().ticker.slice(-(TICKER_KEEP - 1)), ev.item] }),
  notifyChannels: (ev, { set }) => set({ notifyChannels: ev.notifyChannels }),
  cloud: (ev, { set }) => set({ cloud: ev.cloud }),
  accounts: (ev, { set, get }) => set({ accounts: { ...ev.accounts, sources: get().accounts.sources } }),
  usageSources: (ev, { set, get }) => set({ accounts: { ...get().accounts, sources: ev.sources } }),
  providers: (ev, { set }) => set({ providers: ev.providers }),
  keyScan: (ev, { set }) => set({ keyScan: ev.keyScan }),
  tooling: (ev, { set }) => set({ tooling: ev.tooling }),
  experiments: (ev, { set }) => set({ experiments: ev.experiments }),
  managerChanges: (ev, { set }) => set({ managerChanges: ev.changes }),
  history: (_ev, { set, get }) => set({ historySeq: get().historySeq + 1 }),
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d, { get }) => ({
  voiceKeySet: d.voiceKeySet ?? false,
  voiceKeyHint: d.voiceKeyHint ?? '',
  voiceCache: d.voiceCache ?? { clips: 0, bytes: 0, saved: [], charsToday: 0 },
  weather: d.weather ?? EMPTY_WEATHER_VIEW,
  ticker: d.ticker ?? [],
  notifyChannels: d.notifyChannels ?? get().notifyChannels,
  cloud: d.cloud ?? EMPTY_CLOUD,
  accounts: d.accounts ?? { accounts: [] },
  providers: d.providers ?? { connections: [], mcp: [] },
  keyScan: d.keyScan ?? { state: 'idle', at: null, keys: [] },
  tooling: d.tooling ?? EMPTY_INVENTORY,
  experiments: d.experiments ?? emptyLabView(),
  managerChanges: d.managerChanges ?? [],
});
