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
  const said = [...tail].reverse().find((l) => /fail|error|invalid|expired/i.test(l))?.trim();
  const status = said && /status code (\d{3})/.exec(said)?.[1];
  const what = mode === 'setup-token' ? 'Making a token failed' : 'Sign-in failed';
  if (status) return { ok: false, note: `${what} (${status}). Try again with a fresh link: codes work once, for a few minutes.` };
  return { ok: false, note: `${what}${code < 0 ? ': it could not start' : ` (exit ${code})`}. Try again.` };
}
