// The first-run and warning screens a CLI can show before it takes its task (#360), recognised from its terminal, each
// with its safe answer, and the ones nobody here can answer (a sign-in). Pure: cliRunner.ts sends the keys and logs
// each answer, the demo's fake sessions draw the same screens. A screen is only answered when its title and the option
// to pick are both on screen; anything else gets no keys.
import { hookReviewKey, trustKey } from './clis.ts';
import type { AgentCli } from '../shared/types.ts';

export type ScreenKey = 'enter' | 'down' | 'up';

export interface KnownScreen {
  id: string;
  /** The coding agents that show it. */
  clis: readonly AgentCli[];
  /** How the log names it. */
  what: string;
  /** The key that moves toward its answer or takes it; null: not this screen (or not one to answer now). */
  key(screen: string, ctx: ScreenContext): ScreenKey | null;
}

/** What the session knows that its screen doesn't. */
export interface ScreenContext {
  /** The office's own hooks are trusted in this Codex home (#638): a hooks review on screen is only someone else's. */
  officeHooksTrusted?: boolean;
}

/** A menu's options as on screen: `❯ 1. Yes` / `  2. No` (the number is optional), and which one is selected. */
function options(screen: string): { text: string; selected: boolean }[] {
  return screen.split('\n').flatMap((l) => {
    const m = /^\s*([❯›>])?\s*(?:\d+\.\s+)?(\S.*?)\s*$/.exec(l);
    return m && (m[1] || /^\s*\d+\.\s/.test(l)) ? [{ text: m[2], selected: !!m[1] }] : [];
  });
}

/** The key toward the option `want` names: Enter on it, else a step toward it; null when it isn't on screen. */
export function pick(screen: string, want: RegExp): ScreenKey | null {
  const opts = options(screen);
  const target = opts.findIndex((o) => want.test(o.text));
  const at = opts.findIndex((o) => o.selected);
  if (target < 0 || at < 0) return null;
  return target === at ? 'enter' : target > at ? 'down' : 'up';
}

