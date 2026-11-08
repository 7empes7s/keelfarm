// The 3D world's shared parts: other visitors (poses, emotes and pings go straight to the view, world/presence/
// presence.ts), progression and rewards, and the ping-pong leaderboards.
import { emitReward } from '../../world/decor/rewards';
import { takeEmote, takePing, takePose, takeRoster } from '../../world/presence/presenceState';
import type { ApplyHandlers, SnapshotPart } from './types';

export const handlers = {
  visitors: (ev, { set, get }) => {
    set({ visitors: ev.visitors });
    takeRoster(ev, get().floor);
  },
  visitorPose: (ev, { get }) => takePose(ev, get().floor),
  visitorEmote: (ev) => takeEmote(ev),
  visitorPing: (ev) => takePing(ev),
  progress: (ev, { set }) => set({ progress: ev.progress }),
  pastCareers: (ev, { set }) => set({ pastCareers: ev.past }),
  reward: (ev, { live }) => {
    if (live) emitReward(ev.reward);
  },
  pong: (ev, { set, get }) => set({ pong: { ...get().pong, [ev.repoId]: ev.board } }),
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => ({
  progress: d.progress ?? { floors: {}, achievements: [], coffees: 0, merges: 0 },
  pastCareers: d.pastCareers ?? [],
  pong: d.pong ?? {},
});
