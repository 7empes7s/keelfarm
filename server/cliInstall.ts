// Installing a missing coding-agent CLI from Settings → Providers (#493): the official npm package, pinned, into the
// office's own prefix (<SWARM_HOME>/cli, as a Box's setup does in boxScripts.ts), one install at a time, then the CLIs
// looked for again and sent to the tabs, so a card turns usable without restarting the office. OpenCode's own
// sign-in (`opencode auth login`) runs in the `cli:opencode` terminal from here too.
import fs from 'node:fs';
import path from 'node:path';
import { run, type CommandError } from './exec.ts';
import { BOX_CODEX_VERSION, CLIS, boxVersions, cliLabel, resolveCommand } from './clis.ts';
import { HttpError } from './httpError.ts';
import { AgentTerminal } from './terminal.ts';
import type { BoxSignIn } from './cliRunner.ts';
import { logTail } from '../shared/cliInstall.ts';
import type { AgentCli, CliInstallRun, CliView } from '../shared/types.ts';

const WIN = process.platform === 'win32';

/** The npm package of each CLI and the version the office was tested with (Claude Code: as the Agent SDK bundles it). */
export function cliPackage(id: AgentCli): string {
  switch (id) {
    case 'claude':
      return `@anthropic-ai/claude-code@${boxVersions().claude}`;
    case 'codex':
      return `@openai/codex@${BOX_CODEX_VERSION}`;
    case 'gemini':
      return '@google/gemini-cli@0.68.0';
    case 'opencode':
      return 'opencode-ai@1.19.5';
  }
}

export const cliPrefix = (home: string) => path.join(home, 'cli');
/** Where `npm install -g --prefix` puts the commands: the prefix itself on Windows, its bin elsewhere. */
export const cliBinDir = (prefix: string, win = WIN) => (win ? prefix : path.join(prefix, 'bin'));

export function npmInstallArgs(prefix: string, spec: string): string[] {
  return ['install', '-g', '--prefix', prefix, '--no-fund', '--no-audit', '--loglevel=error', spec];
}

/** npm without a shell: its own script next to this node (Windows has no npm executable, only a .cmd), else `npm`. */
function npmCommand(): { file: string; args: string[] } {
  const dir = path.dirname(process.execPath);
  const script = [path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find((f) => fs.existsSync(f));
  return script ? { file: process.execPath, args: [script] } : { file: 'npm', args: [] };
}

/** Installs one CLI's package into the prefix and checks its command is there. Never throws. */
export async function npmInstall(id: AgentCli, o: { prefix: string; npm?: { file: string; args: string[] } }): Promise<{ ok: boolean; tail: string[] }> {
  const npm = o.npm ?? npmCommand();
  try {
    fs.mkdirSync(o.prefix, { recursive: true });
    const out = await run(npm.file, [...npm.args, ...npmInstallArgs(o.prefix, cliPackage(id))], { timeoutMs: 10 * 60_000 });
    const command = CLIS.find((c) => c.id === id)!.command;
    if (resolveCommand(command, {}, [cliBinDir(o.prefix)])) return { ok: true, tail: logTail(out) };
    return { ok: false, tail: [...logTail(out, 6), `npm finished but ${command} isn't in ${cliBinDir(o.prefix)}.`] };
  } catch (err) {
    const e = err as CommandError;
    return { ok: false, tail: logTail(e.stderr || e.message) };
  }
}

export interface CliSetupDeps {
  detect: () => Promise<CliView[]>;
  install: (id: AgentCli) => Promise<{ ok: boolean; tail: string[] }>;
  /** `opencode auth login` in the terminal; `exited` hears its exit code. */
  signIn: (term: AgentTerminal, exited: (code: number) => void) => BoxSignIn;
  changed: (clis: CliView[]) => void;
}

export class CliSetup {
  private found: CliView[] = [];
  private installs = new Map<AgentCli, CliInstallRun>();
  private checking: Promise<CliView[]> | null = null;
  private run: BoxSignIn | null = null;
  private signInRun: CliView['signIn'];
  /** OpenCode's sign-in terminal (/ws/term?agent=cli:opencode). */
  readonly terminal = new AgentTerminal();

  constructor(private deps: CliSetupDeps) {}

  view(): CliView[] {
    return this.found.map((c) => {
      const install = this.installs.get(c.id);
      return { ...c, ...(install && { install }), ...(c.id === 'opencode' && this.signInRun && { signIn: this.signInRun }) };
    });
  }

  private emit() {
    this.deps.changed(this.view());
  }

  /** Look for the CLIs again ("Check again", after an install or a sign-in that couldn't start); one look at a time. */
  check(): Promise<CliView[]> {
    this.checking ??= this.deps
      .detect()
      .then((found) => {
        this.found = found;
        this.emit();
        return this.view();
      })
      .finally(() => (this.checking = null));
    return this.checking;
  }

  /** POST /api/clis/:id/install: never two at once, never one already here. */
  async install(id: AgentCli): Promise<CliInstallRun> {
    if ([...this.installs.values()].some((r) => r.running)) throw new HttpError(409, 'Another coding agent is installing: wait for it to finish.');
    if (this.found.some((c) => c.id === id && c.installed)) throw new HttpError(400, `${cliLabel(id)} is already installed.`);
    this.installs.set(id, { running: true, ok: false, note: `Installing ${cliPackage(id)}…`, tail: [] });
    this.emit();
    const r = await this.deps.install(id).catch((err: Error) => ({ ok: false, tail: [err.message] }));
    await this.check().catch(() => undefined);
    const here = this.found.some((c) => c.id === id && c.installed);
    const done: CliInstallRun = here ? { running: false, ok: true, note: `${cliLabel(id)} installed.`, tail: [] } : { running: false, ok: false, note: `Installing ${cliLabel(id)} failed.`, tail: r.ok ? ['Installed, but the office still can’t find it.'] : r.tail };
    this.installs.set(id, done);
    this.emit();
    return done;
  }

  /** POST /api/clis/opencode/signin: `opencode auth login` in its terminal; how it ended goes on the card. */
  signIn(): void {
    if (!this.found.some((c) => c.id === 'opencode' && c.installed)) throw new HttpError(400, "OpenCode isn't installed. Tap Install.");
    this.run?.stop();
    const run = this.deps.signIn(this.terminal, (code) => {
      if (this.run !== run) return;
      this.run = null;
      this.signInRun = code === 0 ? { running: false, ok: true, note: 'Signed in.' } : { running: false, ok: false, note: code < 0 ? 'It could not start. Try again.' : `It ended without signing in (exit ${code}). Try again.` };
      void this.check().catch(() => undefined); // its providers
    });
    this.run = run;
    this.signInRun = { running: true, ok: false, note: '' };
    this.emit();
  }
}
