import { researchTopic } from '../../../shared/chat';
import type { IconName } from './icons';

// What the CEO chat's + offers (#81, ui/ChatActionsSheet.tsx). Pure, so it's tested without a page.

export const QUICK = ["What's everyone working on?", 'Should a team grow?', 'Plan the next milestone for the busiest floor.'];

export interface SheetAction {
  id: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

/** The + sheet's actions: the camera only on a touch screen, Research once there's text that isn't a research request already. */
export function composerActions(text: string, touch: boolean): SheetAction[] {
  return [
    ...(touch ? [{ id: 'camera', label: 'Camera', icon: 'camera' as const }] : []),
    { id: 'file', label: 'Photo or file', icon: 'folder' as const },
    { id: 'research', label: 'Research this', icon: 'search' as const, disabled: !text.trim() || researchTopic(text) !== null },
    ...QUICK.map((q) => ({ id: `quick:${q}`, label: q })),
  ];
}
