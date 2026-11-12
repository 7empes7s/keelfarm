// Where an Access service token's secret goes (#607): an env file the target service reads (CF_ACCESS_CLIENT_ID and
// CF_ACCESS_CLIENT_SECRET), owner-only. Cloudflare shows the secret once; it goes from the API's answer straight into
// this file and nowhere else (never a card, chat, log or tool output). The env-file rules are pure; the file is one
// temp-and-rename write.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { renameRetrying } from './secrets.ts';

const ID_VAR = 'CF_ACCESS_CLIENT_ID';
const SECRET_VAR = 'CF_ACCESS_CLIENT_SECRET';

/** The secret's file: what's stored in it, and a write returning its undo. */
export interface CfSecretFile {
  path: string;
  clientId(): Promise<string | undefined>;
  write(clientId: string, secret: string): Promise<() => Promise<void>>;
}

/** The client id an env file holds, if any. */
export function envClientId(text: string): string | undefined {
  const m = text.match(new RegExp(`^\\s*(?:export\\s+)?${ID_VAR}\\s*=\\s*["']?([^"'\\s#]+)`, 'm'));
  return m?.[1];
}

/** The env file with the token's two lines set (replaced where they are, else appended), every other line kept. */
export function envWithToken(text: string, clientId: string, secret: string): string {
  const set: Record<string, string> = { [ID_VAR]: clientId, [SECRET_VAR]: secret };
  const done = new Set<string>();
  const lines = text ? text.replace(/\r?\n$/, '').split(/\r?\n/) : [];
  const out = lines.map((l) => {
    const name = Object.keys(set).find((k) => new RegExp(`^\\s*(?:export\\s+)?${k}\\s*=`).test(l));
    if (!name) return l;
    done.add(name);
    return `${name}=${set[name]}`;
  });
  for (const k of Object.keys(set)) if (!done.has(k)) out.push(`${k}=${set[k]}`);
  return `${out.join('\n')}\n`;
}

/** Why this path can't hold the secret, or null: absolute, an env file, outside the office's own folders. */
export function envPathRefusal(p: string, protectedDirs: readonly string[]): string | null {
  if (!path.isAbsolute(p)) return `"${p}" isn't an absolute path to an env file.`;
  const base = path.basename(p);
  if (!/^\.env(\..+)?$|\.env$/.test(base)) return `"${base}" isn't an env file (name it like clipfarm.env or .env).`;
  const norm = path.posix.normalize(p.replace(/\\/g, '/'));
  const dir = protectedDirs.find((d) => norm === d || norm.startsWith(`${d.replace(/\/$/, '')}/`));
  return dir ? `${p} is inside ${dir}, which the office keeps out of reach.` : null;
}

const read = (file: string) => fs.readFile(file, 'utf8').catch(() => null);

async function put(file: string, text: string) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await renameRetrying(tmp, file);
  await fs.chmod(file, 0o600).catch(() => undefined);
}

/** The env file on disk; its undo puts back what was there (or removes the file it made). */
export function envSecretFile(file: string): CfSecretFile {
  return {
    path: file,
    clientId: async () => envClientId((await read(file)) ?? ''),
    write: async (clientId, secret) => {
      const before = await read(file);
      await put(file, envWithToken(before ?? '', clientId, secret));
      return () => (before === null ? fs.rm(file, { force: true }) : put(file, before));
    },
  };
}
