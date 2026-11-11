// The tour owns the screen (#406): while the 3D office's tour (or a What's new replay) shows a step, nothing else opens
// unless that step asks for it: no panel, sheet, agent card, toast or hold menu. Every opener asks gateAllows; the
// tour (Tutorial.tsx) says which step is up. Toasts wait in the store and show once the tour is over.
import { create } from 'zustand';
import { CEO_ID } from '../../../shared/types';
import type { Overlay } from '../store';

/** Something about to open over the 3D office. */
export type Gated =
  | { kind: 'overlay'; overlay: Overlay }
  /** The touch hold menu (HoldMenu.tsx). */
  | { kind: 'hold' }
  /** The aim card for whoever you look at (AgentCard.tsx, the career peek). */
  | { kind: 'card' }
  | { kind: 'toast' }
  /** The phone HUD's Options and floor sheets (PhoneHud.tsx). */
  | { kind: 'options' }
  | { kind: 'search' }
  | { kind: 'guide' };

const panel = (g: Gated, ...kinds: Overlay['kind'][]) => g.kind === 'overlay' && kinds.includes(g.overlay.kind);
const phone = (g: Gated) => panel(g, 'phone');

/** What each step lets open: what it asks you to do or its Try it opens. Steps not listed allow nothing. */
const ALLOWS: Record<string, (g: Gated) => boolean> = {
  phone,
  'phone-tour': phone,
  ceo: (g) => phone(g) || (g.kind === 'overlay' && ((g.overlay.kind === 'terminal' && g.overlay.agentId === CEO_ID) || (g.overlay.kind === 'manager' && g.overlay.tab === 'ceo'))),
  hires: (g) => panel(g, 'interview'),
  upstairs: (g) => panel(g, 'elevator'),
  whiteboard: (g) => panel(g, 'kanban', 'card'),
  watch: (g) => g.kind === 'card' || g.kind === 'hold' || panel(g, 'terminal'),
  search: (g) => g.kind === 'search' || g.kind === 'options',
  guide: (g) => g.kind === 'guide' || g.kind === 'options',
  bell: (g) => panel(g, 'notices'),
  sound: (g) => g.kind === 'options',
  'chat-cards': phone,
  'chat-full': phone,
  'chat-charts': phone,
  console: (g) => panel(g, 'manager'),
  charter: (g) => panel(g, 'manager'),
  costs: (g) => panel(g, 'manager'),
  'agent-chat': (g) => g.kind === 'options' || panel(g, 'terminal'),
  switch: (g) => g.kind === 'options',
  office: (g) => panel(g, 'manager', 'help'),
};

/** Whether `g` may open while tour step `step` shows (null: no tour, everything may). */
export function tourAllows(step: string | null, g: Gated): boolean {
  if (step === null) return true;
  return ALLOWS[step]?.(g) ?? false;
}

/** The touch help line ("Thumb on the ghost stick…") shows only during the tour's first step, never after it. */
export const touchHelpShows = (step: string | null) => step === 'look';

interface Gate {
  /** The 3D office's tour step on screen now, or null; set by Tutorial.tsx. */
  step: string | null;
  /** A deep link's view is open (#413, routeLink.ts): the tour steps aside until it closes. */
  held: boolean;
}

/** Whether `g` may open: always while a deep link holds the tour, else as the step on screen says. */
export const gateSays = (s: Gate, g: Gated) => s.held || tourAllows(s.step, g);

export const useTourGate = create<Gate>(() => ({ step: null, held: false }));

export const gateAllows = (g: Gated) => gateSays(useTourGate.getState(), g);
