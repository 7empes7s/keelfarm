// Where the search, the guide, empty states and ⓘ sheets send the manager (#109), the same in the 3D office and
// pocket mode: a panel (terminal, card, app, board), a console section, or the CEO chat with a message ready to send.
// Pocket mode turns a 'manager' overlay into its ⚙️ sheet and a 'phone' one into the Chat tab (Pocket.tsx).
import { create } from 'zustand';
import { useStore, type Overlay } from '../store';
import type { SectionId } from './consoleNavRules';

export type Target =
  | { kind: 'overlay'; overlay: Overlay }
  | { kind: 'section'; section: SectionId; repoId?: string }
  /** The CEO chat; `text` waits in its box for the manager to send or change. */
  | { kind: 'ceo'; text?: string }
  | { kind: 'link'; url: string }
  /** The guide checklist (GuideCard.tsx). */
  | { kind: 'guide' };

/** A message for the CEO chat's box, taken by the chat when it shows (Phone.tsx). */
export const useCeoDraft = create<{ text: string | null }>(() => ({ text: null }));

/** The search palette and the 3D office's guide panel: open or not. */
export const useFinder = create<{ search: boolean; guide: boolean }>(() => ({ search: false, guide: false }));

export function openSearch() {
  if (document.pointerLockElement) document.exitPointerLock();
  useFinder.setState({ search: true });
}

export function go(t: Target) {
  const s = useStore.getState();
  switch (t.kind) {
    case 'overlay':
      return s.openOverlay(t.overlay);
    case 'section':
      return s.openOverlay({ kind: 'manager', tab: t.section, repoId: t.repoId });
    case 'ceo':
      if (t.text) useCeoDraft.setState({ text: t.text });
      return s.openOverlay({ kind: 'phone', tab: 'chat' });
    case 'link':
      return void window.open(t.url, '_blank', 'noopener');
    case 'guide':
      if (document.pointerLockElement) document.exitPointerLock();
      return useFinder.setState({ guide: true });
  }
}
