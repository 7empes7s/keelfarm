// Floors: their GitHub state, a merge's gong and confetti, and which floor the viewer stands on.
import type { RepoPatch, RepoView } from '../../../../shared/types';
import { coversView, qaKey } from '../../store';
import { cue } from '../../ui/sfx';
import { emitMerge, mergeBursts, recentQaRecord } from '../../world/confetti';
import { gongForMerge } from '../../world/gongRunner';
import { ROOF } from '../../world/layout';
import type { ApplyCtx, ApplyHandlers, SnapshotPart } from './types';

/** One floor in full, or a batch of floors' changes (server/outbox.ts). */
function applyRepos(patches: (RepoView | RepoPatch)[], { set, get, live, cues }: ApplyCtx) {
  let repos = get().repos;
  const bursts: ReturnType<typeof mergeBursts> = [];
  const covered = coversView(get().overlay);
  for (const patch of patches) {
    const before = repos.find((r) => r.id === patch.id);
    if (!before && patch.fullName === undefined) continue; // a change to a floor this tab no longer has
    const next = { ...before, ...patch } as RepoView;
    const qaFor = (n: number) => get().qa[qaKey(next.id, n)] ?? recentQaRecord(qaKey(next.id, n));
    const merged = mergeBursts(live, before, next, qaFor, Object.values(get().agents));
    // A merge on the player's floor sends its author running to bang the gong (or it bangs by itself) and the
    // floor celebrates; anywhere else it's the chime.
    if (merged.map((b) => gongForMerge(b, covered)).includes('absent') && cues) cue('merged');
    bursts.push(...merged);
    repos = [...repos.filter((r) => r.id !== next.id), next];
  }
  set({ repos: repos.sort((a, b) => a.floor - b.floor) });
  for (const b of bursts) emitMerge(b);
}

export const handlers = {
  repo: (ev, c) => applyRepos([ev.repo], c),
  repos: (ev, c) => applyRepos(ev.repos, c),
  repoRemoved: (ev, { set, get }) => {
    const repos = get().repos.filter((r) => r.id !== ev.repoId);
    const floor = get().floor > repos.length ? 0 : get().floor;
    set({ repos, floor });
  },
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d, { get }) => {
  // Stay on the current (or remembered) floor if it still exists (the roof always does); otherwise go to the lobby.
  const floorExists = get().floor === ROOF || d.repos.some((r) => r.floor === get().floor);
  return { repos: d.repos.sort((a, b) => a.floor - b.floor), floor: floorExists ? get().floor : 0 };
};
