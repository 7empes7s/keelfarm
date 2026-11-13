import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { run } from './exec.ts';
import { localModel, type LocalProvider } from '../shared/models.ts';
import type { AgentCli, CliView, EffortLevel, KeyTrouble } from '../shared/types.ts';
import { keyTrouble } from '../shared/keyTrouble.ts';
import { resetTime } from '../shared/accountRotation.ts';
import { opencodeProviders } from '../shared/cliInstall.ts';
import type { BoxVersions } from './boxScripts.ts';
import { CEO_DISALLOWED, CROSS_TURN_TOOLS, OFFICE_DISALLOWED, toolsEnv, type SessionTools } from '../shared/tooling.ts';

// The coding-agent CLIs an agent can run in its terminal, how to find them on this machine, and how to start one on
// a task. Claude Code is fully wired in: its hooks report every tool call to the office.
// The others start on the same prompt and report only when a turn ends (Codex's notify program, an OpenCode plugin,
// Gemini CLI's AfterAgent hook); the office shows their task instead of their tool calls.

export interface CliDef {
  id: AgentCli;
  label: string;
  command: string;
  integrated: boolean;
}

export const CLIS: CliDef[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude', integrated: true },
  { id: 'codex', label: 'Codex', command: 'codex', integrated: false },
  { id: 'opencode', label: 'OpenCode', command: 'opencode', integrated: false },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini', integrated: false },
];

export const isCli = (v: unknown): v is AgentCli => CLIS.some((c) => c.id === v);
export { builderCli } from '../shared/cliNotes.ts';
export const cliLabel = (id: AgentCli) => CLIS.find((c) => c.id === id)?.label ?? id;

// ---------- finding a CLI ----------

const WIN = process.platform === 'win32';

/**
 * The executable for a command name in `first` (the office's own CLI folder) or on PATH: on Windows only
 * .exe/.cmd/.bat/.com, never an extensionless sh shim.
 */
export function resolveCommand(name: string, env: NodeJS.ProcessEnv = process.env, first: string[] = []): string | null {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const dirs = [...first, ...(env[key] ?? '').split(path.delimiter).filter(Boolean)];
  const exts = WIN ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => /^\.(exe|cmd|bat|com)$/i.test(e)) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext.toLowerCase());
      try {
        const st = fs.statSync(file);
        if (st.isFile() && (WIN || (st.mode & 0o111) !== 0)) return file;
      } catch {
        // not here
      }
    }
  }
  return null;
}

/**
 * npm installs Windows CLIs as .cmd shims. Running one puts every argument through cmd.exe, which expands %VARS% and
 * trips over quotes in a prompt, so run what the shim runs instead: the package's .exe, or node on its script.
 */
export function unwrapCmdShim(shimPath: string, text: string): { file: string; args: string[] } | null {
  const line = text.split(/\r?\n/).find((l) => /%\*\s*$/.test(l));
  if (!line) return null;
  const dir = path.dirname(shimPath);
  const targets = [...line.matchAll(/"%dp0%\\([^"]+)"/g)].map((m) => path.join(dir, m[1]));
  const target = targets[targets.length - 1];
  if (!target) return null;
  if (/\.exe$/i.test(target)) return { file: target, args: [] };
  if (!/\.[cm]?js$/i.test(target)) return null;
  const between = line.slice(line.indexOf('"%_prog%"') + '"%_prog%"'.length, line.lastIndexOf(`"%dp0%\\`));
  const nodeFlags = line.includes('"%_prog%"') ? between.trim().split(/\s+/).filter((f) => f.startsWith('--')) : [];
  const localNode = path.join(dir, 'node.exe');
  return { file: fs.existsSync(localNode) ? localNode : process.execPath, args: [...nodeFlags, target] };
}

/**
 * The Claude Code the Agent SDK ships as a per-platform package (the one `cubefarm login` signs in with), so the
 * terminal runtime works without Claude Code installed, on the version the office was tested with. Same lookup as
 * the SDK's own and bin/cubefarm.js.
 */
let bundled: string | null | undefined;

