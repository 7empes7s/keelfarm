// A login account's CLI signing in on this computer (#247, docs/accounts.md), in the account's terminal: the same login
// as a cloud agent's (cliRunner.ts startBoxSignIn), with the account's own folder in `env` (CLAUDE_CONFIG_DIR or
// CODEX_HOME, GEMINI_CLI_HOME). The office only relays the terminal's keys and screen; the login stays in that folder. The keeper keeps
// no record of it, so an office restart ends it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signInCommand } from './boxScripts.ts';
import { cliLabel, commandFor } from './clis.ts';
import { spawnPty, terminalsAvailable, type Pty } from './ptyClient.ts';
import { cliEnv } from './unblock.ts';
import type { BoxSignIn } from './cliRunner.ts';
import type { AgentTerminal } from './terminal.ts';
import type { AgentCli, SignInMode } from '../shared/types.ts';

/**
 * Gemini CLI has no login command: started interactively with NO_BROWSER and the Google sign-in picked in its folder
 * (geminiHome.ts), it prints its link and "Enter the authorization code:". Never --prompt: a non-interactive Gemini
 * CLI refuses that sign-in and exits 41 (#540). It stays open once signed in, so the office quits it when its
 * oauth_creds.json appears. --skip-trust: the home folder it runs in needn't be trusted.
 */
export const GEMINI_SIGN_IN = { args: ['--skip-trust'], env: { NO_BROWSER: 'true' } };

/** How often a Gemini sign-in looks for its oauth_creds.json, and how long /quit gets before its CLI is stopped. */
const CREDS_POLL_MS = 500;
const QUIT_MS = 5_000;

const mtime = (file: string) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/**
 * `exited` hears its exit code (0 once a Gemini login is on file); stop() doesn't call it. `setup-token` runs `claude
 * setup-token` instead of its login; OpenCode runs `opencode auth login` (#493). `cmd`: the CLI to run (tests' fake).
 */
export function startLocalSignIn(o: { cli: AgentCli; env: Record<string, string>; term: AgentTerminal; mode?: SignInMode }, exited: (code: number) => void, cmd = commandFor(o.cli)): BoxSignIn {
  const { term } = o;
  let pty: Pty | null = null;
  let over = false;
  let signedIn = false;
  const timers: NodeJS.Timeout[] = [];
  const end = (code: number | null) => {
    if (over) return;
    over = true;
    for (const t of timers) clearTimeout(t);
    term.bind(null);
    pty?.kill();
    if (code !== null) exited(code);
  };
  const token = o.mode === 'setup-token' && o.cli === 'claude';
  term.note(token ? `── Making a ${cliLabel(o.cli)} setup token ──` : `── Signing ${cliLabel(o.cli)} in ──`);
  try {
    if (!terminalsAvailable || !cmd) throw new Error(!terminalsAvailable ? 'the terminal module could not be loaded on this machine' : `${cliLabel(o.cli)} isn't installed`);
    const gemini = o.cli === 'gemini'; // its folder was set up first (Accounts.signIn)
    const args = token ? ['setup-token'] : o.cli === 'gemini' ? GEMINI_SIGN_IN.args : o.cli === 'opencode' ? ['auth', 'login'] : signInCommand(o.cli).args;
    const p = spawnPty(cmd.file, [...cmd.args, ...args], { cols: term.cols, rows: term.rows, cwd: os.homedir(), env: cliEnv(process.env, gemini ? GEMINI_SIGN_IN.env : {}, { machine: o.env }) }, {});
    pty = p;
    term.bind({ write: (d) => p.write(d), resize: (c, r) => p.resize(c, r) });
    p.onData((d) => !over && term.write(d));
    p.onExit((code) => {
      pty = null;
      end(signedIn ? 0 : code);
    });
    if (gemini) {
      const creds = path.join(o.env.GEMINI_CLI_HOME ?? process.env.GEMINI_CLI_HOME ?? os.homedir(), '.gemini', 'oauth_creds.json');
      const before = mtime(creds);
      const look = setInterval(() => {
        if (mtime(creds) <= before) return;
        clearInterval(look);
        signedIn = true;
        p.write('/quit');
        timers.push(setTimeout(() => !over && p.write('\r'), 200)); // Enter apart from the text, as typed
        timers.push(setTimeout(() => end(0), QUIT_MS)); // it didn't quit: stopped by its pid
      }, CREDS_POLL_MS);
      timers.push(look);
    }
  } catch (err) {
    term.note(`Couldn't start signing in: ${(err as Error).message}`);
    setTimeout(() => end(-1), 0);
  }
  return { stop: () => end(null) };
}
