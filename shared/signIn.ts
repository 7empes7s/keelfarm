// A login's sign-in in its terminal (#302), pure: the code as it should reach the CLI's prompt, what the office may log
// about what was sent (its shape, never the value), and how the sign-in ended.
import { cleanTerminalText } from './terminalText.ts';
import type { SignInMode } from './types.ts';

/**
 * A pasted sign-in code as the CLI's prompt takes it: no escape sequences, control characters or whitespace (a copied
 * code may end in a newline or wrap over lines), its `#state` kept. A copied callback address (…?code=X&state=Y)
 * becomes `X#Y`, the form the code page shows.
 */
export function signInCode(raw: string | null | undefined): string {
  const text = cleanTerminalText(raw ?? '', 4000).replace(/\s+/g, '');
  if (/^https?:\/\//i.test(text)) {
    try {
      const q = new URL(text).searchParams;
      const code = q.get('code');
      if (code) return q.get('state') ? `${code}#${q.get('state')}` : code;
    } catch {
      // not an address after all
    }
  }
  return text;
}

/** What was typed at the prompt, described without the value: length, `#`, escape bytes, whitespace around it. */
export function inputShape(line: string): string {
  const parts = [`${line.length} character${line.length === 1 ? '' : 's'}`, line.includes('#') ? 'with #state' : 'no #state'];
  if (line.includes('\u001b')) parts.push('escape bytes');
  if (line !== line.trim()) parts.push('spaces around it');
  return parts.join(', ');
}

