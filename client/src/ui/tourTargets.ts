// Where each control the tour points at is drawn (#517), per track, and what a step's page shows: so a step never
// points at nothing. Pure: tourSteps.test.ts checks every step resolves on each of its tracks and every id is real.
import type { TourPage, TourStep, Track } from './tourSteps';

const ALL: Track[] = ['phone', 'desk', 'office'];

/** `data-tour` ids, and the tracks they're on screen on with nothing open (pocket's Company tab, the 3D floor). */
export const TARGET_TRACKS: Record<string, Track[]> = {
  phone: ['office'], // the 3D office's phone button
  options: ['office'], // the 3D phone HUD's Options, holding what its row has no room for
  switch: ['desk', 'office'],
  'pocket-tabs': ['phone', 'desk'],
  chat: ['phone', 'desk'], // the Chat tab, or the chat button top right
  previews: ['desk'], // the rail's; a phone's is in Settings
  console: ALL, // pocket's Settings, the 3D HUD's Settings pill
  search: ALL,
  bell: ALL,
  sound: ALL,
  info: ['phone', 'desk'],
  guide: ALL, // pocket's Company card, the 3D HUD's pill, while it has something left (its page opens it)
};

/** What each page a step opens shows (a `page` step's targets may be there instead). */
export const PAGE_TARGETS: Record<TourPage, string[]> = {
  chat: ['chat-full', 'chat-more', 'chat-charts'],
  charter: ['charter'],
  costs: ['costs'],
  home: [],
  guide: ['guide'],
};

/** Whether a step's ring has something to go round on `track`: a target drawn there, or on the page it opens. */
export function resolves(step: Pick<TourStep, 'targets' | 'page'>, track: Track): boolean {
  const targets = step.targets ?? [];
  if (!targets.length) return true; // a step about the whole view (Look around) rings nothing
  return targets.some((t) => TARGET_TRACKS[t]?.includes(track) || (!!step.page && PAGE_TARGETS[step.page].includes(t)));
}
