// A login account's CLI signing in on this computer (#247, docs/accounts.md), in the account's terminal: the same login
// as a cloud agent's (cliRunner.ts startBoxSignIn), with the account's own folder in `env` (CLAUDE_CONFIG_DIR or
// CODEX_HOME, GEMINI_CLI_HOME). The office only relays the terminal's keys and screen; the login stays in that folder. The keeper keeps
// no record of it, so an office restart ends it.
import os from 'node:os';
import { signInCommand } from './boxScripts.ts';
import { cliLabel, commandFor } from './clis.ts';
import { spawnPty, terminalsAvailable, type Pty } from './ptyClient.ts';
import { cliEnv } from './unblock.ts';
import type { BoxSignIn } from './cliRunner.ts';
import type { AgentTerminal } from './terminal.ts';
import type { AccountCli, SignInMode } from '../shared/types.ts';

/**
 * Gemini CLI has no login command: one tiny prompt with NO_BROWSER signs it in (its link, then "Enter the
 * authorization code:") and exits once answered. --skip-trust: the home folder it runs in needn't be trusted.
 */
const GEMINI_SIGN_IN = { args: ['--skip-trust', '--prompt', 'Reply with the single word OK.'], env: { NO_BROWSER: 'true' } };

/** `exited` hears its exit code; stop() doesn't call it. `setup-token` runs `claude setup-token` instead of its login. */
export function startLocalSignIn(o: { cli: AccountCli; env: Record<string, string>; term: AgentTerminal; mode?: SignInMode }, exited: (code: number) => void): BoxSignIn {
  const { term } = o;
  const cmd = commandFor(o.cli);
  let pty: Pty | null = null;
  let over = false;
  const end = (code: number | null) => {
    if (over) return;
    over = true;
    term.bind(null);
    pty?.kill();
    if (code !== null) exited(code);
  };
  const token = o.mode === 'setup-token' && o.cli === 'claude';
  term.note(token ? `── Making a ${cliLabel(o.cli)} setup token ──` : `── Signing ${cliLabel(o.cli)} in ──`);
  try {
    if (!terminalsAvailable || !cmd) throw new Error(!terminalsAvailable ? 'the terminal module could not be loaded on this machine' : `${cliLabel(o.cli)} isn't installed`);
    const gemini = o.cli === 'gemini'; // its folder was set up first (Accounts.signIn)
    const args = token ? ['setup-token'] : o.cli === 'gemini' ? GEMINI_SIGN_IN.args : signInCommand(o.cli).args;
    const p = spawnPty(cmd.file, [...cmd.args, ...args], { cols: term.cols, rows: term.rows, cwd: os.homedir(), env: cliEnv(process.env, gemini ? GEMINI_SIGN_IN.env : {}, { machine: o.env }) }, {});
    pty = p;
    term.bind({ write: (d) => p.write(d), resize: (c, r) => p.resize(c, r) });
    p.onData((d) => !over && term.write(d));
    p.onExit((code) => {
      pty = null;
      end(code);
    });
  } catch (err) {
    term.note(`Couldn't start signing in: ${(err as Error).message}`);
    setTimeout(() => end(-1), 0);
  }
  return { stop: () => end(null) };
}
