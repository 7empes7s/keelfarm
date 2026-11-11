// The threads column folded to a rail (#346, #396): remembered on this device, and Ctrl/⌘ + \ in the chat folds or
// unfolds it. Pure, apart from the storage reads and writes (wrapped: private mode or no storage).

export const RAIL_KEY = 'cubefarm:threads-rail';

/** Folded last time on this device. */
export function savedRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveRail(rail: boolean) {
  try {
    localStorage.setItem(RAIL_KEY, rail ? '1' : '0');
  } catch {
    // remembered for this visit only
  }
}

/** What the shortcut's hover card says. */
export const RAIL_KEYS = 'Ctrl \\';

/** Whether a key press folds or unfolds the column: Ctrl or ⌘ + \, pressed in the chat (a field too: it's a chord). */
export function togglesRail(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean; defaultPrevented: boolean }, inChat: boolean) {
  return inChat && e.code === 'Backslash' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.repeat && !e.defaultPrevented;
}