function bundledClaude(): string | null {
  if (bundled !== undefined) return bundled;
  bundled = null;
  let sdk: string;
  try {
    sdk = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
  } catch {
    return null;
  }
  const { platform, arch } = process;
  // Only Linux needs the report (glibc or musl). On Windows it walks every native handle, and with pseudo-consoles
  // closing on other threads that takes the whole office down.
  const report = platform === 'linux' ? (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined) : undefined;
  const musl = platform === 'linux' && !report?.header?.glibcVersionRuntime;
  const targets = platform === 'linux' ? (musl ? [`linux-${arch}-musl`, `linux-${arch}`] : [`linux-${arch}`, `linux-${arch}-musl`]) : [`${platform}-${arch}`];
  for (const target of targets) {
    try {
      bundled = createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${target}/claude${WIN ? '.exe' : ''}`);
      return bundled;
    } catch {
      // not installed for this target
    }
  }
  return null;
}

/** The office's own CLI folder (<SWARM_HOME>/cli, #493): CLIs installed from Settings, looked in before PATH. */
let officeBin: string[] = [];
export const useOfficeCliBin = (dir: string) => void (officeBin = [dir]);

/** How to start a CLI: the program and the arguments that come before the office's own. */
export function commandFor(id: AgentCli): { file: string; args: string[] } | null {
  const bundled = id === 'claude' ? bundledClaude() : null;
  if (bundled) return { file: bundled, args: [] };
  const def = CLIS.find((c) => c.id === id);
  const found = def && resolveCommand(def.command, process.env, officeBin);
  if (!found) return null;
  if (WIN && /\.(cmd|bat)$/i.test(found)) {
    try {
      return unwrapCmdShim(found, fs.readFileSync(found, 'utf8')) ?? { file: found, args: [] };
    } catch {
      return { file: found, args: [] };
    }
  }
  return { file: found, args: [] };
}

/** Which CLIs this machine has, with their versions; OpenCode's signed-in providers from `opencode auth list` (#493). */
export async function detectClis(): Promise<CliView[]> {
  return Promise.all(
    CLIS.map(async (c) => {
      const cmd = commandFor(c.id);
      const version = cmd ? await run(cmd.file, [...cmd.args, '--version'], { timeoutMs: 20_000 }).catch(() => null) : null;
      const auth = cmd && c.id === 'opencode' ? await run(cmd.file, [...cmd.args, 'auth', 'list'], { timeoutMs: 20_000 }).catch(() => null) : null;
      return { id: c.id, label: c.label, installed: !!cmd, version: version?.split(/\r?\n/)[0].trim().slice(0, 60) || null, integrated: c.integrated, ...(c.id === 'claude' && !!bundledClaude() && { bundled: true }), ...(auth !== null && { providers: opencodeProviders(auth) }) };
    }),
  );
}

// ---------- starting one on a task ----------

export interface LaunchContext {
  prompt: string;
  systemAppend: string;
  model: string; // '' = the CLI's own default
  effort: EffortLevel | '';
  resumeId?: string;
  sessionId: string; // the id the office gives a new Claude Code session
  name: string; // shown in Claude Code's prompt box and the terminal title
  role: 'agent' | 'ceo';
  additionalDirectories: string[];
  /** Files the office wrote for this session (settings, MCP config, instructions). */
  files: { settings: string; mcp: string | null; system: string };
  /** Where the CLI's turn-complete signal goes (Codex notify, the OpenCode plugin). */
  notify: { script: string; url: string };
  /** Codex's hook program: forwards each hook to the office (notify.url). */
  codexHook: string;
  plugin: string; // file URL of the OpenCode plugin
  /** The Playwright MCP server, when the floor tests in a browser. Claude Code gets it through its MCP config file. */
  browser: { command: string; args: string[] } | null;
  /** The CEO's office tools' MCP address (Streamable HTTP). Claude Code gets it through its MCP config file, the others here (#418). */
  office?: string;
  /** The manager's Tools & skills switches for this session (Claude Code only): more disallowed tools. */
  tools?: SessionTools;
  /** The node that runs the office's helper scripts where the CLI runs (default: the office's own). */
  node?: string;
  /** The CLI runs on Linux (a cloud agent's Box), whatever this computer is. */
  posix?: boolean;
  /** A consult (#637): Codex in its read-only sandbox, Gemini CLI in its read-only plan mode (Claude Code's hooks refuse edits). */
  readOnly?: boolean;
}

/** Pinned for cloud agents' Boxes (docs/cloud.md); Claude Code and Playwright's MCP follow the office's own (boxVersions). */
export const BOX_CODEX_VERSION = '0.163.0';

/** A field of an installed package's package.json, found from its entry file (its exports may not offer package.json). */
export function packageField(pkg: string, field: string): string | null {
  try {
    let dir = path.dirname(createRequire(import.meta.url).resolve(pkg));
    for (let i = 0; i < 6; i++) {
      const file = path.join(dir, 'package.json');
      if (fs.existsSync(file)) {
        const json = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        if (json.name === pkg) return typeof json[field] === 'string' ? (json[field] as string) : null;
      }
      dir = path.dirname(dir);
    }
  } catch {
    // not installed
  }
  return null;
}

/** The CLI versions a cloud agent's Box runs: Claude Code as the Agent SDK bundles it, Playwright's MCP as the office pins it. */
export function boxVersions(): BoxVersions {
  return {
    claude: packageField('@anthropic-ai/claude-agent-sdk', 'claudeCodeVersion') ?? 'latest',
    playwrightMcp: packageField('@playwright/mcp', 'version') ?? 'latest',
    codex: BOX_CODEX_VERSION,
  };
}

export interface Launch {
  args: string[];
  env: Record<string, string>;
  /** Files the CLI reads, written before it starts: [path, text]. */
  write?: [string, string][];
}

/** A local model server's address: `CUBEFARM_<ID>_URL` (e.g. CUBEFARM_OLLAMA_URL) when set, else its usual one. */
export function localUrl(p: LocalProvider, env: NodeJS.ProcessEnv = process.env): string {
  return env[`CUBEFARM_${p.id.toUpperCase()}_URL`]?.trim() || p.url;
}

/** Codex on a local model: its own --oss for Ollama and LM Studio at their usual address, else a provider of the office's. */
function codexLocal(model: string, toml: (s: string) => string): string[] {
  const local = localModel(model);
  if (!local) return model ? ['-m', model] : [];
  const { provider } = local;
  const url = localUrl(provider);
  if (provider.codexOss && url === provider.url) return ['--oss', '--local-provider', provider.id, '-m', local.model];
  const id = `cubefarm-${provider.id}`;
  return ['-c', `model_providers.${id}={name=${toml(provider.label)},base_url=${toml(url)},wire_api="responses"}`, '-c', `model_provider=${toml(id)}`, '-m', local.model];
}

/** OpenCode's provider entry for a local model, through the server's OpenAI-compatible API. */
function opencodeLocal(local: ReturnType<typeof localModel>): Record<string, unknown> {
  if (!local) return {};
  const { provider } = local;
  return {
    provider: {
      [provider.id]: { npm: '@ai-sdk/openai-compatible', name: provider.label, options: { baseURL: localUrl(provider) }, models: { [local.model]: { name: local.model } } },
    },
  };
}

const EFFORT_CODEX: Record<EffortLevel, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };

/** Gemini CLI's hooks the office listens to: its steps and turn endings (gemini-hook.cjs renames them). */
export const GEMINI_HOOK_EVENTS = ['BeforeTool', 'AfterTool', 'AfterAgent'];
/** The office's instructions for a Gemini CLI session, a context file of its own in the session's folder. */
export const GEMINI_CONTEXT_FILE = 'CUBEFARM.md';
/** The project instruction files Gemini CLI reads besides its own GEMINI.md: other agents' are the same rules. */
const GEMINI_CONTEXT_NAMES = ['GEMINI.md', 'AGENTS.md', 'CLAUDE.md'];

/** Codex hooks the office listens to: its steps, and Esc interrupting a turn. Turn endings come from notify. */
export const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Interrupt'];

/**
 * The command Codex runs for each hook. It never changes (the office's address travels in CUBEFARM_HOOK_URL), so the
 * manager trusts the hooks once in Codex's /hooks and that holds for every session. On Windows, Codex runs it through
 * PowerShell or cmd depending on its version, and a command starting with a quote fails in both: plain `node` (on the
 * PATH the office gave it) and the script in double quotes work in either. Elsewhere it goes through the shell.
 */
export function codexHookCommand(node: string, script: string, win = WIN): string {
  return win ? `node "${script}"` : [node, script].map((s) => `'${s.replaceAll("'", `'"'"'`)}'`).join(' ');
}

/**
 * Claude Code tools whose result arrives in a later turn (shared/tooling.ts). An office session ends with its turn, so
 * nothing would wake the agent. Background shells (run_in_background) stay: agents start dev servers with them.
 */
export { CROSS_TURN_TOOLS };

/** Claude Code's session settings with commit and PR attribution off (#599), in both spellings: 2.1 reads `attribution`. */
export const CLAUDE_NO_ATTRIBUTION = { attribution: { commit: '', pr: '', sessionUrl: false }, includeCoAuthoredBy: false } as const;

export function launchArgs(id: AgentCli, ctx: LaunchContext): Launch {
  switch (id) {
    case 'claude': {
      const disallowed = [...OFFICE_DISALLOWED, ...(ctx.role === 'ceo' ? CEO_DISALLOWED : []), ...(ctx.tools?.disallowed ?? [])];
      const args = [
        ...(ctx.resumeId ? ['--resume', ctx.resumeId] : ['--session-id', ctx.sessionId]),
        ...(ctx.model ? ['--model', ctx.model] : []),
        ...(ctx.effort ? ['--effort', ctx.effort] : []),
        // The office's PreToolUse hook answers every permission question (allow, or deny with an office rule).
        '--permission-mode',
        'acceptEdits',
        // On top of the manager's own setup (settings, skills, plugins, MCP servers): the office's hooks and servers.
        '--settings',
        ctx.files.settings,
        ...(ctx.files.mcp ? ['--mcp-config', ctx.files.mcp] : []),
        '--append-system-prompt-file',
        ctx.files.system,
        '--name',
        ctx.name,
        ...ctx.additionalDirectories.flatMap((d) => ['--add-dir', d]),
        '--disallowedTools',
        ...disallowed,
        '--',
        ctx.prompt,
      ];
      return { args, env: { DISABLE_AUTOUPDATER: '1', ...toolsEnv(ctx.tools) } }; // the office's own copy: agents mustn't each try to update it
    }
    case 'codex': {
      const toml = (s: string) => JSON.stringify(s); // a JSON string is a valid TOML basic string
      const args = [
        '--no-alt-screen',
        '-c',
        `notify=[${[ctx.node ?? process.execPath, ctx.notify.script, ctx.notify.url].map(toml).join(',')}]`,
        '-c',
        `developer_instructions=${toml(ctx.systemAppend)}`,
        ...codexLocal(ctx.model, toml),
        ...(ctx.effort ? ['-c', `model_reasoning_effort=${toml(EFFORT_CODEX[ctx.effort])}`] : []),
        ...(ctx.browser ? ['-c', `mcp_servers.playwright={command=${toml(ctx.browser.command)},args=[${ctx.browser.args.map(toml).join(',')}]}`] : []),
        ...(ctx.office ? ['-c', `mcp_servers.office={url=${toml(ctx.office)}}`] : []),
        '-c',
        'commit_attribution=""', // no "Co-authored-by: Codex" in its commits (#599)
        ...CODEX_HOOK_EVENTS.flatMap((e) => ['-c', `hooks.${e}=[{hooks=[{type="command",command=${toml(codexHookCommand(ctx.node ?? process.execPath, ctx.codexHook, ctx.posix ? false : WIN))},timeout=10}]}]`]),
        // Like the manager's own Codex, but it can't stop to ask: no approvals and no sandbox (its sandbox can't reach
        // the credential store, so git and gh fail in it). A consult only reads: its read-only sandbox.
        ...(ctx.readOnly ? ['--sandbox', 'read-only', '--ask-for-approval', 'never'] : ['--dangerously-bypass-approvals-and-sandbox']),
      ];
      return { args: ctx.resumeId ? ['resume', ...args, ctx.resumeId, ctx.prompt] : [...args, '--', ctx.prompt], env: { CUBEFARM_HOOK_URL: ctx.notify.url } };
    }
    case 'opencode': {
      const local = localModel(ctx.model);
      const config = {
        plugin: [ctx.plugin],
        instructions: [ctx.files.system],
        autoupdate: false, // several agents starting at once must not each reinstall it
        permission: { edit: 'allow', bash: 'allow', webfetch: 'allow', doom_loop: 'allow', external_directory: 'allow' }, // it can't stop to ask either
        ...opencodeLocal(local),
        ...(ctx.browser || ctx.office
          ? { mcp: { ...(ctx.browser && { playwright: { type: 'local', command: [ctx.browser.command, ...ctx.browser.args], enabled: true } }), ...(ctx.office && { office: { type: 'remote', url: ctx.office, enabled: true } }) } }
          : {}),
      };
      // No project argument: it starts in its terminal's folder, and a desk path in its command line would make the
      // desk clean-up take it for a leftover.
      const args = [
        '--auto',
        ...(ctx.model ? ['--model', local ? `${local.provider.id}/${local.model}` : ctx.model] : []),
        ...(ctx.resumeId ? ['--session', ctx.resumeId] : []),
        '--prompt',
        ctx.prompt,
      ];
      return { args, env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), CUBEFARM_NOTIFY_URL: ctx.notify.url } };
    }
    case 'gemini': {
      // Gemini CLI 0.68 (geminicli.com/docs). Its settings for this session come as the system settings file, which
      // wins over the manager's own; the office's instructions are a context file in the session's folder.
      const dir = path.dirname(ctx.files.system);
      const settingsFile = path.join(dir, 'gemini-settings.json');
      const script = path.join(path.dirname(ctx.notify.script), 'gemini-hook.cjs'); // next to the other helpers (HELPER_FILES)
      const hook = [{ hooks: [{ type: 'command', name: 'cubefarm', command: codexHookCommand(ctx.node ?? process.execPath, script), timeout: 10_000 }] }];
      const settings = {
        hooks: Object.fromEntries(GEMINI_HOOK_EVENTS.map((e) => [e, hook])),
        context: { fileName: [...GEMINI_CONTEXT_NAMES, GEMINI_CONTEXT_FILE], includeDirectories: [dir, ...ctx.additionalDirectories], loadMemoryFromIncludeDirectories: true },
        general: { enableAutoUpdate: false, enableAutoUpdateNotification: false }, // several agents starting at once
        ...(ctx.browser || ctx.office ? { mcpServers: { ...(ctx.browser && { playwright: { command: ctx.browser.command, args: ctx.browser.args } }), ...(ctx.office && { office: { httpUrl: ctx.office } }) } } : {}),
      };
      // It can't stop to ask: yolo approves every tool call, --skip-trust trusts the worktree for this session.
      const args = [
        '--approval-mode',
        ctx.readOnly ? 'plan' : 'yolo',
        '--skip-trust',
        ...(/^(gemini|auto)/i.test(ctx.model) ? ['--model', ctx.model] : []), // another CLI's model means its default
        ...(ctx.resumeId ? ['--resume', ctx.resumeId] : []),
        `--prompt-interactive=${ctx.prompt}`, // one argument: a prompt starting with "-" isn't read as a flag
      ];
      return {
        args,
        env: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsFile, CUBEFARM_HOOK_URL: ctx.notify.url },
        write: [
          [path.join(dir, GEMINI_CONTEXT_FILE), ctx.systemAppend],
          [settingsFile, JSON.stringify(settings, null, 2)],
        ],
      };
    }
  }
}

