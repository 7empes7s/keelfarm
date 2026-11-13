// Every session starts ready to work (#360): an account's login folder is set up before its CLI starts, the way a cloud
// agent's Box is (boxHelpers.ts seed-claude.cjs, which applies the same seed): Claude Code's onboarding done, a theme,
// the worktree trusted; Codex's worktree trusted in its config.toml, and the office's own session hooks too (#638).
// Every key already there is kept, and the file is written atomically (several sessions share it). The pure parts
// first, then the reads and writes.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareGeminiHome } from './geminiHome.ts';
import { builtInDir } from '../shared/accounts.ts';

/** What a Claude Code config gets: keys set, keys only filled in when missing, and per-project flags. */
export interface ClaudeSeed {
  set: Record<string, unknown>;
  defaults: Record<string, unknown>;
  projects: Record<string, Record<string, unknown>>;
}

/** Preferences copied from the built-in login into a new account's config (never its secrets or oauthAccount). */
const COPIED_PREFS = ['theme', 'editorMode', 'preferredNotifChannel'] as const;

/**
 * The seed for a Claude Code config: onboarding done on `version` (the CLI the office runs), a theme (the built-in
 * login's, else dark), and each worktree trusted with its project onboarding done.
 */
export function claudeSeed(dirs: readonly string[], version: string | null, prefs: Record<string, unknown> = {}): ClaudeSeed {
  const defaults: Record<string, unknown> = { theme: 'dark' };
  for (const k of COPIED_PREFS) if (prefs[k] !== undefined) defaults[k] = prefs[k];
  return {
    set: { hasCompletedOnboarding: true, ...(version ? { lastOnboardingVersion: version } : {}) },
    defaults,
    projects: Object.fromEntries(dirs.map((d) => [d, { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }])),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A config with the seed merged in: every key already there kept (a default never overrides it). Idempotent. */
export function mergeClaudeConfig(config: unknown, seed: ClaudeSeed): Record<string, unknown> {
  const c: Record<string, unknown> = isObject(config) ? { ...config } : {};
  for (const [k, v] of Object.entries(seed.defaults)) if (c[k] === undefined) c[k] = v;
  Object.assign(c, seed.set);
  const projects: Record<string, unknown> = isObject(c.projects) ? { ...c.projects } : {};
  for (const [dir, flags] of Object.entries(seed.projects)) projects[dir] = { ...(isObject(projects[dir]) ? projects[dir] : {}), ...flags };
  c.projects = projects;
  return c;
}

/** A TOML basic string (JSON's escapes are TOML's). */
const tomlString = (s: string) => JSON.stringify(s);

/**
 * Codex's config.toml with each worktree trusted (`[projects."<dir>"]` `trust_level = "trusted"`): a table that's there
 * gets its trust_level set, a missing one is added at the end; every other line stays as it was.
 */
export function trustCodexToml(text: string, dirs: readonly string[]): string {
  let out = text;
  for (const dir of dirs) {
    const header = `[projects.${tomlString(dir)}]`;
    const lines = out.split(/\r?\n/);
    const at = lines.findIndex((l) => l.trim() === header);
    if (at < 0) {
      out = `${out}${out && !out.endsWith('\n') ? '\n' : ''}${out ? '\n' : ''}${header}\ntrust_level = "trusted"\n`;
      continue;
    }
    let end = lines.findIndex((l, i) => i > at && /^\s*\[/.test(l));
    if (end < 0) end = lines.length;
    const own = lines.findIndex((l, i) => i > at && i < end && /^\s*trust_level\s*=/.test(l));
    if (own >= 0) lines[own] = 'trust_level = "trusted"';
    else lines.splice(at + 1, 0, 'trust_level = "trusted"');
    out = lines.join('\n');
  }
  return out;
}

// ---------- Codex's trust for the office's own hooks (#638) ----------
// Codex (0.166, codex-rs/hooks) runs a hook only once its trust is in config.toml: `[hooks.state."<key>"]`
// `trusted_hash`. The key is the hook's source (`-c` hooks: the synthetic "/<session-flags>/config.toml"), its event and
// its place; the hash is sha256 over the hook's normalized declaration as sorted JSON. The office trusts exactly the
// hooks it launches with, under a mark of its own, renews only what it marked, and leaves every other hook to /hooks.

/** Codex's event names in its hook-state keys. */
const CODEX_EVENT_KEYS: Record<string, string> = { SessionStart: 'session_start', SessionEnd: 'session_end', UserPromptSubmit: 'user_prompt_submit', PreToolUse: 'pre_tool_use', PostToolUse: 'post_tool_use', Stop: 'stop', Interrupt: 'interrupt' };

/** The comment over a hook's trust that the office wrote: only those it renews when its hook command changes. */
export const CODEX_OFFICE_MARK = "# cubefarm: the office's own session hook (#638)";

/** One of the office's Codex hooks as its trust: Codex's key for it and the hash it must have. */
export interface OfficeHook {
  key: string;
  hash: string;
}

/** JSON with every object's keys sorted (serde_json's sort_all_objects). */
const sortedJson = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortedJson) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedJson(v[k])])) : v;

