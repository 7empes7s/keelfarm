// Nothing waits on a human: an office session's prompts are answered by the office (#54). Pure, so it's tested and
// shared by the terminal runtime (cliRunner.ts) and the demo's fake sessions: the permission rules each Claude Code
// session gets for its own worktree, the non-interactive environment of every CLI, the answers to permission
// requests, MCP forms and questions, and the watchdog's steps for a prompt that still shows in a terminal.

import path from 'node:path';
import { BOX_ENV } from './cloud.ts';

/** What a question gets while nobody can answer (the CEO taking questions over is #36). */
export const DEFAULT_REPLY = 'Nobody can answer now: pick the option that best fits the issue and note it in the PR.';
/** A prompt still on screen this long after it showed is answered in the terminal (time for it to draw, or for a hook). */
export const ANSWER_AFTER_MS = 3_000;
/** No output this long with a prompt on screen: the session is waiting on one the office was never told about. */
export const STALL_MS = 60_000;
/** Blocked this long, and the manager is told (once). */
export const NOTIFY_BLOCKED_MS = 5 * 60_000;

/** Folders Claude Code guards even in a session's own worktree: it asks before writing there. */
export const PROTECTED_DIRS = ['.claude', '.git', '.vscode', '.idea', '.husky'];

/** Tools that would stop a session to ask the manager something. */
const QUESTION_TOOLS = new Set(['AskUserQuestion']);

/** A folder as a Claude Code permission rule path: `//` + an absolute POSIX path (C:\a → //c/a). */
export function rulePath(dir: string): string {
  const posix = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  const drive = posix.match(/^([A-Za-z]):(\/.*)?$/);
  return `/${drive ? `/${drive[1].toLowerCase()}${drive[2] ?? ''}` : posix}`;
}

/**
 * The permission rules a session's settings file adds: edits anywhere in its own worktree, its guarded folders named
 * outright (agents write .claude/skills and the like), and nothing outside it. The manager's ~/.claude stays untouched.
 */
export function worktreePermissions(worktree: string): { allow: string[] } {
  const root = rulePath(worktree);
  return { allow: [`Edit(${root}/**)`, ...PROTECTED_DIRS.map((d) => `Edit(${root}/${d}/**)`)] };
}

/**
 * What every CLI the office starts runs with, so a command never waits on a terminal nobody watches: git's editor
 * and credential prompts, npm/npx's "Ok to proceed?", ssh's passphrase and host-key questions (BatchMode fails them
 * at once instead). A merge or rebase keeps git's own message; a commit without -m fails instead of opening an editor.
 * An ssh command the manager set up themselves is kept.
 */
export function nonInteractiveEnv(env: Record<string, string | undefined>): Record<string, string> {
  return {
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    CI: '1',
    npm_config_yes: 'true',
    ...(env.GIT_SSH_COMMAND || env.GIT_SSH ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
  };
}

/**
 * A CLI's environment. Each agent must be a clean instance on the account its CLI is logged into: no API keys (they
 * would switch Claude Code's billing to the API) and nothing inherited from a Claude Code session the office itself
 * was started from. In a Box nothing of the office's own environment goes along (a Windows PATH, the manager's other
 * secrets): only what a Box needs and the credentials this CLI signs in with. Either way nothing in it waits on a
 * prompt (unblock.ts nonInteractiveEnv).
 */
export function cliEnv(base: NodeJS.ProcessEnv, launchEnv: Record<string, string>, where: { box: Record<string, string> } | { machine?: Record<string, string> }): Record<string, string> {
  const env: Record<string, string> = {};
  if ('box' in where) return Object.assign(env, BOX_ENV, nonInteractiveEnv(where.box), where.box, launchEnv);
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (/^(ANTHROPIC_|CLAUDE)/i.test(k) && k !== 'CLAUDE_CONFIG_DIR') continue;
    if (/^(NO_COLOR|FORCE_COLOR|TERM_PROGRAM|TERM_PROGRAM_VERSION|CODEX_THREAD_ID|OPENCODE_CONFIG_CONTENT)$/i.test(k)) continue;
    env[k] = v;
  }
  return Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }, nonInteractiveEnv(env), where.machine, launchEnv);
}

export type PermissionAnswer = { behavior: 'allow' } | { behavior: 'deny'; message: string };

/** The file a file-writing tool call writes, resolved against the session's folder; null for other tools. */
function writtenFile(tool: string, input: Record<string, unknown>, cwd: string): string | null {
  if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return null;
  const file = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : '';
  return file ? path.resolve(cwd, file) : null;
}

const inside = (file: string, root: string) => {
  const rel = path.relative(root, file);
  return rel === '' || (rel.split(/[\\/]/)[0] !== '..' && !path.isAbsolute(rel));
};

