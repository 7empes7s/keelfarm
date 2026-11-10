// Settings → Providers (#362): the keys added on the Providers page and the MCP servers the office gives its agents,
// in <SWARM_HOME>/providers.json without a secret. Keys are in secrets.json (`provider:<id>`), an MCP server's secrets
// as `mcp:<id>:<NAME>`. Claude and Codex accounts, the ElevenLabs key and the Upstash key stay in their own stores;
// shared/providers.ts draws them all as one list. Every change goes to the tabs through `changed`.
import fs from 'node:fs/promises';
import { constants as fsConst } from 'node:fs';
import path from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { HttpError } from './httpError.ts';
import { mergeSecrets, readSecrets } from './secrets.ts';
import { keyHint, keyProblem, mcpProblem, mcpTestNote, mcpTestRequest, providerDef, sessionMcpServers, splitCommand, testNote, testPlan, testRequest, testUsage, type McpInput, type ProbeRequest, type ProbeResult } from '../shared/providers.ts';
import type { McpServerConfig, ProviderConnection, ProvidersView, ProviderTest } from '../shared/types.ts';

const keyOf = (id: string) => `provider:${id}`;
const mcpKeyOf = (id: string, name: string) => `mcp:${id}:${name}`;

export interface ProvidersDeps {
  file: string; // <SWARM_HOME>/providers.json
  secretsFile: string;
  /** One cheap read-only call (backend.providerProbe; the demo's is fake). Never throws. */
  probe: (req: ProbeRequest) => Promise<ProbeResult>;
  changed: (view: ProvidersView) => void;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const testOf = (v: unknown): ProviderTest | null => (v && typeof v === 'object' && typeof (v as ProviderTest).at === 'number' ? (v as ProviderTest) : null);

/** The saved file as a view, anything malformed dropped. */
export function readProvidersFile(raw: unknown): ProvidersView {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const connections = (Array.isArray(o.connections) ? o.connections : []).flatMap((c: Record<string, unknown>): ProviderConnection[] =>
    c && str(c.id) && providerDef(str(c.provider)) ? [{ id: str(c.id), provider: str(c.provider), label: str(c.label) || providerDef(str(c.provider))!.name, addedAt: Number(c.addedAt) || 0, keyHint: str(c.keyHint), test: testOf(c.test) }] : [],
  );
  const mcp = (Array.isArray(o.mcp) ? o.mcp : []).flatMap((m: Record<string, unknown>): McpServerConfig[] =>
    m && str(m.id) && str(m.name) && (str(m.command) || str(m.url))
      ? [{ id: str(m.id), name: str(m.name), ...(str(m.command) ? { command: str(m.command), args: strs(m.args) } : { url: str(m.url) }), envKeys: strs(m.envKeys), on: m.on !== false, agents: strs(m.agents), test: testOf(m.test) }]
      : [],
  );
  return { connections, mcp };
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** Kling's bearer: an "access:secret" pair becomes a 30-minute HS256 JWT (iss = the access key); one API key goes as is. */
export function klingToken(key: string, now = Date.now()): string {
  const [access, secret] = key.split(':');
  if (secret === undefined) return key;
  const sec = Math.floor(now / 1000);
  const head = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: access, exp: sec + 1800, nbf: sec - 5 }))}`;
  return `${head}.${b64url(createHmac('sha256', secret).update(head).digest())}`;
}

export class Providers {
  private data: ProvidersView = { connections: [], mcp: [] };
  private keys = new Map<string, string>(); // secrets.json's provider:* and mcp:* values
  private writing: Promise<void> = Promise.resolve();

  constructor(private deps: ProvidersDeps) {}

  async init() {
    this.data = readProvidersFile(await fs.readFile(this.deps.file, 'utf8').then((t) => JSON.parse(t) as unknown, () => null));
    const s = await readSecrets(this.deps.secretsFile);
    for (const [k, v] of Object.entries(s)) if ((k.startsWith('provider:') || k.startsWith('mcp:')) && typeof v === 'string' && v) this.keys.set(k, v);
  }

  view(): ProvidersView {
    return { connections: this.data.connections.map((c) => ({ ...c })), mcp: this.data.mcp.map((m) => ({ ...m })) };
  }

  /** Every saved value, for the journal's and logs' redaction. */
  secretValues(): string[] {
    return [...this.keys.values()];
  }

  /** The MCP servers an agent's session gets (its own mcp.json). */
  mcpFor(agentId: string): Record<string, Record<string, unknown>> {
    return sessionMcpServers(this.data.mcp, agentId, (id, name) => this.keys.get(mcpKeyOf(id, name)) ?? '');
  }

  // ---------- keys ----------

  /** A key for a catalogue provider: saved, then tested. An empty one reuses the key it shares (Google video's Gemini key). */
  async add(provider: string, rawKey: string, rawLabel = ''): Promise<ProviderConnection> {
    const shared = providerDef(provider)?.sharesKeyWith;
    const from = shared && this.data.connections.find((x) => x.provider === shared);
    const key = rawKey.trim() || (from ? (this.keys.get(keyOf(from.id)) ?? '') : '');
    const problem = keyProblem(provider, key);
    if (problem) throw new HttpError(400, problem);
    const def = providerDef(provider)!;
    const label = rawLabel.trim().slice(0, 60) || def.name;
    const c: ProviderConnection = { id: randomUUID().slice(0, 8), provider, label, addedAt: Date.now(), keyHint: keyHint(key), test: null };
    await mergeSecrets(this.deps.secretsFile, { [keyOf(c.id)]: key });
    this.keys.set(keyOf(c.id), key);
    this.data.connections.push(c);
    await this.save();
    return this.test(c.id);
  }

  async remove(id: string) {
    const c = this.data.connections.find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'No such connection: it may be gone already.');
    this.data.connections = this.data.connections.filter((x) => x.id !== id);
    this.keys.delete(keyOf(id));
    await mergeSecrets(this.deps.secretsFile, { [keyOf(id)]: undefined });
    await this.save();
  }

  /** Its cheap read-only call, and what that said about usage where the provider tells. */
  async test(id: string): Promise<ProviderConnection> {
    const c = this.data.connections.find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'No such connection: it may be gone already.');
    const key = this.keys.get(keyOf(id)) ?? '';
    const req = testRequest(c.provider, c.provider === 'kling' ? klingToken(key) : key);
    if (!req) throw new HttpError(400, `${c.label} is tested in its own settings.`);
    const r = await this.deps.probe(req);
    const ok = r.status >= 200 && r.status < 300;
    const windows = ok ? testUsage(c.provider, r.body) : [];
    const plan = ok ? testPlan(c.provider, r.body) : undefined;
    c.test = { at: Date.now(), ...testNote(r), ...(windows.length ? { windows } : {}), ...(plan ? { plan } : {}) };
    await this.save();
    return { ...c };
  }

  // ---------- MCP servers ----------

  /** A new MCP server: a command (split into its arguments) or a URL, with its secrets' values. */
  async addMcp(input: McpInput & { secrets?: Record<string, string> }): Promise<McpServerConfig> {
    const envKeys = Object.keys(input.secrets ?? {}).filter((k) => input.secrets![k].trim());
    const problem = mcpProblem({ ...input, envKeys }, this.data.mcp.map((m) => m.name));
    if (problem) throw new HttpError(400, problem);
    const id = randomUUID().slice(0, 8);
    const where = input.url?.trim() ? { url: input.url.trim() } : splitCommand(input.command ?? '');
    const m: McpServerConfig = { id, name: input.name.trim(), ...where, envKeys, on: true, agents: input.agents ?? [], test: null };
    const vals = Object.fromEntries(envKeys.map((k) => [mcpKeyOf(id, k), input.secrets![k].trim()]));
    if (envKeys.length) await mergeSecrets(this.deps.secretsFile, vals);
    for (const [k, v] of Object.entries(vals)) this.keys.set(k, v);
    this.data.mcp.push(m);
    await this.save();
    return { ...m };
  }

  /** On/off and who gets it. */
  async setMcp(id: string, patch: { on?: boolean; agents?: string[] }): Promise<McpServerConfig> {
    const m = this.mcp(id);
    if (patch.on !== undefined) m.on = patch.on;
    if (patch.agents) m.agents = [...new Set(patch.agents)];
    await this.save();
    return { ...m };
  }

  async removeMcp(id: string) {
    const m = this.mcp(id);
    this.data.mcp = this.data.mcp.filter((x) => x.id !== id);
    for (const k of m.envKeys) this.keys.delete(mcpKeyOf(id, k));
    if (m.envKeys.length) await mergeSecrets(this.deps.secretsFile, Object.fromEntries(m.envKeys.map((k) => [mcpKeyOf(id, k), undefined])));
    await this.save();
  }

  async testMcp(id: string): Promise<McpServerConfig> {
    const m = this.mcp(id);
    m.test = { at: Date.now(), ...mcpTestNote(m, await this.deps.probe(mcpTestRequest(m))) };
    await this.save();
    return { ...m };
  }

  private mcp(id: string): McpServerConfig {
    const m = this.data.mcp.find((x) => x.id === id);
    if (!m) throw new HttpError(404, 'No such MCP server: it may be gone already.');
    return m;
  }

  /** Written one after another (temp file, then rename), then sent to the tabs. */
  private save(): Promise<void> {
    const text = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.deps.file), { recursive: true });
      await fs.writeFile(`${this.deps.file}.tmp`, text);
      await fs.rename(`${this.deps.file}.tmp`, this.deps.file);
    });
    this.deps.changed(this.view());
    return this.writing;
  }
}

// ---------- the real test calls ----------

/** On the PATH (with Windows' extensions), or a path that exists. */
async function onPath(command: string): Promise<boolean> {
  if (!command) return false;
  const exts = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')] : [''];
  const dirs = path.isAbsolute(command) || command.includes('/') || command.includes('\\') ? [''] : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const d of dirs)
    for (const e of exts) {
      const ok = await fs.access(d ? path.join(d, command + e) : command + e, process.platform === 'win32' ? fsConst.F_OK : fsConst.X_OK).then(() => true, () => false);
      if (ok) return true;
    }
  return false;
}

/** backend.providerProbe: a GET with the key in its header (10 s), or the command looked up. The key goes nowhere else. */
export async function realProbe(req: ProbeRequest): Promise<ProbeResult> {
  if (req.kind === 'command') return { status: (await onPath(req.command)) ? 200 : 404 };
  try {
    const res = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => undefined);
    return { status: res.status, body };
  } catch {
    return { status: 0 };
  }
}
