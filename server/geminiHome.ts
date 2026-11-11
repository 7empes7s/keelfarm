// Gemini CLI's login folders (#365): what one needs so a session or sign-in never stops on a setup screen, the way
// cliSetup.ts does Claude Code's and Codex's (#360). Only the office's own login folders (accounts under
// <SWARM_HOME>/accounts) are prepared, never the manager's ~/.gemini. Gemini CLI keeps its files in
// <GEMINI_CLI_HOME>/.gemini; its sessions also pass --skip-trust (clis.ts).
import fs from 'node:fs';
import path from 'node:path';

type Json = Record<string, unknown>;

/** What a login folder starts with: the Google sign-in picked (no "How would you like to authenticate?"), no auto-update. */
const FIRST_RUN: Json = { security: { auth: { selectedType: 'oauth-personal' } }, general: { enableAutoUpdate: false, enableAutoUpdateNotification: false } };

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** `base` with what `add` has and it lacks; what it already says wins. */
function fill(base: Json, add: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(add)) out[k] = out[k] === undefined ? v : isObject(out[k]) && isObject(v) ? fill(out[k], v) : out[k];
  return out;
}

/** A login folder's settings.json with what's missing filled in, keeping every key there; null: leave it (it's complete, or not plain JSON). */
export function geminiLoginSettings(raw: string): string | null {
  let cur: Json = {};
  if (raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isObject(parsed)) return null;
      cur = parsed;
    } catch {
      return null; // comments or a typo: the manager's to fix, not the office's to overwrite
    }
  }
  const next = fill(cur, FIRST_RUN);
  return raw.trim() && JSON.stringify(next) === JSON.stringify(cur) ? null : JSON.stringify(next, null, 2);
}

/** A login folder's trustedFolders.json with each worktree trusted, keeping every folder there; null: nothing to change, or not plain JSON. */
export function geminiTrusted(raw: string, dirs: readonly string[]): string | null {
  let cur: Json = {};
  try {
    const parsed: unknown = raw.trim() ? JSON.parse(raw) : {};
    if (!isObject(parsed)) return null;
    cur = parsed;
  } catch {
    return null;
  }
  const missing = dirs.filter((d) => cur[d] !== 'TRUST_FOLDER');
  return missing.length ? JSON.stringify({ ...cur, ...Object.fromEntries(missing.map((d) => [d, 'TRUST_FOLDER'])) }, null, 2) : null;
}

const read = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return ''; // a new folder
  }
};

/**
 * Prepares a login folder (GEMINI_CLI_HOME) before a session or sign-in: its settings, and `dirs` (the session's
 * worktree) trusted. Written to a temp file and renamed: several sessions share it. Returns whether it changed.
 */
export function prepareGeminiHome(home: string, dirs: readonly string[] = []): boolean {
  const dir = path.join(home, '.gemini');
  fs.mkdirSync(dir, { recursive: true });
  let changed = false;
  for (const [name, next] of [
    ['settings.json', (raw: string) => geminiLoginSettings(raw)],
    ['trustedFolders.json', (raw: string) => geminiTrusted(raw, dirs)],
  ] as const) {
    const file = path.join(dir, name);
    const text = next(read(file));
    if (text === null) continue;
    fs.writeFileSync(`${file}.${process.pid}.tmp`, text);
    fs.renameSync(`${file}.${process.pid}.tmp`, file);
    changed = true;
  }
  return changed;
}
