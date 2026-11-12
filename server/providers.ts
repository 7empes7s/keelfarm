// Settings → Providers (#362): the keys added on the Providers page and the MCP servers the office gives its agents,
// in <SWARM_HOME>/providers.json without a secret. Keys are in secrets.json (`provider:<id>`), an MCP server's secrets
// as `mcp:<id>:<NAME>`. Claude and Codex accounts, the ElevenLabs key and the Upstash key stay in their own stores;
// shared/providers.ts draws them all as one list. Every change goes to the tabs through `changed`.
import fs from 'node:fs/promises';
import { constants as fsConst } from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { HttpError } from './httpError.ts';
import { mergeSecrets, readSecrets } from './secrets.ts';
import { defaultUse, isProviderUse, keyHint, keyProblem, mcpProblem, mcpTestNote, mcpTestRequest, providerDef, sessionMcpServers, splitCommand, testNote, testPlan, testRequest, testUsage, type McpInput, type ProbeRequest, type ProbeResult } from '../shared/providers.ts';
import { checkResult, legacyImportName } from '../shared/keyScan.ts';
import { cleanTags } from '../shared/accounts.ts';
import { OAUTH, authorizeUrl, callbackPath, codeForm, needsRefresh, oauthDef, readTokens, refreshForm, type OAuthDef } from '../shared/oauth.ts';
import { cloudflareVerify, missingClassicScopes, missingNote, permissionSteps, runPermissionSteps, turnedAwayNote } from '../shared/keySetup.ts';
import { CAPABILITIES } from '../shared/capabilities.ts';
import type { Capability, CapabilityChoice, KeyMint, McpServerConfig, ProviderConnection, ProvidersView, ProviderTest, ProviderUse } from '../shared/types.ts';
import type { KeyInstall } from '../shared/keyInstall.ts';

const keyOf = (id: string) => `provider:${id}`; // a sign-in's refresh token (Meta's long-lived token)
const accessOf = (id: string) => `oauth-access:${id}`; // a sign-in's access token
const clientOf = (company: string, part: 'id' | 'secret') => `oauth-client:${company}:${part}`;
const mcpKeyOf = (id: string, name: string) => `mcp:${id}:${name}`;
const PENDING_MS = 10 * 60_000;

export interface ProvidersDeps {
  file: string; // <SWARM_HOME>/providers.json
  secretsFile: string;
  /** One cheap read-only call (backend.providerProbe; the demo's is fake). Never throws. */
  probe: (req: ProbeRequest) => Promise<ProbeResult>;
  changed: (view: ProvidersView) => void;
  /** The demo: a sign-in's consent comes straight back, with no OAuth client (#533). */
  fakeConsent?: boolean;
  /** The first floor's repo ("owner/name"), for a GitHub token's permission checks. */
  repo?: () => string | undefined;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const testOf = (v: unknown): ProviderTest | null => (v && typeof v === 'object' && typeof (v as ProviderTest).at === 'number' ? (v as ProviderTest) : null);

/** A saved connection, anything malformed dropped; an import's old name (before #523) cleaned, its source kept. */
function readConnection(c: Record<string, unknown>): ProviderConnection[] {
  const def = c && str(c.id) ? providerDef(str(c.provider)) : undefined;
  if (!def) return [];
  const named = c.named === true;
  const label = str(c.label) || def.name;
  const legacy = !named && !str(c.source) ? legacyImportName(def.id, label) : null;
  const source = legacy?.source ?? str(c.source);
  return [
    {
      id: str(c.id),
      provider: def.id,
      label: legacy?.label ?? label,
      addedAt: Number(c.addedAt) || 0,
      keyHint: str(c.keyHint),
      test: testOf(c.test),
      tags: cleanTags(c.tags),
      usedFor: isProviderUse(c.usedFor) ? c.usedFor : defaultUse(def.category),
      ...(source ? { source } : {}),
      ...(named ? { named } : {}),
      ...(str(c.accountId) ? { accountId: str(c.accountId) } : {}),
      ...(Array.isArray(c.scopes) ? { scopes: strs(c.scopes) } : {}),
      ...(Number(c.expiresAt) > 0 ? { expiresAt: Number(c.expiresAt) } : {}),
      ...(str(c.usedBy) ? { usedBy: str(c.usedBy) } : {}),
      ...(Array.isArray(c.installs) && c.installs.length ? { installs: (c.installs as KeyInstall[]).filter((i) => i && str(i.file) && str(i.var)) } : {}),
      ...(c.mint && typeof c.mint === 'object' && str((c.mint as KeyMint).tokenId) ? { mint: c.mint as KeyMint } : {}),
    },
  ];
}

/** The manager's default and fallback per capability, anything malformed dropped. */
function readDefaults(raw: unknown): Partial<Record<Capability, CapabilityChoice>> {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, Record<string, unknown>>) : {};
  return Object.fromEntries(
    CAPABILITIES.flatMap(({ id }) => {
      const c = o[id];
      if (!c || typeof c !== 'object') return [];
      const choice: CapabilityChoice = { ...(str(c.primary) ? { primary: str(c.primary) } : {}), ...(str(c.fallback) ? { fallback: str(c.fallback) } : {}) };
      return Object.keys(choice).length ? [[id, choice]] : [];
    }),
  );
}

