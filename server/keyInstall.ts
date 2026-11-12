// install_key's file write (#609): `VAR=value` set in a service env file on the allow-list (shared/keyInstall.ts),
// every other line kept, owner-only, one temp-and-rename write, with the file before it kept next to it (named like an
// env file, so the IT desk's never-list covers it too) for the Undo. The value goes into the file and nowhere else.
import fs from 'node:fs/promises';
import path from 'node:path';
import { put } from './cfSecretFile.ts';
import { envWithVar } from '../shared/keyInstall.ts';

/** Backups kept per file. */
const BACKUPS_KEPT = 5;

const read = (file: string) => fs.readFile(file, 'utf8').catch(() => null);

/** Where a file's backup goes: clipfarm.env → clipfarm.<stamp>.bak.env, .env → .<stamp>.bak.env. */
const backupPath = (file: string, stamp: string) => path.join(path.dirname(file), `${path.basename(file).replace(/\.env$/, '')}.${stamp}.bak.env`);

/** Writes the line; returns the backup (null when there was no file before). */
export async function installKeyFile(file: string, name: string, value: string, stamp: string): Promise<{ backup: string | null }> {
  const before = await read(file);
  let backup: string | null = null;
  if (before !== null) {
    backup = backupPath(file, stamp);
    await put(backup, before);
    await pruneBackups(file);
  }
  await put(file, envWithVar(before ?? '', name, value));
  return { backup };
}

/** The Undo: the file as it was (removed when it didn't exist). */
export async function restoreKeyFile(file: string, backup: string | null): Promise<void> {
  if (!backup) return fs.rm(file, { force: true });
  const text = await read(backup);
  if (text === null) throw new Error(`The backup ${backup} is gone.`);
  await put(file, text);
}

async function pruneBackups(file: string) {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file).replace(/\.env$/, '')}.`;
  const mine = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.startsWith(prefix) && f.endsWith('.bak.env')).sort();
  for (const f of mine.slice(0, -BACKUPS_KEPT)) await fs.rm(path.join(dir, f), { force: true });
}
