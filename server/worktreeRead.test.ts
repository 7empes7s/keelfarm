import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capText, guardPath, readWorktree, WORKTREE_MAX_CHARS } from './worktreeRead.ts';

describe('guardPath (worktree_file)', () => {
  it('takes paths inside the worktree, with either slash', () => {
    expect(guardPath('src/app.ts')).toBe('src/app.ts');
    expect(guardPath('./src//app.ts')).toBe('src/app.ts');
    expect(guardPath('src\\world\\layout.ts')).toBe('src/world/layout.ts');
    expect(guardPath('src/../README.md')).toBe('README.md');
    expect(guardPath('.env.example')).toBe('.env.example');
  });

  it('refuses anything outside it', () => {
    expect(() => guardPath('../other/secret.txt')).toThrow(/outside the worktree/);
    expect(() => guardPath('src/../../x')).toThrow(/outside the worktree/);
    expect(() => guardPath('..\\..\\x')).toThrow(/outside the worktree/);
    expect(() => guardPath('/etc/passwd')).toThrow(/absolute/);
    expect(() => guardPath('C:\\Users\\me\\x')).toThrow(/absolute/);
    expect(() => guardPath('\\\\server\\share\\x')).toThrow(/absolute/);
    expect(() => guardPath('')).toThrow(/relative to the worktree/);
    expect(() => guardPath('.')).toThrow(/not the worktree itself/);
    expect(() => guardPath('a\0b')).toThrow(/NUL/);
  });

  it('refuses .git and .env files', () => {
    expect(() => guardPath('.git/config')).toThrow(/\.git/);
    expect(() => guardPath('sub/.GIT/HEAD')).toThrow(/\.git/);
    expect(() => guardPath('.env')).toThrow(/secrets/);
    expect(() => guardPath('server/.env.local')).toThrow(/secrets/);
  });

  it('caps what it returns', () => {
    expect(capText('x'.repeat(WORKTREE_MAX_CHARS + 10))).toMatch(/cut at 20000 characters of 20010\)$/);
    expect(capText('short')).toBe('short');
  });
});

describe('readWorktree: files on disk', () => {
  let root: string;
  let outside: string;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-out-'));
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    await fs.writeFile(path.join(root, 'bin.dat'), Buffer.from([1, 0, 2]));
    await fs.writeFile(path.join(outside, 'secret.txt'), 'nope');
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt')).catch(() => undefined); // Windows may refuse symlinks
  });
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
    await fs.rm(outside, { recursive: true, force: true, maxRetries: 3 });
  });
  const read = (p: string) => readWorktree({ dir: root, ref: null, base: 'origin/main', mode: 'file', path: p });

  it('reads a file inside it', async () => {
    expect(await read('src/a.ts')).toBe('export const a = 1;\n');
  });

  it('refuses folders, binaries, missing files and links out of it', async () => {
    await expect(read('src')).rejects.toThrow(/folder/);
    await expect(read('bin.dat')).rejects.toThrow(/binary/);
    await expect(read('nope.ts')).rejects.toThrow(/no nope\.ts/);
    const linked = await fs.lstat(path.join(root, 'link.txt')).then(() => true, () => false);
    if (linked) await expect(read('link.txt')).rejects.toThrow(/outside the worktree/);
  });
});