/**
 * The office's answer to a permission question: allow, unless the call writes a file outside the session's own
 * folders (`roots[0]` is its worktree; then its temp folder and the like), which is denied with the reason.
 */
export function permissionAnswer(tool: string, input: Record<string, unknown>, roots: string[]): PermissionAnswer {
  const file = roots.length ? writtenFile(tool, input, roots[0]) : null;
  if (file && !roots.some((r) => inside(file, r))) return { behavior: 'deny', message: `The office denies writes outside your worktree (${file}). Work in ${roots[0]}.` };
  return { behavior: 'allow' };
}

export interface HookAnswer {
  /** What goes back to the CLI. */
  reply: Record<string, unknown>;
  /** The line for the agent's feed. */
  note: string;
}

/**
 * A hook that would otherwise leave a session waiting, answered: a permission request (allow or deny by the office's
 * rule), an MCP server's form (declined: nobody can fill it in) or a question (the default reply, as the tool's
 * refusal). Null for any other hook.
 */
export function answerHook(b: Record<string, unknown>, roots: string[]): HookAnswer | null {
  const event = String(b.hook_event_name ?? '');
  const tool = String(b.tool_name ?? '');
  const input = (b.tool_input && typeof b.tool_input === 'object' ? b.tool_input : {}) as Record<string, unknown>;
  if (event === 'PermissionRequest') {
    const a = permissionAnswer(tool, input, roots);
    const decision = a.behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: a.message };
    const note = a.behavior === 'allow' ? `🤖 Auto-answered a permission prompt: allowed ${tool || 'the tool call'}.` : `🤖 Auto-answered a permission prompt: denied ${tool}. ${a.message}`;
    return { reply: { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }, note };
  }
  if (event === 'Elicitation') {
    const server = String(b.mcp_server_name ?? 'an MCP server');
    return { reply: { hookSpecificOutput: { hookEventName: 'Elicitation', action: 'decline' } }, note: `🤖 Auto-answered ${server}'s form: declined (nobody can fill it in).` };
  }
  if (event === 'PreToolUse' && QUESTION_TOOLS.has(tool)) {
    return { reply: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: DEFAULT_REPLY } }, note: `🤖 Auto-answered a question: "${DEFAULT_REPLY}"` };
  }
  return null;
}

// ---------- the watchdog ----------

/** A prompt showing in a session's terminal that no hook answered. */
export interface Waiting {
  kind: 'permission' | 'elicitation';
  since: number;
  /** The last tool call the session made (the one the prompt is most likely about). */
  tool: string;
  input: Record<string, unknown>;
  /** Keys already sent to answer it. */
  tries: number;
  /** Already reported as blocked. */
  blocked: boolean;
}

export type WatchdogStep = { do: 'wait' } | { do: 'keys'; keys: string; note: string } | { do: 'blocked'; reason: string };

/** Claude Code's permission dialog on screen (option 1, "Yes", is the one selected). */
export const permissionScreen = (screen: string) => /Do you want to (proceed|make this edit|create|allow|overwrite)/i.test(screen) && /❯\s*1\.\s*Yes/.test(screen);

/**
 * What the watchdog does about a prompt still on screen: wait a moment for it to draw, then answer it once (Enter on
 * "Yes" for an allowed permission, Esc for a form); a denied permission, or a prompt still there a minute after
 * being answered, leaves the session blocked (reported once).
 */
export function watchdogStep(w: Waiting, now: number, roots: string[]): WatchdogStep {
  if (w.blocked || now - w.since < ANSWER_AFTER_MS) return { do: 'wait' };
  if (w.tries === 0) {
    if (w.kind === 'elicitation') return { do: 'keys', keys: '\x1b', note: "🤖 Auto-answered an MCP server's form in the terminal: dismissed (nobody can fill it in)." };
    const a = permissionAnswer(w.tool, w.input, roots);
    if (a.behavior === 'deny') return { do: 'blocked', reason: a.message };
    return { do: 'keys', keys: '\r', note: `🤖 Auto-answered a permission prompt in the terminal: allowed ${w.tool || 'the tool call'}.` };
  }
  if (now - w.since >= STALL_MS) return { do: 'blocked', reason: w.kind === 'permission' ? "a permission prompt the office couldn't answer" : "an MCP server's form the office couldn't dismiss" };
  return { do: 'wait' };
}

/** A blocked agent the manager should now hear about: blocked NOTIFY_BLOCKED_MS and not told yet. */
export const blockedNotice = (b: { since: number; told: boolean } | null | undefined, now: number) => !!b && !b.told && now - b.since >= NOTIFY_BLOCKED_MS;