/** The verdict shown under a finished sign-in, from its exit code and the terminal's last lines. */
export function signInEnd(mode: SignInMode, code: number, tail: readonly string[]): { ok: boolean; note: string } {
  if (code === 0) return { ok: true, note: mode === 'setup-token' ? 'Token made: copy it from the terminal before you close this.' : 'Signed in.' };
  const missing = code < 0 && [...tail].reverse().map((l) => /(Claude Code|Codex|Gemini CLI|OpenCode) isn't installed/.exec(l)?.[1]).find(Boolean);
  if (missing) return { ok: false, note: `${missing} isn't installed. Tap Install.` }; // #493
  // Gemini CLI refuses its sign-in when run non-interactively (#540): plain words, not its stack.
  if (tail.some((l) => /Manual authorization is required but the current session is non-interactive/i.test(l))) return { ok: false, note: 'Gemini CLI needs an interactive sign-in. Tap Try again to sign in that way.' };
  const said = [...tail].reverse().find((l) => /fail|error|invalid|expired/i.test(l))?.trim();
  const status = said && /status code (\d{3})/.exec(said)?.[1];
  const what = mode === 'setup-token' ? 'Making a token failed' : 'Sign-in failed';
  if (status) return { ok: false, note: `${what} (${status}). Try again with a fresh link: codes work once, for a few minutes.` };
  return { ok: false, note: `${what}${code < 0 ? ': it could not start' : ` (exit ${code})`}. Try again.` };
}

// ---------- the guided sign-in (#350) ----------

/** A menu the CLI shows before its sign-in: its question, options and the highlighted one (0-based). */
interface SignInMenu {
  text: string;
  options: string[];
  at: number;
}

/** What a sign-in terminal shows right now, read from its screen since this sign-in started. */
export interface SignInScreen {
  url: string | null; // the sign-in page
  deviceCode: string | null; // Codex's one-time code for that page
  waiting: boolean; // Claude Code's (or Gemini CLI's) prompt waits for the code
  menu: SignInMenu | null;
  /** The option to pick by itself (the subscription login, the default theme, trusting the folder), or null: ask. */
  pick: number | null;
  result: 'ok' | 'failed' | null;
}

/** Each sign-in starts with the office's own line (localSignIn.ts, demoSignIn.ts): what's above it is an older one. */
const START = /── (?:Signing .* in|Making a .* setup token).*──/;
const OPTION = /^\s*([❯›>])?\s*(\d)\.\s+(.+?)\s*$/;
/** The prompt for the code from the sign-in page: Claude Code's, Gemini CLI's. */
const CODE_PROMPT = /Paste code here|Enter the authorization code/i;
/** The answers a sign-in needs, by question: Claude Code's login method, its first-run theme, folder trust. */
const PICKS: [RegExp, RegExp][] = [
  [/login method|sign in with|how would you like to (?:log|sign) in/i, /subscription|claude account|chatgpt/i],
  [/text style|theme/i, /^dark mode/i],
  [/trust|safety check/i, /^yes/i],
];

/** Reads a sign-in terminal's screen (rows the terminal wrapped already joined, as AgentTerminal.unwrapped gives). */
export function signInScreen(text: string): SignInScreen {
  const lines = text.split('\n');
  const from = lines.findLastIndex((l) => START.test(l));
  const mine = lines.slice(from + 1);
  const body = mine.join('\n');
  const url = body.match(/https:\/\/[^\s"'<>\]]+/g)?.at(-1) ?? null;
  const deviceCode = /one-time code[^\n]*\n\s*([A-Z0-9]{4,}-[A-Z0-9]{4,})\s*$/m.exec(body)?.[1] ?? null;
  const ok = /Login successful|Successfully logged in|Logged in (?:as|using)|Authentication succeeded/i;
  const bad = /Login failed|OAuth error|Error logging in|Invalid (?:code|authorization)|Authentication failed|Failed to authenticate/i;
  // Gemini CLI's "Failed to authenticate with user code. Retrying..." asks again with a new link: only what follows counts.
  const tries = mine.slice(mine.findLastIndex((l) => /Retrying/i.test(l)) + 1);
  const last = [...tries].reverse().find((l) => ok.test(l) || bad.test(l));
  const result = last ? (ok.test(last) ? 'ok' : 'failed') : null;
  const found = result ? null : menuOf(mine);
  // A menu with the link or the prompt under it was answered already (the CLI left it on screen).
  const menu = found && !/https:\/\//i.test(mine.slice(found.end + 1).join('\n')) && !CODE_PROMPT.test(mine.slice(found.end + 1).join('\n')) ? found.menu : null;
  const pick = menu ? pickFor(menu) : null;
  const prompt = mine.filter((l) => l.trim()).at(-1) ?? '';
  return { url, deviceCode, waiting: !menu && !result && CODE_PROMPT.test(prompt), menu, pick, result };
}

/** The last numbered menu on screen with a highlighted option (❯), so a numbered list of steps never reads as one. */
function menuOf(lines: string[]): { menu: SignInMenu; end: number } | null {
  let end = -1;
  for (let i = lines.length - 1; i >= 0 && end < 0; i--) if (OPTION.exec(lines[i])?.[1]) end = i;
  if (end < 0) return null;
  let start = end;
  while (start > 0 && OPTION.test(lines[start - 1])) start--;
  while (end + 1 < lines.length && OPTION.test(lines[end + 1]) && !OPTION.exec(lines[end + 1])?.[1]) end++;
  const rows = lines.slice(start, end + 1).map((l) => OPTION.exec(l)!);
  const text = lines.slice(0, start).reverse().find((l) => l.trim())?.trim() ?? '';
  return { menu: { text, options: rows.map((m) => m[3].replace(/\s*✔$/, '')), at: rows.findIndex((m) => !!m[1]) }, end };
}

function pickFor(menu: SignInMenu): number | null {
  for (const [q, a] of PICKS) {
    if (!q.test(menu.text)) continue;
    const i = menu.options.findIndex((o) => a.test(o));
    if (i >= 0) return i;
  }
  return null;
}

/** The keys that move a menu's highlight from `at` to `to` and choose it. */
export function menuKeys(at: number, to: number, appCursor = false): string {
  const step = appCursor ? (to > at ? '\x1bOB' : '\x1bOA') : to > at ? '\x1b[B' : '\x1b[A';
  return step.repeat(Math.abs(to - at)) + '\r';
}

/**
 * Why a pasted text isn't a sign-in code, said before it is sent; null when it looks like one. A copied callback address
 * carries the code (signInCode takes it out); any other address is the sign-in link itself, pasted back by mistake.
 */
export function codeProblem(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return 'Nothing pasted yet: copy the code from the sign-in page first.';
  if (/^https?:\/\//i.test(text) && !/\/callback\b/.test(text)) return "That's a web address, not the code: after you approve, the page shows a code to copy.";
  if (/\s/.test(text)) return 'That has spaces in it, so it isn’t the code: the code is one long word. Copy it again.';
  return null;
}

/** A code as the field shows it: its first and last 4 characters, the rest dots, so you can tell something landed. */
export function maskCode(code: string): string {
  if (code.length <= 8) return '•'.repeat(code.length);
  return `${code.slice(0, 4)}${'•'.repeat(Math.min(12, code.length - 8))}${code.slice(-4)}`;
}
