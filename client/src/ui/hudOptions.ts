// The phone HUD's Options (#406): everything the 3D office's top bar shows on a computer that a phone's one-row bar
// leaves out, as one list. PhoneHud.tsx draws it as grouped rows and runs each; the search finds each (searchIndex.ts),
// so nothing that left the bar is more than a tap away. Pure.
import type { IconName } from './icons';

export type HudOptionId = 'overview' | 'photo' | 'browser-full' | 'mute' | 'captions' | 'sound-settings' | 'search' | 'guide' | 'chat-mode' | 'switch' | 'sessions' | 'coins' | 'settings';

export interface HudOption {
  id: HudOptionId;
  label: string;
  icon: IconName;
  group: 'View' | 'Sound' | 'Office';
}

export const HUD_OPTIONS: readonly HudOption[] = [
  { id: 'overview', label: 'Overview', icon: 'map', group: 'View' },
  { id: 'photo', label: 'Photo mode', icon: 'camera', group: 'View' },
  { id: 'switch', label: '2D office', icon: 'layers', group: 'View' },
  { id: 'browser-full', label: 'Full screen (browser)', icon: 'maximize', group: 'View' }, // only where the browser has it (#415)
  { id: 'mute', label: 'Sound', icon: 'volume-2', group: 'Sound' },
  { id: 'captions', label: 'Captions', icon: 'captions', group: 'Sound' },
  { id: 'sound-settings', label: 'Sound settings', icon: 'sliders-horizontal', group: 'Sound' },
  { id: 'search', label: 'Search everything', icon: 'search', group: 'Office' },
  { id: 'guide', label: 'Guide', icon: 'circle-check', group: 'Office' },
  { id: 'chat-mode', label: 'Chat mode', icon: 'message-circle', group: 'Office' },
  { id: 'sessions', label: 'Sessions', icon: 'activity', group: 'Office' },
  { id: 'coins', label: 'Coins', icon: 'coins', group: 'Office' },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'Office' },
];

export const OPTION_GROUPS = ['View', 'Sound', 'Office'] as const;
