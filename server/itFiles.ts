// The files a runbook job (#611, server/itRunbook.ts) reads and writes: on this machine through node:fs (writes atomic,
// backups' folders mode 700), or in memory for the demo and the tests. A secret written here never goes through argv.
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ItExecResult } from './itExec.ts';
import type { RunbookHost } from './itRunbook.ts';

export type RunbookFiles = Omit<RunbookHost, 'exec'>;

const missing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT';

export const machineFiles: RunbookFiles = {
  read: (p) => readFile(p, 'utf8').catch((err) => (missing(err) ? null : Promise.reject(err))),
  async write(p, data, mode) {
    await mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.cubefarm-${process.pid}.tmp`;
    await writeFile(tmp, data, { mode });
    await chmod(tmp, mode); // the umask may have taken bits off
    await rename(tmp, p);
  },
  async copy(from, to) {
    await mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
    await copyFile(from, to); // keeps the mode
  },
  remove: (p) => rm(p, { recursive: true, force: true, maxRetries: 3 }),
  exists: (p) => stat(p).then(() => true, () => false),
};

/** An in-memory machine: files by path with their mode; folders are whatever holds a file, plus `dirs`. */
export function memoryFiles(seed: Record<string, string> = {}, dirs: string[] = ['/opt', '/etc', '/etc/systemd/system', '/etc/caddy', '/var/backups']) {
  const files = new Map<string, { data: string; mode: number }>(Object.entries(seed).map(([p, data]) => [p, { data, mode: 0o644 }]));
  const folders = new Set(dirs);
  const parents = (p: string) => {
    for (let d = path.posix.dirname(p); d !== '/'; d = path.posix.dirname(d)) folders.add(d);
  };
  for (const p of files.keys()) parents(p);
  const api: RunbookFiles & { files: typeof files; mkdir(p: string): void } = {
    files,
    mkdir: (p) => {
      folders.add(p);
      parents(p);
    },
    read: async (p) => files.get(p)?.data ?? null,
    async write(p, data, mode) {
      parents(p);
      files.set(p, { data, mode });
    },
    async copy(from, to) {
      const f = files.get(from);
      if (!f) throw new Error(`${from}: no such file`);
      parents(to);
      files.set(to, { ...f });
    },
    async remove(p) {
      files.delete(p);
      folders.delete(p);
      for (const k of files.keys()) if (k.startsWith(`${p}/`)) files.delete(k);
      for (const k of folders) if (k.startsWith(`${p}/`)) folders.delete(k);
    },
    exists: async (p) => p === '/' || files.has(p) || folders.has(p),
  };
  return api;
}

/** A pretend shell over memoryFiles: mkdir, install/cp, git clone and touch change the files; everything else says ok, or what `answer` says. */
export function memoryExec(m: ReturnType<typeof memoryFiles>, answer: (argv: string[]) => ItExecResult | null = () => null): RunbookHost['exec'] {
  return async (argv) => {
    const said = answer(argv);
    if (said) return said;
    const plain = argv.slice(1).filter((a, i, all) => !a.startsWith('-') && !['-m', '-o', '-g'].includes(all[i - 1]));
    if (argv[0] === 'mkdir' || (argv[0] === 'install' && argv.includes('-d'))) plain.forEach(m.mkdir);
    else if (argv[0] === 'install' || argv[0] === 'cp') {
      if (!m.files.has(plain[0])) return { code: 1, out: '', err: `${argv[0]}: cannot stat '${plain[0]}': No such file or directory` };
      await m.copy(plain[0], plain[1]);
    } else if (argv[0] === 'git' && plain[0] === 'clone') m.mkdir(plain[2]);
    else if (argv[0] === 'touch') for (const p of plain) await m.write(p, '', 0o644);
    return { code: 0, out: '', err: '' };
  };
}
