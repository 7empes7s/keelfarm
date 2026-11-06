// Windows and macOS file systems ignore case: two modules whose names differ only in case (ConsoleNav.tsx and
// consoleNav.ts) resolve to one file there, so imports break on the Windows runner while Linux passes.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIRS = ['client', 'server', 'shared', 'scripts', 'e2e', 'bin'];

/** Pairs of modules in one folder whose import names (without the extension) differ only in case. */
function caseClashes(dir: string, out: string[] = []): string[] {
  const seen = new Map<string, string>();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    if (e.isDirectory()) caseClashes(path.join(dir, e.name), out);
    // only modules imported without their extension (a stylesheet's import names it)
    if (!/\.(ts|tsx|js|mjs)$/.test(e.name)) continue;
    const stem = e.name.replace(/\.[^.]+$/, '');
    const prev = seen.get(stem.toLowerCase());
    if (prev !== undefined && prev !== stem) out.push(`${path.relative(ROOT, dir)}: ${prev} / ${stem}`);
    seen.set(stem.toLowerCase(), stem);
  }
  return out;
}

describe('file names', () => {
  it('has no two modules in a folder whose names differ only in case', () => {
    expect(DIRS.flatMap((d) => caseClashes(path.join(ROOT, d)))).toEqual([]);
  });
});