/** Before a CLI starts on this computer: the files it reads (Gemini CLI's settings and instructions). */
export function prepareLaunch(launch: Launch) {
  for (const [file, text] of launch.write ?? []) fs.writeFileSync(file, text);
}

// ---------- Codex's saved threads ----------

/** Runs each key's steps one after another; one that fails doesn't hold up the next. */
export function oneAtATime() {
  const tails = new Map<string, Promise<void>>();
  return (key: string, step: () => Promise<unknown>): Promise<void> => {
    const next = (tails.get(key) ?? Promise.resolve()).then(step).then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, next);
    void next.then(() => tails.get(key) === next && tails.delete(key));
    return next;
  };
}

const threadSteps = oneAtATime();

/**
 * Codex saves every terminal session where the manager's own Codex and ChatGPT apps list it with their chats. The
 * office archives its threads there once their CLI is gone (`after`), and unarchives one before resuming it: Codex
 * won't resume an archived thread. A thread's steps run in order; one with nothing to do (already archived) fails.
 */
export function codexThread(action: 'archive' | 'unarchive', id: string, after?: Promise<unknown>): Promise<void> {
  return threadSteps(id, async () => {
    await after;
    const cmd = commandFor('codex');
    if (cmd) await run(cmd.file, [...cmd.args, action, id], { timeoutMs: 30_000 });
  });
}

