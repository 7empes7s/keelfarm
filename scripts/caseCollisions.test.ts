// No two tracked files may differ only in case: Windows (and macOS) resolve './chatCards' to whichever comes first,
// so imports break there while Linux CI stays green.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('tracked file names', () => {
  it('never differ only in case', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    // Compare without extensions too: a bare import picks Foo.tsx or foo.ts by case alone.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const file of files) {
      const key = file.replace(/\.(tsx?|mjs|js)$/, '').toLowerCase();
      const other = seen.get(key);
      if (other !== undefined && other !== file) clashes.push(`${other} / ${file}`);
      else seen.set(key, file);
    }
    expect(clashes).toEqual([]);
  });
});
