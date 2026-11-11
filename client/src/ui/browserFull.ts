// The browser's full screen (#415): the whole app without the browser's bars, from the top bar (BrowserFullButton.tsx).
// It never touches the CEO chat's own full screen (chatFull.ts): the two toggle on their own. Only where the Fullscreen
// API exists: iPhones (Safari, Chrome, the home-screen app) have none for pages, so the button isn't there.
import { useSyncExternalStore } from 'react';

type Doc = Pick<Document, 'fullscreenEnabled' | 'fullscreenElement' | 'exitFullscreen'> & { documentElement: Pick<HTMLElement, 'requestFullscreen'> };

const doc = (): Doc | null => (typeof document === 'undefined' ? null : document);

/** Whether this browser lets a page go full screen (iPhones don't). */
export const canGoFullscreen = (d: Doc | null = doc()) => !!d?.fullscreenEnabled;

/** Whether the app is in the browser's full screen now. */
export const inBrowserFull = (d: Doc | null = doc()) => !!d?.fullscreenElement;

/** The top bar's button: in, or out again (Esc leaves too, by the browser). */
export function toggleBrowserFull(d: Doc | null = doc()) {
  if (!d || !canGoFullscreen(d)) return;
  const asked = d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen();
  void asked.catch(() => undefined); // refused (no tap behind it): nothing changes
}

const subscribe = (on: () => void) => {
  document.addEventListener('fullscreenchange', on);
  return () => document.removeEventListener('fullscreenchange', on);
};

/** Whether the app is in the browser's full screen, following Esc and the browser's own exits. */
export const useBrowserFull = () => useSyncExternalStore(subscribe, () => inBrowserFull(), () => false);
