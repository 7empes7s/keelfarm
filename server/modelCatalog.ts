// The model catalog (#198): every coding agent's models, read from where each one lists them: Anthropic's models API
// with the agents' Claude login (read as usagePoll.ts reads it: never logged or written), Codex's app-server
// (`model/list`), `opencode models`, and the local model servers that answer. Cached in the state dir. Never throws.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_PROVIDERS, mergeCatalog, type CatalogPart, type LocalProvider } from '../shared/models.ts';
import type { ModelCatalogView } from '../shared/types.ts';
import { commandFor, localUrl } from './clis.ts';
import { run } from './exec.ts';
import { tokenOf } from './usagePoll.ts';
import { cliEnv } from './unblock.ts';

/** Refresh the catalog this often. */
export const CATALOG_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 15_000;

type Found = { id: string; name?: string; isDefault?: boolean }[];

// ---------- the sources' answers (pure) ----------

const records = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Anthropic's GET /v1/models: { data: [{ id, display_name }] }, newest first. */
export const anthropicModels = (body: unknown): Found =>
  records((body as { data?: unknown })?.data)
    .map((m) => ({ id: str(m.id), name: str(m.display_name) || undefined }))
    .filter((m) => m.id);

/** Codex app-server's model/list result: { data: [{ id | model, displayName, hidden, isDefault }] }. */
export const codexModels = (result: unknown): Found =>
  records((result as { data?: unknown })?.data)
    .filter((m) => m.hidden !== true)
    .map((m) => ({ id: str(m.id) || str(m.model), name: str(m.displayName) || undefined, isDefault: m.isDefault === true || undefined }))
    .filter((m) => m.id);

/** `opencode models`: one `provider/model` per line. */
export const opencodeModels = (stdout: string): Found =>
  stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+\/\S+$/.test(l))
    .map((id) => ({ id }));

/** A local server's models: Ollama's /api/tags ({ models: [{ name }] }) or an OpenAI-style /v1/models ({ data: [{ id }] }). */
export const localModels = (body: unknown): string[] => {
  const b = body as { models?: unknown; data?: unknown };
  return [...records(b?.models).map((m) => str(m.name)), ...records(b?.data).map((m) => str(m.id))].filter(Boolean);
};

// ---------- reading them ----------

async function claudeList(env: NodeJS.ProcessEnv): Promise<Found | null> {
  const dir = env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');
  const raw = await fs.readFile(path.join(dir, '.credentials.json'), 'utf8').catch(() => null);
  const cred = raw === null ? null : tokenOf(raw, Date.now());
  if (!cred || 'error' in cred) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { Authorization: `Bearer ${cred.token}`, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? anthropicModels(await res.json()) : null;
  } catch {
    return null; // never the error itself: it could carry the request
  }
}

/** Codex's models over its app-server's JSON-RPC (JSON lines on stdio): initialize, then model/list. */
function codexList(): Promise<Found | null> {
  const cmd = commandFor('codex');
  if (!cmd) return Promise.resolve(null);
  return new Promise((resolve) => {
    const child = spawn(cmd.file, [...cmd.args, 'app-server'], { env: cliEnv(process.env, {}, {}), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const done = (v: Found | null) => {
      clearTimeout(timer);
      child.kill();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), TIMEOUT_MS);
    child.on('error', () => done(null));
    child.on('exit', () => done(null));
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as { id?: number; result?: unknown };
          if (msg.id === 1) done(codexModels(msg.result));
        } catch {
          // not a message
        }
      }
    });
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.on('error', () => undefined);
    send({ method: 'initialize', id: 0, params: { clientInfo: { name: 'cubefarm', title: 'cubefarm', version: '1' } } });
    send({ method: 'initialized' });
    send({ method: 'model/list', id: 1, params: {} });
  });
}

async function opencodeList(): Promise<Found | null> {
  const cmd = commandFor('opencode');
  if (!cmd) return null;
  return run(cmd.file, [...cmd.args, 'models'], { timeoutMs: TIMEOUT_MS }).then(opencodeModels, () => null);
}

/** A local server's models, only when it answers (Ollama's own API, else the OpenAI-compatible one). */
async function localList(p: LocalProvider): Promise<string[]> {
  const base = localUrl(p).replace(/\/+$/, '');
  const url = p.id === 'ollama' ? `${base.replace(/\/v1$/, '')}/api/tags` : `${base}/models`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok ? localModels(await res.json()) : [];
  } catch {
    return []; // not running
  }
}

/** Read every source now. */
export async function readCatalog(env: NodeJS.ProcessEnv = process.env): Promise<ModelCatalogView> {
  const [claude, codex, opencode, ...locals] = await Promise.all([claudeList(env), codexList(), opencodeList(), ...LOCAL_PROVIDERS.map(localList)]);
  const parts: CatalogPart[] = [
    { cli: 'claude', models: claude },
    { cli: 'codex', models: codex },
    { cli: 'opencode', models: opencode },
    ...LOCAL_PROVIDERS.map((p, i) => ({ local: p.id, models: locals[i] })),
  ];
  return mergeCatalog(parts, Date.now());
}

// ---------- the cache ----------

/** The cached catalog, or null. */
export async function loadCatalog(file: string): Promise<ModelCatalogView | null> {
  try {
    const c = JSON.parse(await fs.readFile(file, 'utf8')) as ModelCatalogView;
    return Array.isArray(c.entries) && typeof c.checkedAt === 'number' ? { entries: c.entries, checkedAt: c.checkedAt } : null;
  } catch {
    return null;
  }
}

export async function saveCatalog(file: string, c: ModelCatalogView): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ entries: c.entries, checkedAt: c.checkedAt }));
  await fs.rename(tmp, file);
}
