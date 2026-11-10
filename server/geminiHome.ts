// Gemini CLI's login folders (#365): what one needs so a session or sign-in never stops on a setup screen. Only the
// office's own login folders (accounts under <SWARM_HOME>/accounts) are prepared, never the manager's ~/.gemini.
// Gemini CLI keeps its files in <GEMINI_CLI_HOME>/.gemini; folder trust is per session (--skip-trust, clis.ts).
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

/** Prepares a login folder (GEMINI_CLI_HOME) before a session or sign-in; written to a temp file and renamed. */
export function prepareGeminiHome(home: string): void {
  const dir = path.join(home, '.gemini');
  const file = path.join(dir, 'settings.json');
  fs.mkdirSync(dir, { recursive: true });
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    // a new folder
  }
  const next = geminiLoginSettings(raw);
  if (next === null) return;
  fs.writeFileSync(`${file}.tmp`, next);
  fs.renameSync(`${file}.tmp`, file);
}
