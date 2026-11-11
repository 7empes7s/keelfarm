import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '../api';
import { qaKey, useStore } from '../store';
import { currentChannel, watchSays, type Channel } from './channels';

// The PR theatre in the browser: which channel each floor's screen is on (this tab's choice), switching channels
// (a PR's preview starts when it isn't up yet), the open viewer's heartbeat that keeps its PR preview from stopping,
// and window.__swarmPreviews for QA.

/** How often an open, visible viewer tells the office what it has on screen (the office counts a viewer gone after 40 s). */
const WATCH_EVERY_MS = 15_000;

export const useChannels = create<{ channels: Record<string, Channel> }>(() => ({ channels: {} }));

/** The channel a floor's screen is on: the picked PR while it's open, otherwise main. */
export function useChannel(repoId: string): Channel {
  const picked = useChannels((s) => s.channels[repoId]);
  const pulls = useStore((s) => s.repos.find((r) => r.id === repoId)?.pulls);
  return currentChannel(picked, pulls ?? []);
}

/** Put a floor's screen on a channel. A PR with no preview yet gets one; a failed one waits for "Try again". */
export function tuneChannel(repoId: string, pr: Channel) {
  // The time-lapse shows a recorded day: the theatre's previews are live, so they're off while it plays.
  if (useStore.getState().replaying) {
    useStore.getState().pushToast('info', 'Replaying: the PR theatre is live only. Press Esc to go back to the live office.');
    return;
  }
  useChannels.setState((s) => ({ channels: { ...s.channels, [repoId]: pr } }));
  if (pr == null || useStore.getState().prPreviews[qaKey(repoId, pr)]) return;
  void api.startPrPreview(repoId, pr).catch(() => undefined);
}

/** This tab, to the office: one viewer, whose latest word on what's on screen replaces its last. */
const VIEWER = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return `viewer-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
})();

/**
 * While the app viewer is open: tell the office which preview is on screen (main too, #204), only while the tab is
 * visible (#252: hidden, it says nothing is), and that nothing is once it closes.
 */
export function useWatch(repoId: string, pr: Channel) {
  useEffect(() => {
    const say = () => {
      const w = watchSays(document.visibilityState === 'visible', repoId, pr);
      void api.watchPreview(VIEWER, w.repoId, w.pr).catch(() => undefined);
    };
    say();
    const t = setInterval(() => document.visibilityState === 'visible' && say(), WATCH_EVERY_MS);
    // Hidden, it says so a tick later, which a page being left never reaches (its request would only be cut off):
    // the office forgets a viewer that stops saying anything (WATCH_MS).
    let later = 0;
    const onVisibility = () => (document.visibilityState === 'visible' ? say() : void (later = window.setTimeout(say)));
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(t);
      clearTimeout(later);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [repoId, pr]);
  useEffect(() => () => void api.watchPreview(VIEWER, null, null).catch(() => undefined), []);
}

// window.__swarmPreviews: every floor's main preview with this tab's channel, and the PR theatre's previews (a fresh
// snapshot per read).
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmPreviews')) {
  Object.defineProperty(window, '__swarmPreviews', {
    configurable: true,
    get: () => {
      const s = useStore.getState();
      const channels = useChannels.getState().channels;
      return {
        main: s.repos.map((r) => ({ repoId: r.id, floor: r.floor, status: r.preview.status, url: r.preview.url, ref: r.preview.ref, port: r.preview.port, channel: currentChannel(channels[r.id], r.pulls) })),
        prs: Object.values(s.prPreviews).map((p) => ({
          repoId: p.repoId,
          pr: p.pr,
          status: p.status,
          url: p.url,
          port: p.port,
          commit: p.commit,
          watched: p.watched,
          idleSec: Math.round((Date.now() - p.viewedAt) / 1000),
          error: p.error,
        })),
      };
    },
  });
}
