// What the hold menu offers for the thing under the finger (or in the aim card's ⋯), pure. HoldMenu.tsx runs them.

import type { Focus } from '../../store';

export type HoldOptionId = 'use' | 'follow' | 'greet' | 'carry';

export interface HoldOption {
  id: HoldOptionId;
  label: string;
}

/** The menu for `focus`: what a tap does first, then the extras that thing has. */
export function holdOptions(focus: Focus): HoldOption[] {
  const a = focus.action;
  if (a.kind === 'terminal') {
    return [
      { id: 'use', label: '🖥️ Watch their terminal' },
      { id: 'follow', label: '🎥 Follow' },
      { id: 'greet', label: '👋 Say hi' },
    ];
  }
  if (a.kind === 'greet') {
    return [
      { id: 'greet', label: '👋 Say hi' },
      { id: 'follow', label: '🎥 Follow' },
    ];
  }
  if (a.kind === 'card') {
    return [{ id: 'use', label: '📖 Read' }, ...(a.peel ? [{ id: 'carry' as const, label: '✋ Carry it' }] : [])];
  }
  return [{ id: 'use', label: focus.label }];
}

/** The agent `focus` is about, if any (for following and saying hi). */
export const focusAgent = (focus: Focus): string | null => (focus.action.kind === 'terminal' || focus.action.kind === 'greet' ? focus.action.agentId : null);
