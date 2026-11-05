import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkoutFile, entryProblem, parseTreeEntry, REF_FILE_MAX_BYTES } from './repoFile.ts';

describe('the file ref guard', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'reffile-'));
  const root = path.join(base, 'repo');
  const outside = path.join(base, 'secret.txt');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a b.ts'), 'x');
  fs.writeFileSync(outside, 'secret');
  // Links need rights Windows runners may not have: those cases are skipped there.
  const linked = (() => {
    try {
      fs.symlinkSync(outside, path.join(root, 'link.txt'));
      fs.symlinkSync(base, path.join(root, 'up'), 'junction');
      return true;
    } catch {
      return false;
    }
  })();
  afterAll(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 }));

  it('finds plain files inside the checkout, spaces and backslashes included', () => {
    expect(checkoutFile(root, 'src/a b.ts')).toBe(path.join(root, 'src', 'a b.ts'));
    expect(checkoutFile(root, 'src\\a b.ts')).toBe(path.join(root, 'src', 'a b.ts'));
  });

  it('refuses traversal, absolute paths, folders, missing files and .git', () => {
    for (const rel of ['../secret.txt', 'src/../../secret.txt', outside, 'src', 'nope.ts', '.git/config', '']) expect(checkoutFile(root, rel)).toBeNull();
  });

  it.runIf(linked)('refuses links, and files reached through a linked folder', () => {
    expect(checkoutFile(root, 'link.txt')).toBeNull();
    expect(checkoutFile(root, 'up/secret.txt')).toBeNull();
  });

  it('shows only regular files on the branch, up to the size cap', () => {
    const e = (line: string) => entryProblem('f', parseTreeEntry(line));
    expect(e('100644 blob 3b18e5 1200\tf')).toBeNull();
    expect(e('100755 blob 3b18e5 12\tf')).toBeNull();
    expect(e('120000 blob 3b18e5 12\tf')).toMatch(/link/);
    expect(e('040000 tree 3b18e5 -\tf')).toMatch(/isn't a file/);
    expect(e('160000 commit 3b18e5 -\tf')).toMatch(/isn't a file/);
    expect(e(`100644 blob 3b18e5 ${REF_FILE_MAX_BYTES + 1}\tf`)).toMatch(/too big/);
    expect(e('')).toMatch(/isn't on the default branch/);
  });
});