// ---------- prompts the office answers ----------

// The question's title line (never an option: "Yes, I trust this folder" mustn't count as one).
const TRUST_PROMPT = /Quick safety check|Do you trust the (files|contents) (in|of) this|allow Codex to work in this folder/i;

/**
 * The key that moves a CLI's folder-trust question toward trusting the office's own worktree: Enter only while the
 * yes option ("Yes, I trust this folder", Codex's "Yes, continue") is the selected one, else a step toward it; null
 * when there's no such question on screen or its menu can't be read. Only the last copy of the question counts: a
 * CLI that redraws it (a resize) can leave an older frame above, whose stale ❯ would otherwise be read (#575).
 */
export function trustKey(screen: string): 'enter' | 'down' | 'up' | null {
  const lines = screen.split('\n');
  const title = lines.findLastIndex((l) => TRUST_PROMPT.test(l));
  if (title < 0) return null;
  const opts = lines.slice(title + 1).flatMap((l) => {
    // An option has a ❯ or a number, or reads "Yes, …" / "No, …": a wrapped title line ("trust? (Like your own…") isn't one.
    const m = /^[\s│┃|]*([❯›>])?\s*(\d+\.\s+)?((?:yes|no|trust|continue|proceed|exit|quit|cancel)\b.*?)[\s│┃|]*$/i.exec(l);
    return m && (m[1] || m[2] || /^(yes|no),/i.test(m[3])) ? [{ text: m[3], selected: !!m[1] }] : [];
  });
  const yes = opts.findIndex((o) => /^(yes|trust|continue|proceed)\b/i.test(o.text));
  const at = opts.findIndex((o) => o.selected);
  if (yes < 0 || at < 0 || opts.filter((o) => o.selected).length > 1) return null;
  return yes === at ? 'enter' : yes > at ? 'down' : 'up';
}

