// Pocket mode's top bar (#588): the company's short name for a narrow bar, and which buttons it draws on each screen.
// On a wide screen the secondary ones fold into one ⋯ below a width (desktop.css's container query hides them), so
// the primary ones (notifications, the CEO chat, the 3D office) and a label never wrap. Pure, so the rule is tested.
import type { PocketTab } from './pocketData';

/** Names up to this long show whole everywhere. */
const WHOLE = 10;

/** "TechInsiderBytes" → "TIB", "Acme Robotics Labs" → "ARL"; a short name as it is, one long word cut to 8 letters. */
export function shortName(name: string): string {
  const n = name.trim();
  if (n.length <= WHOLE) return n;
  const words = n.split(/[\s._-]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean);
  return words.length > 1 ? words.map((w) => w[0].toUpperCase()).join('').slice(0, 4) : n.slice(0, 8);
}

export type HeadTool = 'search' | 'notifications' | 'sound' | 'captions' | 'fullScreen' | 'info' | 'chatMode';

/** The bar's buttons in their order; `fold` ones hide into ⋯ on a narrow wide bar. A phone's Sound & captions is one `sound`. */
export function headTools({ wide, tab, canFull }: { wide: boolean; tab: PocketTab; canFull: boolean }): { tool: HeadTool; fold: boolean }[] {
  const chat = tab === 'chat';
  const tools: (HeadTool | false)[] = wide
    ? ['search', 'notifications', 'sound', 'captions', canFull && 'fullScreen', !chat && 'info', 'chatMode']
    : // the chat has its own 🔍 (its conversations) and the bell sits in its bar
      [!chat && 'search', !chat && 'notifications', 'sound', !chat && 'info'];
  return tools.filter((t): t is HeadTool => !!t).map((tool) => ({ tool, fold: wide && tool !== 'notifications' }));
}

/** The ⋯'s items for the folded buttons, worded for what a tap does now. */
export function headMore(tools: { tool: HeadTool; fold: boolean }[], s: { muted: boolean; captions: boolean; browserFull: boolean; chatMode: boolean }): { tool: HeadTool; label: string }[] {
  const label: Record<HeadTool, string> = {
    search: 'Search everything',
    notifications: 'Notifications',
    sound: s.muted ? 'Unmute sound' : 'Mute sound',
    captions: `Turn captions ${s.captions ? 'off' : 'on'}`,
    fullScreen: s.browserFull ? 'Exit full screen' : 'Full screen',
    info: 'What can I do here?',
    chatMode: `Chat mode: turn ${s.chatMode ? 'off' : 'on'}`,
  };
  return tools.filter((t) => t.fold).map(({ tool }) => ({ tool, label: label[tool] }));
}
