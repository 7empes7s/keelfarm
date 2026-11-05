import fs from 'node:fs';
import path from 'node:path';
import { git } from './exec.ts';
import { guardPath } from './worktreeRead.ts';

// File refs in the phone chat (#26, shared/chatRefs.ts): whether a floor's main checkout has the file, and its text
// from the default branch's head for the chip's preview and the read-only viewer. Plain files only, size-capped.

/** Files bigger than this aren't shown in the office (the viewer links to GitHub instead). */
export const REF_FILE_MAX_BYTES = 256 * 1024;

/** A `git ls-tree -l` line: "<mode> <type> <sha> <size>\t<path>". */
export interface TreeEntry {
  mode: string;
  type: string;
  size: number;
}

export function parseTreeEntry(line: string): TreeEntry | null {
  const m = line.match(/^(\d+) (\w+) [0-9a-f]+ +(\d+|-)\t/);
  return m ? { mode: m[1], type: m[2], size: m[3] === '-' ? 0 : Number(m[3]) } : null;
}

/** Why the entry can't be shown, or null: only regular files (no links, folders or submodules) up to the cap. */
export function entryProblem(rel: string, e: TreeEntry | null, max = REF_FILE_MAX_BYTES): string | null {
  if (!e) return `${rel} isn't on the default branch.`;
  if (e.mode === '120000') return `${rel} is a link, so it isn't shown here.`;
  if (e.type !== 'blob') return `${rel} isn't a file.`;
  if (e.size > max) return `${rel} is ${Math.round(e.size / 1024)} KB, too big to show here.`;
  return null;
}

/** The path inside `root`, or null when it isn't a plain file there (missing, a folder, a link, or reaching out). */
export function checkoutFile(root: string, rel: string): string | null {
  let clean: string;
  try {
    clean = guardPath(rel);
  } catch {
    return null;
  }
  try {
    const file = path.join(root, clean);
    if (!fs.lstatSync(file).isFile()) return null;
    // A linked folder on the way could still lead out.
    const inside = path.relative(fs.realpathSync(root), fs.realpathSync(file));
    return inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? file : null;
  } catch {
    return null;
  }
}

/** The file's text on `ref` (e.g. "origin/main") in the checkout `dir`. Throws with a message for the viewer. */
export async function readRepoFile(dir: string, ref: string, rel: string): Promise<string> {
  const clean = guardPath(rel);
  const opts = { cwd: dir, timeoutMs: 15_000 };
  const entry = parseTreeEntry((await git(['ls-tree', '-l', ref, '--', clean], opts).catch(() => '')).split('\n')[0] ?? '');
  const why = entryProblem(clean, entry);
  if (why) throw new Error(why);
  const text = await git(['show', `${ref}:${clean}`], opts);
  if (text.slice(0, 8000).includes('\0')) throw new Error(`${clean} is a binary file.`);
  return text;
}