/**
 * Codex asks to review new hooks before it starts. They only show the office Codex's steps, so trusting them is the
 * manager's call (once, in /hooks): the office moves to "Continue without trusting" (Down) and takes it (Enter).
 */
export function hookReviewKey(screen: string): 'enter' | 'down' | null {
  if (!/Hooks need review/i.test(screen)) return null;
  const selected = screen.match(/^\s*[❯›]\s*(?:\d+\.\s*)?(.+)$/m)?.[1] ?? '';
  return /^continue without trusting/i.test(selected.trim()) ? 'enter' : 'down';
}

/**
 * Lines on screen where a CLI says it interrupted a turn (Claude Code: "Interrupted · What should Claude do
 * instead?", Codex: "Conversation interrupted"). Esc fires no hook in Claude Code, so a new one is how the office
 * knows the manager stopped the turn from the terminal.
 */
export function interruptions(screen: string): number {
  return screen.split('\n').filter((l) => /\binterrupted\b/i.test(l)).length;
}

/**
 * A CLI saying its login is gone or was turned away, in its own words: Claude Code's "· Please run /login" family
 * ("Login expired", "OAuth token revoked", "Failed to authenticate"), Codex's "access token could not be refreshed…
 * sign in again" and its sign-in screen. Only read at the end of a session that failed or said nothing.
 */
