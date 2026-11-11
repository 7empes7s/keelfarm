// Keys found on this computer (#367): the server reads the API keys the shut-down Mulinux projects left behind, never
// an agent's session or a worktree. An archive's env and JSON files are extracted (tar + zstd, argument arrays) into an
// owner-only temp folder, read, and the folder deleted whatever happens; the live files are read where they are.
// Nothing is changed or deleted at the source. Values go back to the caller only (shared/keyScan.ts has the rules).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.ts';
import { envPairs, jsonKeys, sourceLabel, type RawKey } from '../shared/keyScan.ts';

export interface ScanDeps {
  archives: string[];
  files: string[];
  tmpRoot: string;
  exists: (file: string) => Promise<boolean>;
  /** The archive's member names. */
  list: (archive: string) => Promise<string[]>;
  /** Extract these members into `dir`. */
  extract: (archive: string, dir: string, names: string[]) => Promise<void>;
}

const MAX_FILE = 1_000_000;
const MAX_MEMBERS = 2000;

/** An env file or a JSON config, by its name: .env, .env.local, litellm.env, auth.json… */
const isConfig = (name: string) => {
  if (name.endsWith('/') || /(^|\/)node_modules\//.test(name)) return false;
  const base = name.split('/').pop() ?? '';
  return /^\.env(\.[\w-]+)?$/i.test(base) || /\.env$/i.test(base) || /\.json$/i.test(base);
};

/** A file's keys: JSON when it parses as JSON, else env lines. */
function keysIn(text: string): [string, string][] {
  try {
    return jsonKeys(JSON.parse(text) as unknown);
  } catch {
    return envPairs(text);
  }
}

async function readKeys(file: string, label: string): Promise<RawKey[]> {
  const st = await fs.lstat(file).catch(() => null);
  if (!st?.isFile() || st.size > MAX_FILE) return [];
  const text = await fs.readFile(file, 'utf8');
  return keysIn(text).map(([variable, value]) => ({ variable, value, source: label }));
}

/** Every key in the archives' config files and the live files; missing ones are skipped, temp folders always deleted. */
export async function scanForKeys(deps: ScanDeps): Promise<RawKey[]> {
  const out: RawKey[] = [];
  for (const archive of deps.archives) {
    if (!(await deps.exists(archive))) continue;
    const names = (await deps.list(archive)).filter(isConfig).slice(0, MAX_MEMBERS);
    if (!names.length) continue;
    const dir = await fs.mkdtemp(path.join(deps.tmpRoot, 'cubefarm-keys-'));
    try {
      await fs.chmod(dir, 0o700);
      await deps.extract(archive, dir, names);
      for (const name of names) out.push(...(await readKeys(path.join(dir, ...name.split('/')), sourceLabel(name))));
    } finally {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  }
  for (const file of deps.files) if (await deps.exists(file)) out.push(...(await readKeys(file, sourceLabel(file))));
  return out;
}

// ---------- on this computer ----------

/** Where the retired projects' keys are: the 2026-10-04 archive, and OpenCode's own config. */
const ARCHIVES = ['/opt/backups/final-archive-2026-10-04/configs-and-secrets.tar.zst'];
const liveFiles = () => [path.join(os.homedir(), '.config', 'opencode', 'opencode.json'), path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json')];

const TAR_MS = 60_000;

/** backend.scanForKeys: the real archive and files. */
export function realKeyScan(): Promise<RawKey[]> {
  return scanForKeys({
    archives: ARCHIVES,
    files: liveFiles(),
    tmpRoot: os.tmpdir(),
    exists: (f) => fs.access(f).then(() => true, () => false),
    list: async (archive) => (await run('tar', ['--zstd', '-tf', archive], { timeoutMs: TAR_MS })).split(/\r?\n/).filter(Boolean),
    // Names on stdin (-T -), never in a shell; owners and modes aren't restored.
    extract: async (archive, dir, names) => void (await run('tar', ['--zstd', '-xf', archive, '-C', dir, '--no-same-owner', '--no-same-permissions', '-T', '-'], { timeoutMs: TAR_MS, input: names.join('\n') })),
  });
}