/** The saved file as a view, anything malformed dropped. */
export function readProvidersFile(raw: unknown): ProvidersView {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const connections = (Array.isArray(o.connections) ? o.connections : []).flatMap(readConnection);
  const mcp = (Array.isArray(o.mcp) ? o.mcp : []).flatMap((m: Record<string, unknown>): McpServerConfig[] =>
    m && str(m.id) && str(m.name) && (str(m.command) || str(m.url))
      ? [{ id: str(m.id), name: str(m.name), ...(str(m.command) ? { command: str(m.command), args: strs(m.args) } : { url: str(m.url) }), envKeys: strs(m.envKeys), on: m.on !== false, agents: strs(m.agents), test: testOf(m.test) }]
      : [],
  );
  const clients = strs(o.clients).filter((c) => oauthDef(c));
  return { connections, mcp, defaults: readDefaults(o.defaults), clients };
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
  private data: ProvidersView = { connections: [], mcp: [], defaults: {}, clients: [] };
  /** Sign-ins waiting for their consent: state → where they started. Memory only. */
  private pending = new Map<string, { company: string; redirectUri: string; at: number }>();
  private keys = new Map<string, string>(); // secrets.json's provider:* and mcp:* values
  private writing: Promise<void> = Promise.resolve();

  constructor(private deps: ProvidersDeps) {}

  async init() {
    this.data = readProvidersFile(await fs.readFile(this.deps.file, 'utf8').then((t) => JSON.parse(t) as unknown, () => null));
    const s = await readSecrets(this.deps.secretsFile);
    for (const [k, v] of Object.entries(s)) if (/^(provider|mcp|oauth-access|oauth-client):/.test(k) && typeof v === 'string' && v) this.keys.set(k, v);
  }

  view(): ProvidersView {
    return {
      connections: this.data.connections.map((c) => ({ ...c })),
      mcp: this.data.mcp.map((m) => ({ ...m })),
      defaults: structuredClone(this.data.defaults ?? {}),
      clients: this.deps.fakeConsent ? OAUTH.map((o) => o.company) : [...(this.data.clients ?? [])],
    };
  }

  /** Every saved value, for the journal's and logs' redaction. */
  secretValues(): string[] {
    return [...this.keys.values()];
  }

  /** The saved keys with their connections' names, for finding duplicates (#367). Server memory only. */
  savedKeys(): { value: string; label: string }[] {
    return this.data.connections.flatMap((c) => {
      const value = this.keys.get(keyOf(c.id));
      return value ? [{ value, label: c.label }] : [];
    });
  }

  /** A provider's keys for the office's own calls (#586: Cloudflare), with their last test. Server memory only. */
  keysFor(provider: string): { id: string; label: string; key: string; accountId?: string; ok?: boolean }[] {
    return this.data.connections.flatMap((c) => {
      const key = c.provider === provider ? this.keys.get(keyOf(c.id)) : undefined;
      return key ? [{ id: c.id, label: c.label, key, ...(c.accountId && { accountId: c.accountId }), ...(c.test && { ok: c.test.ok }) }] : [];
    });
  }

  /** One key's value (#609: install_key and renewals). Server memory only. */
  keyValue(id: string): string | undefined {
    return this.keys.get(keyOf(id));
  }

  /** install_key put it in a service's env file (#609): kept on the key, so a renewal installs there too. */
  async noteInstall(id: string, ki: KeyInstall) {
    const c = this.connection(id);
    c.installs = [...(c.installs ?? []).filter((i) => !(i.file === ki.file && i.var === ki.var)), ki];
    await this.save();
  }

  /** A made key renewed (#609): its new value, expiry and token. */
  async renewed(id: string, value: string, expiresAt: number, tokenId: string) {
    const c = this.connection(id);
    await mergeSecrets(this.deps.secretsFile, { [keyOf(id)]: value });
    this.keys.set(keyOf(id), value);
    Object.assign(c, { keyHint: keyHint(value), expiresAt, ...(c.mint && { mint: { ...c.mint, tokenId } }) });
    await this.save();
  }

  /** The MCP servers an agent's session gets (its own mcp.json). */
  mcpFor(agentId: string): Record<string, Record<string, unknown>> {
    return sessionMcpServers(this.data.mcp, agentId, (id, name) => this.keys.get(mcpKeyOf(id, name)) ?? '');
  }

  // ---------- keys ----------

  /** A key for a catalogue provider: saved, then tested. An empty one reuses the key it shares (Google video's Gemini key). */
  async add(provider: string, rawKey: string, rawLabel = '', source = '', accountId = '', extra: { usedBy?: string; expiresAt?: number; mint?: KeyMint } = {}): Promise<ProviderConnection> {
    const shared = providerDef(provider)?.sharesKeyWith;
    const from = shared && this.data.connections.find((x) => x.provider === shared);
    const key = rawKey.trim() || (from ? (this.keys.get(keyOf(from.id)) ?? '') : '');
    const problem = keyProblem(provider, key);
    if (problem) throw new HttpError(400, problem);
    const def = providerDef(provider)!;
    const label = rawLabel.trim().slice(0, 60) || def.name;
    const acct = accountId.trim();
    if (acct && !/^[0-9a-f]{32}$/i.test(acct)) throw new HttpError(400, 'An Account ID is 32 letters and digits: copy it from any domain’s Overview page.');
    const usedBy = extra.usedBy?.trim().slice(0, 200);
    const c: ProviderConnection = { id: randomUUID().slice(0, 8), provider, label, addedAt: Date.now(), keyHint: keyHint(key), test: null, tags: [], usedFor: defaultUse(def.category), ...(source ? { source } : {}), ...(acct ? { accountId: acct } : {}), ...(usedBy && { usedBy }), ...(extra.expiresAt && { expiresAt: extra.expiresAt }), ...(extra.mint && { mint: extra.mint }) };
    await mergeSecrets(this.deps.secretsFile, { [keyOf(c.id)]: key });
    this.keys.set(keyOf(c.id), key);
    this.data.connections.push(c);
    await this.save();
    return testRequest(provider, key) || provider === 'cloudflare' ? this.test(c.id) : { ...c }; // Postiz and Other keys have no test call
  }

  /** Rename and tags (#523): its name (empty: the provider's), tags and what it's for. A name set here stays. */
  async update(id: string, patch: { label?: string; tags?: unknown; usedFor?: ProviderUse; accountId?: string }): Promise<ProviderConnection> {
    const c = this.connection(id);
    if (patch.accountId !== undefined) {
      const acct = patch.accountId.trim();
      if (acct && !/^[0-9a-f]{32}$/i.test(acct)) throw new HttpError(400, 'An Account ID is 32 letters and digits: copy it from any domain’s Overview page.');
      if (acct) c.accountId = acct;
      else delete c.accountId;
    }
    if (patch.label !== undefined) {
      c.label = patch.label.trim().slice(0, 60) || providerDef(c.provider)!.name;
      c.named = true;
    }
    if (patch.tags !== undefined) c.tags = cleanTags(patch.tags);
    if (patch.usedFor !== undefined) {
      if (!isProviderUse(patch.usedFor)) throw new HttpError(400, 'Used for is AI inference, Operations or Both.');
      c.usedFor = patch.usedFor;
    }
    await this.save();
    return { ...c };
  }

  async remove(id: string) {
    this.connection(id);
    this.data.connections = this.data.connections.filter((x) => x.id !== id);
    this.keys.delete(keyOf(id));
    this.keys.delete(accessOf(id));
    await mergeSecrets(this.deps.secretsFile, { [keyOf(id)]: undefined, [accessOf(id)]: undefined });
    for (const [cap, choice] of Object.entries(this.data.defaults ?? {})) {
      if (choice.primary === `connection:${id}`) delete choice.primary;
      if (choice.fallback === `connection:${id}`) delete choice.fallback;
      if (!choice.primary && !choice.fallback) delete this.data.defaults![cap as Capability];
    }
    await this.save();
  }

  /**
   * Its cheap read-only call, and what that said about usage where the provider tells. A sign-in refreshes its token
   * first; Cloudflare and GitHub keys then check the permissions the office needs (#533).
   */
  async test(id: string): Promise<ProviderConnection> {
    const c = this.connection(id);
    let key = this.keys.get(keyOf(id)) ?? '';
    if (oauthDef(c.provider)) {
      try {
        key = await this.accessToken(id);
      } catch (err) {
        c.test = { at: Date.now(), ok: false, note: (err as Error).message, result: 'dead' };
        await this.save();
        return { ...c };
      }
    }
    const req = c.provider === 'cloudflare' && c.accountId ? cloudflareVerify(key, c.accountId) : testRequest(c.provider, c.provider === 'kling' ? klingToken(key) : key);
    if (!req) throw new HttpError(400, `${c.label} is tested in its own settings.`);
    let r = await this.deps.probe(req);
    // an Account ID beside a user token: the user's verify call is the right one
    if (c.provider === 'cloudflare' && c.accountId && r.status >= 400 && r.status < 500) r = await this.deps.probe(cloudflareVerify(key));
    const ok = r.status >= 200 && r.status < 300;
    const windows = ok ? testUsage(c.provider, r.body) : [];
    const plan = ok ? testPlan(c.provider, r.body) : undefined;
    const missing = ok ? [...(c.provider === 'github' ? missingClassicScopes(r.headers) : []), ...(await runPermissionSteps(c.provider, permissionSteps(c.provider, key), this.deps.probe, { accountId: c.accountId, repo: this.deps.repo?.() }))] : [];
    const note = testNote(r);
    c.test = {
      at: Date.now(),
      ...note,
      note: missing.length ? missingNote(missing) : ok ? note.note : (turnedAwayNote(c.provider, r.status) ?? note.note),
      ...(windows.length ? { windows } : {}),
      ...(plan ? { plan } : {}),
      result: checkResult(c.provider, r).result,
      ...(missing.length ? { missing } : {}),
    };
    await this.save();
    return { ...c };
  }

  // ---------- defaults per capability (#533) ----------

  /** A capability's default and fallback (card keys; empty = the office picks). */
  async setDefault(capability: Capability, choice: CapabilityChoice): Promise<ProvidersView> {
    if (!CAPABILITIES.some((x) => x.id === capability)) throw new HttpError(400, 'Pick text, image, video, audio, operations or publishing.');
    const next: CapabilityChoice = { ...(choice.primary ? { primary: choice.primary } : {}), ...(choice.fallback && choice.fallback !== choice.primary ? { fallback: choice.fallback } : {}) };
    this.data.defaults ??= {};
    if (Object.keys(next).length) this.data.defaults[capability] = next;
    else delete this.data.defaults[capability];
    await this.save();
    return this.view();
  }

  // ---------- one sign-in per company (#533) ----------

  /** A company's OAuth client (made once in its developer console): the id and secret stay in secrets.json. */
  async setClient(company: string, clientId: string, clientSecret: string) {
    if (!oauthDef(company)) throw new HttpError(400, 'Pick Google, Meta, TikTok or Microsoft.');
    const [id, secret] = [clientId.trim(), clientSecret.trim()];
    if (!id || !secret || /\s/.test(id + secret)) throw new HttpError(400, 'Paste both the client ID and the client secret.');
    await mergeSecrets(this.deps.secretsFile, { [clientOf(company, 'id')]: id, [clientOf(company, 'secret')]: secret });
    this.keys.set(clientOf(company, 'id'), id);
    this.keys.set(clientOf(company, 'secret'), secret);
    this.data.clients = [...new Set([...(this.data.clients ?? []), company])];
    await this.save();
  }

  /** The consent screen's address, asking for every scope at once; the browser comes back to `origin` + callbackPath. */
  oauthStart(company: string, origin: string): { url: string } {
    const def = oauthDef(company);
    if (!def) throw new HttpError(400, 'Pick Google, Meta, TikTok or Microsoft.');
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw new HttpError(400, 'Open the office from its own address to sign in.');
    const redirectUri = origin + callbackPath;
    const state = randomBytes(16).toString('hex');
    const now = Date.now();
    for (const [k, p] of this.pending) if (now - p.at > PENDING_MS) this.pending.delete(k);
    if (this.deps.fakeConsent) {
      this.pending.set(state, { company, redirectUri, at: now });
      return { url: `${redirectUri}?${new URLSearchParams({ state, code: 'demo-consent' })}` };
    }
    const clientId = this.keys.get(clientOf(company, 'id'));
    if (!clientId) throw new HttpError(400, `Set up ${def.name}'s sign-in first: paste its client ID and secret.`);
    this.pending.set(state, { company, redirectUri, at: now });
    return { url: authorizeUrl(def, { clientId, redirectUri, state }) };
  }

  /** The consent came back: trade its code for tokens (kept here), and the company's connection lights up. */
  async oauthFinish(state: string, code: string): Promise<ProviderConnection> {
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (!p || Date.now() - p.at > PENDING_MS) throw new HttpError(400, 'This sign-in expired or was already used: start it again from Settings → Providers.');
    if (!code) throw new HttpError(400, 'The sign-in was cancelled.');
    const def = oauthDef(p.company)!;
    const client = this.client(def);
    const r = await this.deps.probe({ kind: 'form', url: def.tokenUrl, form: codeForm(def, { ...client, code, redirectUri: p.redirectUri }) });
    const t = readTokens(r.body);
    if ('error' in t) throw new HttpError(400, `${def.name} said: ${t.error}`);
    // one connection per company: signing in again replaces its tokens
    let c = this.data.connections.find((x) => x.provider === def.company);
    if (!c) {
      c = { id: randomUUID().slice(0, 8), provider: def.company, label: def.name, addedAt: Date.now(), keyHint: '', test: null, tags: [], usedFor: defaultUse('signin') };
      this.data.connections.push(c);
    }
    c.scopes = t.scopes ?? def.scopes.flatMap((s) => s.scope.split(' '));
    c.expiresAt = t.expiresAt;
    const vals = { [keyOf(c.id)]: t.refresh ?? t.access, [accessOf(c.id)]: t.access };
    await mergeSecrets(this.deps.secretsFile, vals);
    for (const [k, v] of Object.entries(vals)) this.keys.set(k, v);
    await this.save();
    return this.test(c.id);
  }

  /** A sign-in's access token, refreshed here when it runs out; the tokens never leave the server. */
  async accessToken(id: string): Promise<string> {
    const c = this.connection(id);
    const def = oauthDef(c.provider);
    if (!def) throw new HttpError(400, `${c.label} is a key, not a sign-in.`);
    const access = this.keys.get(accessOf(id));
    if (access && !needsRefresh(def, c.expiresAt)) return access;
    const token = this.keys.get(keyOf(id));
    if (!token) throw new Error(`Sign in with ${def.name} again: no token is saved.`);
    const r = await this.deps.probe({ kind: 'form', url: def.tokenUrl, form: refreshForm(def, { ...this.client(def), token }) });
    const t = readTokens(r.body);
    if ('error' in t) throw new Error(`Sign in with ${def.name} again: ${t.error}`);
    c.expiresAt = t.expiresAt;
    if (t.scopes) c.scopes = t.scopes;
    const vals = { [accessOf(id)]: t.access, ...(t.refresh ? { [keyOf(id)]: t.refresh } : def.refresh === 'fb_exchange_token' ? { [keyOf(id)]: t.access } : {}) };
    await mergeSecrets(this.deps.secretsFile, vals);
    for (const [k, v] of Object.entries(vals)) this.keys.set(k, v);
    await this.save();
    return t.access;
  }

  private client(def: OAuthDef) {
    if (this.deps.fakeConsent) return { clientId: 'demo-client', clientSecret: 'demo-secret' };
    const clientId = this.keys.get(clientOf(def.company, 'id'));
    const clientSecret = this.keys.get(clientOf(def.company, 'secret'));
    if (!clientId || !clientSecret) throw new HttpError(400, `Set up ${def.name}'s sign-in first: paste its client ID and secret.`);
    return { clientId, clientSecret };
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

  private connection(id: string): ProviderConnection {
    const c = this.data.connections.find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'No such connection: it may be gone already.');
    return c;
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
      const tmp = `${this.deps.file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`; // its own name: another writer of the file never renames it away
      await fs.writeFile(tmp, text);
      await fs.rename(tmp, this.deps.file);
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
    // a sign-in's token exchange: the one POST, to the company's token URL (shared/oauth.ts)
    const init: RequestInit =
      req.kind === 'form'
        ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(req.form).toString() }
        : { headers: req.headers };
    const res = await fetch(req.url, { ...init, signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => undefined);
    const headers = Object.fromEntries(['x-oauth-scopes', 'x-accepted-github-permissions'].flatMap((h) => (res.headers.has(h) ? [[h, res.headers.get(h) ?? '']] : [])));
    return { status: res.status, body, ...(Object.keys(headers).length ? { headers } : {}) };
  } catch {
    return { status: 0 };
  }
}