export function signedOutScreen(screen: string): boolean {
  return /Please run \/login|Sign in again to continue|Login expired|OAuth (?:access )?token (?:has )?(?:expired|been revoked|revoked)|Failed to authenticate|access token could not be refreshed|log out and sign in again|Sign in with ChatGPT|run '?`?codex login/i.test(
    screen,
  );
}

/**
 * Gemini CLI out of usage, as its terminal shows it: "Usage limit reached for gemini-3-pro." over "Access resets at
 * 4:15 PM UTC." and "/model to switch models.", then a Switch / Stop menu that would wait forever. Its line and when
 * it resets; null when that isn't on screen (a file that only quotes the words doesn't count).
 */
export function geminiLimit(screen: string, now: number): { line: string; until: number } | null {
  if (!screen.includes('/model to switch models')) return null;
  const line = screen
    .split('\n')
    .map((l) => l.replace(/^[\s│┃|✕×*>]+/, '').trim())
    .find((l) => /^(?:Usage limit reached for \S+|You have exhausted your (?:daily )?(?:capacity|quota))/i.test(l));
  return line ? { line: line.replace(/[\s│┃|]+$/, ''), until: resetTime(screen, now) ?? now + 60 * 60_000 } : null;
}

/**
 * Why a cloud agent's session that failed (or said nothing) ended, when it's their login: the office's API key ran out
 * of credit or was turned away (#258), or the CLI's own login is gone. Only the screen's last lines count for the key:
 * the error is the CLI's last word, not something the agent printed while working.
 */
