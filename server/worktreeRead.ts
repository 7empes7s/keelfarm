import fs from 'node:fs/promises';
import path from 'node:path';
import { git } from './exec.ts';

// The CEO's worktree_file tool (#27): read a file, or the diff against the default branch, from an agent's worktree,
// or from their branch in the floor's clone once the worktree is gone. Read-only, path-guarded, size-capped.

export const WORKTREE_MAX_CHARS = 20_000;
/** Files bigger than this aren't read at all. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

type WorktreeMode = 'file' | 'diff_stat' | 'diff';

export interface WorktreeRead {
  dir: string; // the agent's worktree, or the floor's clone when reading `ref`
  ref: string | null; // null: the worktree as it is on disk; else a branch ref in `dir`, e.g. "origin/swarm/issue-3-ada"
  base: string; // what diffs compare against, e.g. "origin/main"
  mode: WorktreeMode;
  path?: string; // file mode: the file; diff modes: limit the diff to it
}

/**
 * `rel` as a path inside the worktree (forward slashes), or an error the CEO can act on: no absolute paths, nothing
 * outside it, nothing under .git and no .env files (secrets).
 */
export function guardPath(rel: string): string {
  const raw = String(rel ?? '').trim();
  if (!raw) throw new Error('Give a path relative to the worktree, e.g. "src/app.ts".');
  if (raw.includes('\0')) throw new Error('That path has a NUL character in it.');
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw) || /^[a-z]:/i.test(raw)) throw new Error(`"${raw}" is absolute. Give a path relative to the worktree, e.g. "src/app.ts".`);
  const norm = path.posix.normalize(raw.replace(/\\/g, '/'));
  const parts = norm.split('/').filter((p) => p && p !== '.');
  if (!parts.length) throw new Error('Give a file inside the worktree, not the worktree itself.');
  if (parts[0] === '..') throw new Error(`"${raw}" is outside the worktree: only files inside it can be read.`);
  if (parts.some((p) => p.toLowerCase() === '.git')) throw new Error("Files under .git can't be read.");
  if (parts.some((p) => /^\.env(\..*)?$/i.test(p) && !/\.(example|sample|template)$/i.test(p))) throw new Error(".env files can't be read: they hold secrets.");
  return parts.join('/');
}

/** Cut to `max` characters, saying so. */
export function capText(text: string, max = WORKTREE_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}\n… (cut at ${max} characters of ${text.length})` : text;
}

/** What worktree_file returns (see WorktreeRead). Throws with a message the CEO can act on. */
export async function readWorktree(r: WorktreeRead): Promise<string> {
  const rel = r.mode === 'file' || r.path ? guardPath(r.path ?? '') : null;
  const opts = { cwd: r.dir, timeoutMs: 30_000 };
  if (r.mode === 'file') {
    if (r.ref) return capText(await git(['show', `${r.ref}:${rel}`], opts).catch(() => Promise.reject(new Error(`${rel} isn't on ${r.ref}.`))));
    const root = await fs.realpath(r.dir).catch(() => null);
    if (!root) throw new Error('That worktree is gone.');
    const file = await fs.realpath(path.join(root, rel!)).catch(() => null);
    if (!file) throw new Error(`There is no ${rel} in the worktree.`);
    const inside = path.relative(root, file);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error(`${rel} links outside the worktree, so it can't be read.`);
    const stat = await fs.stat(file);
    if (stat.isDirectory()) throw new Error(`${rel} is a folder. Use diff_stat to see what changed, or Glob the clone.`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`${rel} is ${Math.round(stat.size / 1024)} KB, too big to read here.`);
    const data = await fs.readFile(file);
    if (data.subarray(0, 8000).includes(0)) throw new Error(`${rel} is a binary file.`);
    return capText(data.toString('utf8'));
  }
  const only = rel ? ['--', rel] : [];
  const flags = r.mode === 'diff_stat' ? ['--stat=160'] : [];
  if (r.ref) return capText((await git(['diff', ...flags, `${r.base}...${r.ref}`, ...only], opts)) || 'No changes against the default branch.');
  // The worktree: everything since it left the default branch, committed or not, plus files git doesn't track yet.
  const from = (await git(['merge-base', r.base, 'HEAD'], opts)).trim();
  const diff = await git(['diff', ...flags, from, ...only], opts);
  const untracked = r.mode === 'diff_stat' ? (await git(['ls-files', '--others', '--exclude-standard', ...only], opts)).trim() : '';
  const out = [diff.trim(), untracked ? `Untracked:\n${untracked}` : ''].filter(Boolean).join('\n\n');
  return capText(out || 'No changes against the default branch.');
}