/** The screens the office answers, in the order they're looked for. */
const KNOWN_SCREENS: readonly KnownScreen[] = [
  { id: 'trust', clis: ['claude', 'codex'], what: 'folder-trust question (trusted the worktree)', key: trustKey },
  // Claude Code's first run: the theme picker, whose default (Dark mode) is selected.
  { id: 'theme', clis: ['claude'], what: 'theme picker (kept the default)', key: (s) => (/Choose the text style/i.test(s) ? pick(s, /^Dark mode/i) : null) },
  // The office chose this mode for its sessions (or the manager's own settings did): accepting it is the answer.
  { id: 'bypass', clis: ['claude'], what: 'Bypass Permissions warning (accepted the mode the session runs in)', key: (s) => (/Bypass Permissions mode/i.test(s) ? pick(s, /^Yes, I accept/i) : null) },
  { id: 'terminal-setup', clis: ['claude'], what: 'terminal setup offer (not now)', key: (s) => (/Use Claude Code's terminal setup\?/i.test(s) ? pick(s, /^No\b/i) : null) },
  { id: 'notes', clis: ['claude'], what: 'security notes (continued)', key: (s) => (/Security notes:/i.test(s) && /Press Enter to continue/i.test(s) ? 'enter' : null) },
  { id: 'login-done', clis: ['claude'], what: 'signed-in screen (continued)', key: (s) => (/Login successful/i.test(s) && /Press Enter to continue/i.test(s) ? 'enter' : null) },
  { id: 'update', clis: ['codex'], what: 'update offer (skipped: the office updates its CLIs)', key: (s) => (/Update available!?/i.test(s) ? pick(s, /^Skip$/i) : null) },
  // Only past others' hooks: going on without the office's own would silently lose its steps (#638), so then it's the manager's.
  { id: 'hooks', clis: ['codex'], what: "hooks review (went on without the hooks it doesn't trust: trusting them is the manager's call, in /hooks)", key: (s, ctx) => (ctx.officeHooksTrusted ? hookReviewKey(s) : null) },
];

/**
 * A CLI's own sign-in, drawn in full: its title with the menu or field it waits on, each on a line of its own (a
 * command's output that quotes one of these phrases isn't a sign-in). Only the manager can do it.
 */
const SIGN_IN: Record<AgentCli, ((screen: string) => boolean)[]> = {
  claude: [
    (s) => /Select login method/i.test(s) && options(s).some((o) => /^Claude account with subscription/i.test(o.text)),
    (s) => /^\s*Browser didn't open\?/im.test(s) && /^\s*Paste code here if prompted\b/im.test(s),
    (s) => /^\s*(?:⎿\s*)?Not logged in · Please run \/login\s*$/m.test(s),
  ],
  codex: [(s) => options(s).some((o) => /^Sign in with ChatGPT/i.test(o.text)) && options(s).some((o) => /^Provide your own API key/i.test(o.text))],
  opencode: [],
  // Gemini CLI marks its selected option with ●.
  gemini: [(s) => /How would you like to authenticate/i.test(s) && /^\s*[●❯›>]?\s*(?:\d+\.\s+)?Sign in with Google\s*$/m.test(s), (s) => /^\s*Waiting for authentication\.\.\./im.test(s)],
};
/** A sign-in phrase anywhere on screen: worth a line in the log, never a reason to end a session. */
const SIGN_IN_HINT = /Not logged in|run \/login|Select login method|Sign in with ChatGPT|Please login|Invalid API key|Browser didn't open|Paste code here|How would you like to authenticate/i;

export type ScreenStep = { do: 'keys'; screen: KnownScreen; key: ScreenKey } | { do: 'sign-in' } | { do: 'sign-in-hint' } | null;

/** What a CLI's screen asks for while it starts: a known screen's key, its sign-in nobody here can do, a sign-in phrase, or nothing. */
export function screenStep(screen: string, cli: AgentCli, ctx: ScreenContext = {}): ScreenStep {
  for (const s of KNOWN_SCREENS) {
    if (!s.clis.includes(cli)) continue;
    const key = s.key(screen, ctx);
    if (key) return { do: 'keys', screen: s, key };
  }
  if (SIGN_IN[cli].some((test) => test(screen))) return { do: 'sign-in' };
  return SIGN_IN_HINT.test(screen) ? { do: 'sign-in-hint' } : null;
}

/** The terminal bytes for a key (`app`: the terminal is in application cursor mode). */
export const keyBytes = (key: ScreenKey, app: boolean) => (key === 'enter' ? '\r' : `\x1b${app ? 'O' : '['}${key === 'down' ? 'B' : 'A'}`);

// ---------- giving up on a screen ----------

/** Keys the office presses on one start-up screen before it stops and leaves it to the manager (#575). */
export const SCREEN_TRIES = 6;

/**
 * Whether one more key goes to start-up screen `id` (counted in `tries`): true while it has tries left; once they're
 * spent, `giveUp` runs once (to say so) and it's false from then on, so a screen that never goes isn't pressed forever.
 */
export function screenTry(tries: Map<string, number>, id: string, giveUp: () => void): boolean {
  const n = (tries.get(id) ?? 0) + 1;
  tries.set(id, n);
  if (n === SCREEN_TRIES + 1) giveUp();
  return n <= SCREEN_TRIES;
}

/** The agent's log line when the office stops answering a screen. */
export const gaveUpNote = (label: string, s: KnownScreen) =>
  `⚠ ${label} needs setup: the office answered their ${s.what.replace(/ \(.*\)$/, '')} ${SCREEN_TRIES} times and it is still on screen. Open their terminal and pick the answer there.`;

// ---------- counting answers per account ----------

const answered = new Map<string, number>();

/** One more auto-answer of `id` on `account` (the built-in login when none): the count so far, for the log. */
export function countAnswer(account: string | undefined, id: string): number {
  const k = `${account || 'built-in'}:${id}`;
  const n = (answered.get(k) ?? 0) + 1;
  answered.set(k, n);
  return n;
}

/** The agent's log line for an answered screen. */
export const answerNote = (label: string, s: KnownScreen, account: string | undefined, n: number) => `🤖 Auto-answered ${label}'s ${s.what} · ${n}× on ${account || 'the built-in login'}.`;

/** Why a session that showed a sign-in ended (detectLimit reads "not signed in" as a signed-out account). */
export const signInError = (label: string, account: string | undefined) => `${label} is not signed in on ${account || 'the built-in login'}: it showed its sign-in screen, so the task goes back in line.`;
