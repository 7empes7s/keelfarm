// Windows and macOS file systems ignore case: two source files whose paths differ only in case (ConsoleNav.tsx next
// to consoleNav.ts) resolve to one there and break the Windows build.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIRS = ['bin', 'client', 'e2e', 'scripts', 'server', 'shared'];

function walk(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(path.relative(ROOT, full));
  }
}

describe('source file names', () => {
  it('never differ only in case, ignoring the extension', () => {
    const files: string[] = [];
    for (const dir of DIRS) if (fs.existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir), files);
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const file of files) {
      const key = file.replace(/\.(tsx?|mjs|js)$/, '').toLowerCase(); // './ui/ConsoleNav' resolves to either extension
      const other = seen.get(key);
      if (other) clashes.push(`${other} / ${file}`);
      else seen.set(key, file);
    }
    expect(clashes).toEqual([]);
  });
});