export function lostLogin(screen: string, errors: string[], label: string): { keyTrouble?: KeyTrouble; signedOut?: true; errors: string[] } | null {
  const trouble = keyTrouble([...screen.split('\n').filter((l) => l.trim()).slice(-12), ...errors].join('\n'));
  if (trouble) return { keyTrouble: trouble, errors: [`${label}'s API key ${trouble === 'out-of-credit' ? 'ran out of credit' : 'was turned away'}.`] };
  if (signedOutScreen(screen) || errors.some((e) => /authentication failed/i.test(e))) return { signedOut: true, errors: [`${label}'s sign-in in their cloud machine expired or was turned away.`] };
  return null;
}

// ---------- helper scripts the CLIs run ----------

/** Claude Code's status line: posts its data (cost, usage limits) to the office and shows the office's line. */
export const STATUSLINE_SOURCE = String.raw`// cubefarm: Claude Code's status line. Forwards the session's status to the office and prints the office's line.
const url = process.argv[2];
let body = '';
process.stdin.on('data', (c) => (body += c));
process.stdin.on('end', async () => {
  try {
    const status = JSON.parse(body);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'StatusLine', session_id: status.session_id, cost: status.cost, rate_limits: status.rate_limits }),
      signal: AbortSignal.timeout(2000),
    });
    const out = await res.json();
    process.stdout.write(String(out.statusLine ?? ''));
  } catch {
    process.stdout.write('cubefarm');
  }
});
`;

/** Codex's notify program: Codex runs it with a JSON argument when a turn completes. */
export const NOTIFY_SOURCE = String.raw`// cubefarm: Codex's notify program. Tells the office a turn is complete.
const [url, payload] = process.argv.slice(2);
let event = {};
try {
  event = JSON.parse(payload ?? '{}');
} catch {}
if (event.type === 'agent-turn-complete') {
  const input = String((event['input-messages'] ?? [])[0] ?? '').slice(0, 300);
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hook_event_name: 'TurnComplete', session_id: event['thread-id'] ?? null, last_assistant_message: event['last-assistant-message'] ?? '', input }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
`;

