// A stuck CEO, shown to the manager (#375): its session on a sign-in or setup screen, or silent a minute after the
// manager wrote. Pure: the words of the chat card and the notification, and where Switch back goes.
import type { StuckKind } from './liveState.ts';
import type { ChatCeoStuck } from '../shared/types.ts';

/** A message to the CEO with nothing back (no text, no tool call) this long: it's shown as stuck. */
export const CEO_SILENT_MS = 60_000;

/** The card's kind for a blocked state (liveState.ts), or 'silent' for no answer. */
export function ceoStuckKind(kind: StuckKind | 'silent'): ChatCeoStuck['kind'] {
  if (kind === 'not-started') return 'silent';
  return kind === 'sign-in' || kind === 'setup' || kind === 'silent' ? kind : 'other';
}

const WHAT: Record<ChatCeoStuck['kind'], string> = {
  'sign-in': 'sign-in needed',
  setup: 'a setup screen is open',
  silent: "no answer for a minute",
  other: 'something on screen needs you',
};

/**
 * The chat card's line and the notification. `on`: the account's label (null: the built-in login, not named);
 * `back`: where Switch back goes, if anywhere.
 */
export function ceoStuckText(name: string, kind: ChatCeoStuck['kind'], on: string | null, back: string | null): { line: string; title: string; body: string } {
  const where = on ? ` on ${on}` : '';
  const line = `⚠️ ${name} is stuck${where}: ${WHAT[kind]}.`;
  const fix = kind === 'sign-in' ? (on ? `Sign ${on} in` : 'Sign in in their terminal') : 'Open their terminal to see why';
  return { line, title: `${name} is stuck${where}`, body: `${WHAT[kind][0].toUpperCase()}${WHAT[kind].slice(1)}. ${fix}${back ? `, or switch back to ${back}` : ''}.` };
}

/**
 * Where Switch back goes: the account the CEO last answered on, when that's another one; else, when the CEO is pinned
 * to an account, the office default (''); else nowhere (null).
 */
export function switchBackTo(stuckOn: string | null, lastGood: string | null, binding: string | undefined): string | null {
  if (lastGood && lastGood !== stuckOn) return lastGood;
  return binding ? '' : null;
}
