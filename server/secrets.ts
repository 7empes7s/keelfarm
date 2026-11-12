// The manager's secrets file (<SWARM_HOME>/secrets.json, demo-secrets.json in a demo): the ElevenLabs key (voice.ts)
// and the chat apps' webhooks (notifier.ts). Never in the state, the snapshot, events, logs or agents' environments.
// Writes merge into what's there and run one after another per file, so the voice and the notifier never race.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const queues = new Map<string, Promise<unknown>>();

export async function readSecrets(file: string): Promise<Record<string, unknown>> {
  try {
    const s = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    return s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Windows refuses a rename onto a file another process is renaming or reading (EPERM/EBUSY/EACCES): try again shortly. */
async function renameRetrying(from: string, to: string) {
  for (let i = 0; ; i++) {
    try {
      return await fs.rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= 10 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) {
        await fs.rm(from, { force: true }).catch(() => undefined);
        throw err;
      }
      await new Promise((r) => setTimeout(r, 20 * (i + 1)));
    }
  }
}

/** Merge `patch` into the file (other secrets stay; undefined removes a key), owner-only where the OS has file modes. */
export function mergeSecrets(file: string, patch: Record<string, unknown>): Promise<void> {
  const write = (queues.get(file) ?? Promise.resolve()).then(async () => {
    const next: Record<string, unknown> = { ...(await readSecrets(file)), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`; // its own: another process's queue may write the same file
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await renameRetrying(tmp, file);
    await fs.chmod(file, 0o600).catch(() => undefined);
  });
  queues.set(
    file,
    write.catch(() => undefined),
  );
  return write;
}
