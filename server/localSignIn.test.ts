import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Accounts } from './accounts.ts';
import { checkAccount } from './accountCheck.ts';
import { geminiLoginSettings } from './geminiHome.ts';
import { GEMINI_SIGN_IN, startLocalSignIn } from './localSignIn.ts';
import { terminalsAvailable } from './ptyClient.ts';

// Gemini CLI's sign-in on this computer (#540): interactive, since a non-interactive Gemini CLI refuses the sign-in
// with its link (exit 41), and quit by the office once its login is on file.

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true, maxRetries: 3 });
});

describe("Gemini CLI's sign-in", () => {
  it('runs it interactively, with no browser and the Google sign-in picked in its folder', () => {
    expect(GEMINI_SIGN_IN.args).not.toContain('--prompt');
    expect(GEMINI_SIGN_IN.args).not.toContain('-p');
    expect(GEMINI_SIGN_IN.env).toEqual({ NO_BROWSER: 'true' });
    expect(JSON.parse(geminiLoginSettings('')!).security.auth.selectedType).toBe('oauth-personal');
  });
});

/** Gemini CLI 0.68 as its sign-in behaves: --prompt refuses it (exit 41); interactive, its link, the code, then its prompt until /quit. */
const FAKE_GEMINI = String.raw`
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const dir = path.join(process.env.GEMINI_CLI_HOME, '.gemini');
const picked = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).security.auth.selectedType; } catch { return null; } })();
if (args.includes('--prompt') || args.includes('-p')) {
  console.error('Error authenticating: FatalAuthenticationError: Manual authorization is required but the current session is non-interactive.');
  process.exit(41);
} else if (process.env.NO_BROWSER !== 'true' || picked !== 'oauth-personal') {
  process.stdout.write('How would you like to authenticate for this project?\r\n');
  setInterval(() => undefined, 1e9);
} else {
  process.stdout.write('Please visit the following URL to authorize the application:\r\n\r\nhttps://accounts.google.com/o/oauth2/v2/auth?fake=1\r\n\r\nEnter the authorization code: ');
  let buf = '', signedIn = false;
  process.stdin.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.search(/[\r\n]/)) >= 0; ) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      if (!signedIn) {
        signedIn = true;
        fs.writeFileSync(path.join(dir, 'oauth_creds.json'), '{"refresh_token":"fake"}');
        fs.writeFileSync(path.join(dir, 'google_accounts.json'), '{"active":"me@example.com","old":[]}');
        // As the real CLI can after its sign-in: its auth menu on screen, "Login with Google" highlighted. Enter there
        // picks it again, and picking it clears the login it just saved (clearCachedCredentialFile).
        process.stdout.write('\r\nHow would you like to authenticate for this project?\r\n● 1. Login with Google\r\n');
      } else {
        fs.rmSync(path.join(dir, 'oauth_creds.json'), { force: true });
        fs.writeFileSync(path.join(dir, 'google_accounts.json'), '{"active":null,"old":["me@example.com"]}');
        process.exit(0);
      }
    }
  });
}
`;

describe.skipIf(!terminalsAvailable)('signing a Gemini login in with its CLI', () => {
  it('shows its link, sends the pasted code, and is signed in once its oauth_creds.json is written', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-gemini-signin-'));
    dirs.push(home);
    const script = path.join(home, 'fake-gemini.cjs');
    await fs.writeFile(script, FAKE_GEMINI);
    for (const m of ['log', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    const accounts = new Accounts({
      secretsFile: path.join(home, 'secrets.json'),
      file: path.join(home, 'accounts.json'),
      home,
      env: {},
      homedir: home,
      check: checkAccount,
      signIn: (o, exited) => startLocalSignIn(o, exited, { file: process.execPath, args: [script] }),
      spend: () => [],
      agents: () => [],
      builtInUsage: () => [],
      changed: () => undefined,
    });
    await accounts.init();
    const { id } = await accounts.add({ cli: 'gemini', kind: 'subscription-login', label: 'Google AI Plus' });
    const card = () => accounts.view().accounts.find((a) => a.id === id)!;
    accounts.signIn(id);
    await vi.waitFor(() => expect(card().signIn).toMatchObject({ running: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?fake=1', waiting: true }), { timeout: 10_000 });
    accounts.signInCodeIn(id, '4/0AfakeCode');
    await vi.waitFor(() => expect(card().signIn).toMatchObject({ running: false, ok: true, note: 'Signed in.' }), { timeout: 10_000 });
    await vi.waitFor(() => expect(card().status).toBe('ready'), { timeout: 5_000 });
    // Its login is still on file once the office has quit it: nothing typed into its screen undid it.
    const gemini = path.join(home, 'accounts', id, 'gemini', '.gemini');
    expect(await fs.readFile(path.join(gemini, 'oauth_creds.json'), 'utf8')).toContain('refresh_token');
    expect(JSON.parse(await fs.readFile(path.join(gemini, 'google_accounts.json'), 'utf8')).active).toBe('me@example.com');
    await accounts.flushed();
    vi.restoreAllMocks();
  }, 30_000);
});
