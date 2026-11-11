// Every session starts ready to work (#360): an account's login folder is set up before its CLI starts, the way a cloud
// agent's Box is (boxHelpers.ts seed-claude.cjs, which applies the same seed): Claude Code's onboarding done, a theme,
// the worktree trusted; Codex's worktree trusted in its config.toml. Every key already there is kept, and the file is
// written atomically (several sessions share it). The pure parts first, then the reads and writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareGeminiHome } from './geminiHome.ts';

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
