// Where the search, the guide, empty states and ⓘ sheets send the manager (#109), the same in the 3D office and
// pocket mode: a panel (terminal, card, app, board), a console section, or the CEO chat with a message ready to send.
// Pocket mode turns a 'manager' overlay into its ⚙️ sheet and a 'phone' one into the Chat tab (Pocket.tsx).
import { create } from 'zustand';
import { useStore, type Overlay } from '../store';
import { toggleBrowserFull } from './browserFull';
import type { SectionId } from './consoleNavRules';
import { gateAllows } from './tourGate';
import type { HudOptionId } from './hudOptions';

export type Target =
  | { kind: 'overlay'; overlay: Overlay }
  | { kind: 'section'; section: SectionId; repoId?: string }
  /** The CEO chat; `text` waits in its box for the manager to send or change; `jump`: the message it scrolls to (#208). */
  | { kind: 'ceo'; text?: string; jump?: number }
  | { kind: 'link'; url: string }
  /** The guide checklist (GuideCard.tsx). */
  | { kind: 'guide' }
  /** One of the phone HUD's Options (hudOptions.ts), in the 3D office. */
  | { kind: 'option'; id: HudOptionId }
  /** The top bar's browser full screen, in or out (browserFull.ts, #415). */
  | { kind: 'fullscreen' };

/** A message for the CEO chat's box, and a message to scroll to, taken by the chat when it shows (Chat.tsx). */
export const useCeoDraft = create<{ text: string | null; jump?: number | null }>(() => ({ text: null }));

/** The search palette and the 3D office's guide panel: open or not. */
export const useFinder = create<{ search: boolean; guide: boolean }>(() => ({ search: false, guide: false }));

export function openSearch() {
  if (!gateAllows({ kind: 'search' })) return;
  if (document.pointerLockElement) document.exitPointerLock();
  useFinder.setState({ search: true });
}

let runOption: ((id: HudOptionId) => void) | null = null;

/** The 3D office's HUD says how to run an Option (PhoneHud.tsx). */
export const setOptionRunner = (run: (id: HudOptionId) => void) => void (runOption = run);

export function go(t: Target) {
  const s = useStore.getState();
  switch (t.kind) {
    case 'overlay':
      return s.openOverlay(t.overlay);
    case 'section':
      return s.openOverlay({ kind: 'manager', tab: t.section, repoId: t.repoId });
    case 'ceo':
      if (t.text) useCeoDraft.setState({ text: t.text });
      if (t.jump !== undefined) useCeoDraft.setState({ jump: t.jump });
      return s.openOverlay({ kind: 'phone', tab: 'chat' });
    case 'link':
      return void window.open(t.url, '_blank', 'noopener');
    case 'guide':
      if (!gateAllows({ kind: 'guide' })) return;
      if (document.pointerLockElement) document.exitPointerLock();
      return useFinder.setState({ guide: true });
    case 'option':
      return runOption?.(t.id);
    case 'fullscreen':
      return toggleBrowserFull();
  }
}