/** Codex's hook program: passes what Codex tells a hook on to the office and answers nothing, so Codex carries on as usual. */
export const CODEX_HOOK_SOURCE = String.raw`// cubefarm: Codex's hooks. Tells the office what Codex is doing; never changes what it does.
const url = process.env.CUBEFARM_HOOK_URL;
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  try {
    if (url) await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(5000) });
  } catch {}
  process.stdout.write('{}');
});
`;

/**
 * Gemini CLI's hook program: its hooks in the office's words (AfterAgent is a turn ending, BeforeTool / AfterTool its
 * steps), answering nothing so Gemini carries on as usual.
 */
export const GEMINI_HOOK_SOURCE = String.raw`// cubefarm: Gemini CLI's hooks. Tells the office what Gemini is doing; never changes what it does.
const url = process.env.CUBEFARM_HOOK_URL;
const chunks = [];
const text = (r) => (typeof r === 'string' ? r : typeof r?.returnDisplay === 'string' ? r.returnDisplay : typeof r?.llmContent === 'string' ? r.llmContent : '');
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  try {
    const b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const id = b.session_id ?? null;
    const out =
      b.hook_event_name === 'AfterAgent'
        ? { hook_event_name: 'TurnComplete', session_id: id, last_assistant_message: String(b.prompt_response ?? '') }
        : b.hook_event_name === 'BeforeTool'
          ? { hook_event_name: 'PreToolUse', session_id: id, tool_name: b.tool_name, tool_input: b.tool_input }
          : b.hook_event_name === 'AfterTool'
            ? { hook_event_name: 'PostToolUse', session_id: id, tool_name: b.tool_name, tool_response: text(b.tool_response).slice(0, 4000) }
            : null;
    if (url && out) await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(out), signal: AbortSignal.timeout(5000) });
  } catch {}
  process.stdout.write('{}');
});
`;

/** OpenCode plugin: reports its session and when it goes idle (a turn is complete). No imports: loaded from a file. */
export const OPENCODE_PLUGIN_SOURCE = String.raw`// cubefarm: tells the office when OpenCode's session goes idle.
export default async function CubefarmPlugin({ client } = {}) {
  const url = process.env.CUBEFARM_NOTIFY_URL;
  if (!url) return {};
  let root;
  const post = (body) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) }).catch(() => {});
  const lastReply = async (id) => {
    try {
      const res = await client.session.messages({ path: { id } });
      const reply = (res?.data ?? []).filter((m) => m?.info?.role === 'assistant').pop();
      return (reply?.parts ?? []).filter((p) => p?.type === 'text').map((p) => p.text).join('\n').trim();
    } catch {
      return '';
    }
  };
  return {
    event: async ({ event }) => {
      const props = event?.properties ?? {};
      if (event?.type === 'session.created' && !props.info?.parentID && !root) root = props.info?.id;
      const sessionID = props.sessionID ?? props.info?.id;
      if (event?.type === 'session.idle' && (!root || sessionID === root)) {
        post({ hook_event_name: 'TurnComplete', session_id: sessionID ?? null, last_assistant_message: sessionID ? await lastReply(sessionID) : '' });
      }
      if (event?.type === 'session.error') post({ hook_event_name: 'TurnError', session_id: sessionID ?? null, error: String(props.error?.data?.message ?? props.error?.name ?? 'error') });
    },
  };
}
`;

/** The helper programs above, by file name. */
const HELPER_FILES: [string, string][] = [
  ['statusline.cjs', STATUSLINE_SOURCE],
  ['notify.cjs', NOTIFY_SOURCE],
  ['codex-hook.cjs', CODEX_HOOK_SOURCE],
  ['opencode-plugin.mjs', OPENCODE_PLUGIN_SOURCE],
  ['gemini-hook.cjs', GEMINI_HOOK_SOURCE],
];

/** Writes the helper programs into the office's bin folder, for the CLIs to run. */
export function writeHelperFiles(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, source] of HELPER_FILES) fs.writeFileSync(path.join(dir, name), source);
}
