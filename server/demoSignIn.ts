// The demo's sign-ins (#302): each CLI's own login drawn in a terminal, with made-up links and codes.
import type { BoxSignIn } from './cliRunner.ts';
import type { AgentTerminal } from './terminal.ts';
import type { SignInMode } from '../shared/types.ts';
import { inputShape } from '../shared/signIn.ts';

/** Where the demo's sign-ins send the manager: nowhere real. */
const DEMO_SIGN_IN = { claude: 'https://example.com/cubefarm-demo/claude-sign-in', codex: 'https://example.com/cubefarm-demo/codex-device' };

/**
 * The demo's sign-in in a cloud agent's terminal, drawn as each CLI's own one looks, with a made-up link: Enter (after
 * pasting anything, for Claude Code) finishes it, and the fake account remembers the Box as signed in. A code with
 * "fail" in it fails as a stale code does (#302), and Claude Code's prompt shows the shape of what it got, for e2e.
 */
export function demoSignIn(o: { boxId: string; cli: 'claude' | 'codex'; term: AgentTerminal; mode?: SignInMode }, logins: Map<string, Set<string>>, exited: (code: number) => void): BoxSignIn {
  const { term } = o;
  const claude = o.cli === 'claude';
  const token = claude && o.mode === 'setup-token';
  term.note(token ? '── Making a Claude Code setup token (demo) ──' : `── Signing ${claude ? 'Claude Code' : 'Codex'} in${o.boxId === 'accounts' ? '' : ' · ☁ cloud machine'} (demo) ──`);
  const link = ['Opening browser to sign in…', `If the browser didn't open, visit: ${DEMO_SIGN_IN.claude}`, '', '\x1b[2m(demo) Paste anything and press Enter ("fail" in it fails).\x1b[0m', 'Paste code here if prompted > '].join('\r\n');
  // An account's login asks its login method first, as an older Claude Code does: the guided sign-in answers it (#350).
  let menu = claude && !token && o.boxId === 'accounts';
  term.write(
    (claude
      ? menu
        ? ['Select login method:', '', ' ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise', '   2. Anthropic Console account · API usage billing', '   3. 3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI']
        : [link]
      : [
          'Welcome to Codex (demo)',
          '',
          'Follow these steps to sign in with ChatGPT using device code authorization:',
          '',
          '1. Open this link in your browser and sign in to your account',
          `   ${DEMO_SIGN_IN.codex}`,
          '',
          '2. Enter this one-time code (expires in 15 minutes)',
          '   DEMO-0000',
          '',
          '\x1b[2m(demo) Press Enter here once you have.\x1b[0m',
        ]
    ).join('\r\n'),
  );
  let line = '';
  let raw = ''; // what was sent, escapes and all
  let over = false;
  const close = () => {
    over = true;
    term.bind(null);
  };
  term.bind({
    write: (data) => {
      raw += data.split('\r')[0];
      for (const ch of data.replace(/\x1b\[[0-9;?]*[A-Za-z~]|\x1b./g, '')) {
        if (over) return;
        if (menu) {
          if (ch !== '\r') continue;
          menu = false;
          term.write(`\x1b[4A\r\x1b[0J${link}`); // the menu goes, as Ink clears it
          continue;
        }
        if (ch === '\r') {
          if (claude && !line.trim()) continue;
          const fail = claude && line.includes('fail');
          if (claude) term.write(`\r\n\x1b[2m(demo) the prompt got ${inputShape(raw)}\x1b[0m`);
          term.write(fail ? '\r\nLogin failed: Request failed with status code 400\r\n' : token ? '\r\n✓ Long-lived authentication token created: sk-ant-oat01-demo-0000\r\n' : `\r\n\x1b[32m${claude ? 'Login successful.' : 'Successfully logged in'}\x1b[0m\r\n`);
          if (!token && !fail) logins.set(o.boxId, new Set([...(logins.get(o.boxId) ?? []), o.cli]));
          close();
          exited(fail ? 1 : 0);
        } else if (ch === '\x7f' || ch === '\b') line = line.slice(0, -1);
        else if (ch >= ' ') line += ch; // never echoed, as the real prompt doesn't
      }
    },
    resize: () => undefined,
  });
  return {
    stop: () => {
      if (over) return;
      close();
      term.note('── sign-in closed ──');
    },
  };
}