/**
 * The trust Codex needs for the office's hooks: `command` on each of `events` given as `-c hooks.<event>=[{hooks=[{type=
 * "command",command=…,timeout=…}]}]`, one group and handler each. Codex clamps SessionEnd's and Interrupt's timeout to 1-3 s.
 */
export function codexHookTrust(command: string, events: readonly string[], timeout: number, win = process.platform === 'win32'): OfficeHook[] {
  const source = win ? 'C:\\<session-flags>\\config.toml' : '/<session-flags>/config.toml';
  return events.flatMap((e) => {
    const event = CODEX_EVENT_KEYS[e];
    if (!event) return [];
    const t = event === 'session_end' || event === 'interrupt' ? Math.min(Math.max(timeout, 1), 3) : Math.max(timeout, 1);
    const identity = { event_name: event, hooks: [{ type: 'command', command, timeout: t, async: false }] };
    return [{ key: `${source}:${event}:0:0`, hash: `sha256:${createHash('sha256').update(JSON.stringify(sortedJson(identity))).digest('hex')}` }];
  });
}

/** A TOML line's table header ("hooks.state", for `[hooks.state."k"]`'s prefix) or null; and its bare key. */
const tableOf = (line: string) => /^\s*\[\[?\s*([^\]]*?)\s*\]\]?\s*(#.*)?$/.exec(line)?.[1] ?? null;
const keyOf = (line: string) => /^\s*([A-Za-z0-9_-]+)\s*[.=]/.exec(line)?.[1] ?? null;

/** Whether `hooks.state` is written anywhere other than as `[hooks.state."<key>"]` tables: then the office won't edit it. */
function oddHookState(lines: readonly string[]): boolean {
  let table = '';
  for (const l of lines) {
    const t = tableOf(l);
    if (t !== null) {
      table = t;
      if (t === 'hooks.state') return true;
      continue;
    }
    const k = keyOf(l);
    if ((table === '' && k === 'hooks') || (table === 'hooks' && k === 'state')) return true;
  }
  return false;
}

/**
 * config.toml with each office hook trusted: a missing one added under the office's mark; one the office marked
 * renewed to the current hash; one with someone else's hash left alone and listed in `foreign` (the manager's to
 * review). Every other line stays as it was. null: hooks.state is written in a shape this can't edit safely.
 */
export function trustCodexHooksToml(text: string, hooks: readonly OfficeHook[]): { text: string; foreign: string[] } | null {
  if (oddHookState(text.split(/\r?\n/))) return null;
  let out = text;
  const foreign: string[] = [];
  for (const { key, hash } of hooks) {
    const header = `[hooks.state.${tomlString(key)}]`;
    const lines = out.split(/\r?\n/);
    const at = lines.findIndex((l) => l.trim() === header || l.trim() === `[hooks.state.'${key}']`);
    const line = `trusted_hash = ${tomlString(hash)}`;
    if (at < 0) {
      out = `${out}${out && !out.endsWith('\n') ? '\n' : ''}${out ? '\n' : ''}${CODEX_OFFICE_MARK}\n${header}\n${line}\n`;
      continue;
    }
    let end = lines.findIndex((l, i) => i > at && tableOf(l) !== null);
    if (end < 0) end = lines.length;
    const own = lines.findIndex((l, i) => i > at && i < end && keyOf(l) === 'trusted_hash');
    const current = own >= 0 ? /=\s*["']([^"']*)["']/.exec(lines[own])?.[1] : undefined;
    if (current === hash) continue;
    const marked = lines[at - 1]?.trim() === CODEX_OFFICE_MARK;
    if (own >= 0 && !marked) {
      foreign.push(key);
      continue;
    }
    if (own >= 0) lines[own] = line;
    else lines.splice(at + 1, 0, line);
    if (!marked) lines.splice(at, 0, CODEX_OFFICE_MARK);
    out = lines.join('\n');
  }
  return { text: out, foreign };
}

// ---------- on disk ----------

/** Claude Code's config file for a login folder: <dir>/.claude.json (as CLAUDE_CONFIG_DIR has it). */
const claudeConfigFile = (dir: string) => path.join(dir, '.claude.json');

/** Writes a file through a temp file and a rename, so a CLI reading it never sees half of it. */
function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** The built-in Claude login's config: ~/.claude.json, or .claude.json in CLAUDE_CONFIG_DIR. Only ever read. */
const builtInClaudeConfig = (env: NodeJS.ProcessEnv = process.env, home = os.homedir()) => (env.CLAUDE_CONFIG_DIR?.trim() ? claudeConfigFile(env.CLAUDE_CONFIG_DIR.trim()) : path.join(home, '.claude.json'));

/** The built-in Claude login's preferences worth copying into a new account (read only). */
export function builtInPrefs(file = builtInClaudeConfig()): Record<string, unknown> {
  const c = readJson(file);
  return isObject(c) ? Object.fromEntries(COPIED_PREFS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]])) : {};
}

