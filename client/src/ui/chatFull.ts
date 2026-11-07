// The CEO chat's full screen (#201): one tap makes the chat fill the window (the 3D office's phone, pocket mode's docked
// chat), or on a phone hides the tab bar. One choice per device; F toggles it while the chat has focus and nobody is
// typing; the minimize button, Esc and Back leave it. "Go full screen" also asks the browser's Fullscreen API.
import { useEffect } from 'react';
import { create } from 'zustand';
import { pushLayer } from './backStack';

const PREF = 'cubefarm:chatFull';

/** The saved choice: full only when this device chose it. */
export const initialChatFull = (saved: string | null) => saved === 'on';

/** Whether a key press is the full-screen toggle: the chat's key, pressed in the chat, not in a field, no Ctrl/Alt/⌘. */
export function togglesFull(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean; defaultPrevented: boolean }, bound: boolean, inChat: boolean, typing: boolean) {
  return bound && inChat && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !e.defaultPrevented;
}

function read(): boolean {
  try {
    return initialChatFull(localStorage.getItem(PREF));
  } catch {
    return false; // private mode, or no storage
  }
}

export const useChatFull = create<{ on: boolean; set: (on: boolean) => void; toggle: () => void }>((set, get) => ({
  on: read(),
  set: (on) => {
    set({ on });
    try {
      localStorage.setItem(PREF, on ? 'on' : 'off');
    } catch {
      // private mode: just this visit
    }
    if (!on && typeof document !== 'undefined' && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  },
  toggle: () => get().set(!get().on),
}));

/** Whether navigating leaves full screen: wide, the rail stays beside the full chat and a tap on it shows its page (#242);
 *  on a phone the tab bar is hidden while full, and leaving the Chat tab already shows the page. */
export const navLeavesFull = (railed: boolean, on: boolean) => railed && on;

/** The rail (or a link) took the manager to a page: leave full screen when that page would be under the chat. */
export function leaveFullFor(railed: boolean) {
  if (navLeavesFull(railed, useChatFull.getState().on)) useChatFull.getState().set(false);
}

/** Whether this browser lets a page go full screen (iPhones don't). */
export const canGoFullscreen = () => typeof document !== 'undefined' && !!document.fullscreenEnabled;

/** ⋯ Go full screen: the chat fills the window, and the window the screen. */
export function goFullscreen() {
  useChatFull.getState().set(true);
  if (canGoFullscreen() && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => undefined);
}

/** While the full chat is on screen, Back leaves full screen first (call it after the container's own back layer). */
export function useChatFullBack(active: boolean) {
  useEffect(() => (active ? pushLayer(() => useChatFull.getState().set(false)) : undefined), [active]);
}