/**
 * Sets up an account's own login folder before a session (or its sign-in) starts there. `dirs`: the worktrees the
 * session trusts. A config that isn't JSON is left alone (the CLI would rewrite it anyway). Returns whether it changed.
 */
export function prepareLogin(cli: 'claude' | 'codex' | 'gemini', dir: string, dirs: readonly string[], opts: { version?: string | null; prefs?: Record<string, unknown> } = {}): boolean {
  if (cli === 'gemini') return prepareGeminiHome(dir, dirs); // #365
  if (cli === 'codex') {
    if (!dirs.length) return false;
    const file = path.join(dir, 'config.toml');
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {}
    const next = trustCodexToml(text, dirs);
    if (next === text) return false;
    writeAtomic(file, next);
    return true;
  }
  const file = claudeConfigFile(dir);
  const exists = fs.existsSync(file);
  const before = exists ? readJson(file) : {};
  if (exists && !isObject(before)) return false;
  const next = mergeClaudeConfig(before, claudeSeed(dirs, opts.version ?? null, opts.prefs));
  if (exists && JSON.stringify(next) === JSON.stringify(before)) return false;
  writeAtomic(file, JSON.stringify(next, null, 2));
  return true;
}

/** What readying a Codex home did: changed the file; the office's hooks all trusted, else why not. */
export interface CodexPrep {
  changed: boolean;
  hooksTrusted: boolean;
  problem: string | null;
}

/** Blocks this thread for `ms` (no busy loop): config writes are synchronous, and a lock waits a moment at most. */
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs `step` holding `<file>.cubefarm-lock`, so office processes readying one home don't lose each other's writes. */
function withLock<T>(file: string, step: () => T): T {
  const lock = `${file}.cubefarm-lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; ; i++) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > 10_000 || i >= 200) fs.rmSync(lock, { force: true }); // left by a process that died, or held far too long
      else pause(10);
    }
  }
  try {
    return step();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/**
 * Readies a Codex home for one office session before its CLI starts (#638): its worktrees trusted (as given and as
 * their real paths, which Codex looks up first) and the office's own hooks (`hooks`, from codexHookTrust) trusted.
 * Idempotent; written under a lock, through a rename, and read back, so a write that lost a race is made again.
 */
export function prepareCodexSession(home: string, dirs: readonly string[], hooks: readonly OfficeHook[]): CodexPrep {
  const file = path.join(home, 'config.toml');
  const real = dirs.flatMap((d) => {
    try {
      const r = fs.realpathSync.native(d);
      return r === d ? [d] : [d, r];
    } catch {
      return [d];
    }
  });
  return withLock(file, () => {
    let changed = false;
    for (let attempt = 0; ; attempt++) {
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {}
      const trusted = trustCodexToml(text, real);
      const r = trustCodexHooksToml(trusted, hooks);
      const next = r?.text ?? trusted;
      const prep = (): CodexPrep => ({
        changed,
        hooksTrusted: !!r && !r.foreign.length,
        problem: !r ? `its hooks state in ${file} isn't in [hooks.state."…"] tables` : r.foreign.length ? `${file} has other trust for ${r.foreign.map((k) => k.split(':').slice(-3, -2)[0]).join(', ')}` : null,
      });
      if (next === text) return prep();
      if (attempt >= 3) return { ...prep(), hooksTrusted: false, problem: `${file} keeps changing under the office` };
      writeAtomic(file, next);
      changed = true;
    }
  });
}

/**
 * Before a Codex session starts on this computer (every role, fresh or resumed, any login): its home readied for its
 * worktree and the office's hooks (`hooks`: Launch.codexHooks). The line for the agent's log when something changed or
 * the office's hooks can't be trusted: then a hooks review on screen is left to the manager, never skipped.
 */
export function readyCodexSession(hooks: readonly OfficeHook[] | undefined, env: Record<string, string | undefined>, cwd: string, label: string): { officeHooksTrusted: boolean; line: { kind: 'system' | 'error'; text: string } | null } {
  if (!hooks) return { officeHooksTrusted: false, line: null };
  const home = builtInDir(path.join, 'codex', env, os.homedir()); // an account's CODEX_HOME is in env too
  try {
    const r = prepareCodexSession(home, [cwd], hooks);
    if (r.hooksTrusted) return { officeHooksTrusted: true, line: r.changed ? { kind: 'system', text: `✓ ${label}'s Codex is ready: this worktree and the office's ${hooks.length} hooks trusted in ${path.join(home, 'config.toml')}.` } : null };
    return { officeHooksTrusted: false, line: { kind: 'error', text: `⚠ The office couldn't trust its own Codex hooks for ${label}: ${r.problem}. If Codex asks to review hooks, open their terminal, type /hooks and trust the cubefarm ones.` } };
  } catch (err) {
    return { officeHooksTrusted: false, line: { kind: 'error', text: `⚠ The office couldn't trust its own Codex hooks for ${label}: ${(err as Error).message}. If Codex asks to review hooks, open their terminal, type /hooks and trust the cubefarm ones.` } };
  }
}
