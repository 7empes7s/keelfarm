import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.ts';
import { commandFor } from './clis.ts';
import { officeItems, type ToolInventory, type ToolItem } from '../shared/tooling.ts';

// The Tools & skills inventory (shared/tooling.ts): what a Claude Code session on this machine loads. Plugins come
// from `claude plugin list --json` (falling back to installed_plugins.json and settings.json), their skills, commands,
// agents and MCP servers from their folders, standalone skills and MCP servers from Claude Code's config files. Read
// only: nothing here writes to ~/.claude. MCP configs are masked: env and header values never leave this file.

/** The few file reads the scan needs, so tests can hand it a folder tree in memory. */
export interface ReadFs {
  text(file: string): string | null;
  /** Names in a folder ([] when it isn't one). */
  list(dir: string): string[];
}

export const diskFs: ReadFs = {
  text: (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
  list: (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  },
};

/** A folder tree in memory (file path → contents): the demo's fake setup, and tests'. */
export function memoryFs(files: Record<string, string>): ReadFs {
  const all = new Map(Object.entries(files).map(([k, v]) => [path.resolve(k), v]));
  return {
    text: (f) => all.get(path.resolve(f)) ?? null,
    list: (dir) => {
      const d = path.resolve(dir) + path.sep;
      return [...new Set([...all.keys()].filter((k) => k.startsWith(d)).map((k) => k.slice(d.length).split(path.sep)[0]))];
    },
  };
}

const json = (r: ReadFs, file: string): unknown => {
  const t = r.text(file);
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const oneLine = (s: string, max = 160) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const tokens = (s: string) => Math.max(1, Math.round(s.length / 4));

// ---------- MCP servers ----------

/** The prefix Claude Code names an MCP server's tools with (mcp__<prefix>__tool): a plugin's are plugin_<plugin>_<server>. */
export function mcpKey(server: string, plugin?: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return plugin ? `plugin_${clean(plugin)}_${clean(server)}` : clean(server);
}

const SECRETISH = /(token|secret|password|passwd|api[-_]?key|apikey|auth|bearer|credential)/i;
/** A package name, maybe scoped and versioned: @scope/name@1.2.3. */
const SAFE_ARG = /^@?[a-z0-9][\w.-]{0,50}(\/[\w.-]{1,50})?(@[\w.^~-]{1,20})?$/i;

/** A URL path segment or argument that looks like a key (long, with digits or mixed case) becomes ••••. */
function maskSegment(s: string): string {
  return s.length >= 20 && /\d/.test(s) && /[A-Za-z]/.test(s) ? '••••' : s;
}

/** An MCP server's config as one line without its secrets: transport, command or address, and only the names of its env and headers. */
export function maskServer(config: unknown): string {
  const c = obj(config);
  const names = (v: unknown) => Object.keys(obj(v));
  const parts: string[] = [];
  const url = str(c.url);
  if (url) {
    let shown = url;
    try {
      const u = new URL(url);
      // No user:password@, ?query or #hash, and no path segment that could be a key.
      shown = `${u.protocol}//${u.host}${u.pathname.split('/').map(maskSegment).join('/')}`;
    } catch {
      shown = url.split(/[?#]/)[0].replace(/\/\/[^/@]*@/, '//');
    }
    parts.push(`${str(c.type) || 'http'} ${shown}`);
  } else if (str(c.command)) {
    const args = Array.isArray(c.args) ? c.args.map(String) : [];
    // Only flags and package names show: anything else (a value, a path, a script) could hold a secret.
    let hide = false;
    const shown = args.slice(0, 6).map((a) => {
      const flag = /^--?[A-Za-z][\w-]*$/.test(a);
      const masked = hide || !(flag || SAFE_ARG.test(a)) || (SECRETISH.test(a) && !flag) || /^[A-Za-z0-9_+/=]{24,}$/.test(a) ? '••••' : a;
      hide = flag && SECRETISH.test(a);
      return masked;
    });
    parts.push(`stdio ${path.basename(str(c.command))}${shown.length ? ` ${shown.join(' ')}` : ''}${args.length > 6 ? ' …' : ''}`);
  } else parts.push(str(c.type) || 'unknown');
  const env = names(c.env);
  const headers = names(c.headers);
  if (env.length) parts.push(`env: ${env.join(', ')}`);
  if (headers.length) parts.push(`headers: ${headers.join(', ')}`);
  return parts.join(' · ');
}

/** A .mcp.json's servers: `{ mcpServers: {...} }` or the servers themselves. */
export function mcpServersOf(file: unknown): Record<string, unknown> {
  const f = obj(file);
  return 'mcpServers' in f ? obj(f.mcpServers) : f;
}

function mcpItem(name: string, config: unknown, source: string, plugin?: { id: string; name: string }): ToolItem {
  const key = mcpKey(name, plugin?.name);
  return {
    id: `mcp:${key}`,
    kind: 'mcp',
    name: plugin ? `${name} (${plugin.name})` : name,
    description: str(obj(config).description) ? oneLine(str(obj(config).description)) : plugin ? `MCP server from the ${plugin.name} plugin.` : 'MCP server.',
    source,
    cost: null, // its tools are only known once it's connected
    detail: maskServer(config),
    ...(plugin ? { plugin: plugin.id } : {}),
  };
}

// ---------- skills, commands, agents ----------

/** A SKILL.md's (or command's, agent's) front matter: its name and description. */
export function frontMatter(text: string): { name: string; description: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const field = (k: string) => {
    const line = m?.[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? '';
    return line.replace(/^(["'])([\s\S]*)\1$/, '$2');
  };
  return { name: field('name'), description: field('description') };
}

interface Found {
  name: string;
  description: string;
}

/** Skills in a skills folder: one folder each with a SKILL.md. */
export function skillsIn(r: ReadFs, dir: string): Found[] {
  return r
    .list(dir)
    .map((d) => {
      const text = r.text(path.join(dir, d, 'SKILL.md'));
      if (text === null) return null;
      const fm = frontMatter(text);
      return { name: fm.name || d, description: fm.description };
    })
    .filter((s): s is Found => s !== null);
}

const mdNames = (r: ReadFs, dir: string) =>
  r
    .list(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));

// ---------- plugins ----------

export interface PluginRecord {
  id: string; // name@marketplace
  enabled: boolean;
  installPath: string;
  version: string;
  /** Its MCP servers as Claude Code resolved them, when it said. */
  mcpServers?: Record<string, unknown>;
}

/** `claude plugin list --json`'s output. */
export function parsePluginList(out: unknown): PluginRecord[] {
  if (!Array.isArray(out)) return [];
  return out
    .map((p) => obj(p))
    .filter((p) => str(p.id))
    .map((p) => ({
      id: str(p.id),
      enabled: p.enabled !== false,
      installPath: str(p.installPath),
      version: str(p.version),
      ...(p.mcpServers && typeof p.mcpServers === 'object' ? { mcpServers: obj(p.mcpServers) } : {}),
    }));
}

/** The same from the files, when the CLI can't say: installed_plugins.json (v1 or v2) and settings.json's enabledPlugins. */
export function pluginsFromFiles(installed: unknown, settings: unknown): PluginRecord[] {
  const plugins = obj(obj(installed).plugins);
  const enabled = obj(obj(settings).enabledPlugins);
  return Object.entries(plugins).map(([id, v]) => {
    const rec = obj(Array.isArray(v) ? v[0] : v);
    return { id, enabled: enabled[id] === true || (Array.isArray(enabled[id]) && (enabled[id] as unknown[]).length > 0), installPath: str(rec.installPath), version: str(rec.version) };
  });
}

/** A plugin and what it brings: its row, and a row for each of its MCP servers. */
export function pluginItems(r: ReadFs, p: PluginRecord): ToolItem[] {
  const [name, marketplace = ''] = p.id.split('@');
  const dir = p.installPath;
  const manifest = obj(json(r, path.join(dir, '.claude-plugin', 'plugin.json')));
  const rel = (v: unknown, fallback: string) => path.join(dir, typeof v === 'string' ? v : fallback);
  const skills = skillsIn(r, rel(manifest.skills, 'skills'));
  const commands = mdNames(r, rel(manifest.commands, 'commands'));
  const agents = mdNames(r, rel(manifest.agents, 'agents'));
  let servers: Record<string, unknown> = p.mcpServers ?? {};
  if (!p.mcpServers) {
    const m = manifest.mcpServers;
    servers = typeof m === 'string' ? mcpServersOf(json(r, path.join(dir, m))) : m && typeof m === 'object' ? mcpServersOf(m) : mcpServersOf(json(r, path.join(dir, '.mcp.json')));
  }
  const id = `plugin:${p.id}`;
  const desc = skills.map((s) => s.description).join(' ');
  const row: ToolItem = {
    id,
    kind: 'plugin',
    name,
    description: oneLine(str(manifest.description) || `${name} plugin.`),
    source: `${marketplace || 'local'}${p.version ? ` · v${p.version}` : ''}`,
    cost: { tools: skills.length + commands.length + agents.length, ...(desc ? { tokens: tokens(desc) } : {}) },
    contents: { skills: skills.map((s) => `${name}:${s.name}`), commands: commands.map((c) => `/${name}:${c}`), agents: agents.map((a) => `${name}:${a}`), mcp: Object.keys(servers) },
    ...(p.enabled ? {} : { locks: { agent: { on: false, why: 'Off in your Claude Code setup (claude plugin enable turns it on)' }, ceo: { on: false, why: 'Off in your Claude Code setup (claude plugin enable turns it on)' } } }),
  };
  return [row, ...Object.entries(servers).map(([s, c]) => mcpItem(s, c, `plugin ${name}`, { id, name }))];
}

// ---------- the whole inventory ----------

export interface ScanInput {
  /** Claude Code's config folder: CLAUDE_CONFIG_DIR, else ~/.claude. */
  configDir: string;
  /** Its global config (~/.claude.json, or .claude.json in CLAUDE_CONFIG_DIR). */
  globalConfig: string;
  /** Project folders sessions run in (the floors' checkouts): their .mcp.json, .claude/skills and local MCP servers. */
  projects: string[];
  /** `claude plugin list --json`, parsed; null when it couldn't run. */
  pluginList: PluginRecord[] | null;
}

/** Everything in one list, the office's own included. Duplicates (a skill in two projects) are listed once. */
export function buildInventory(r: ReadFs, input: ScanInput): ToolItem[] {
  const items = new Map<string, ToolItem>();
  const add = (i: ToolItem) => !items.has(i.id) && items.set(i.id, i);
  for (const i of officeItems()) add(i);
  const plugins = input.pluginList ?? pluginsFromFiles(json(r, path.join(input.configDir, 'plugins', 'installed_plugins.json')), json(r, path.join(input.configDir, 'settings.json')));
  for (const p of plugins) pluginItems(r, p).forEach(add);
  const skill = (s: Found, source: string) =>
    add({ id: `skill:${s.name}`, kind: 'skill', name: s.name, description: oneLine(s.description || 'Skill.'), source, cost: { tools: 1, ...(s.description ? { tokens: tokens(s.description) } : {}) } });
  skillsIn(r, path.join(input.configDir, 'skills')).forEach((s) => skill(s, 'user'));
  const global = obj(json(r, input.globalConfig));
  for (const [name, c] of Object.entries(obj(global.mcpServers))) add(mcpItem(name, c, 'user'));
  for (const dir of input.projects) {
    const label = `project ${path.basename(dir)}`;
    skillsIn(r, path.join(dir, '.claude', 'skills')).forEach((s) => skill(s, label));
    for (const [name, c] of Object.entries(mcpServersOf(json(r, path.join(dir, '.mcp.json'))))) add(mcpItem(name, c, label));
    const local = obj(obj(global.projects)[dir]);
    for (const [name, c] of Object.entries(obj(local.mcpServers))) add(mcpItem(name, c, `local ${path.basename(dir)}`));
  }
  return [...items.values()];
}

/** Scan this machine: the CLI for plugins (30 s at most, no shell), the files for the rest. */
export async function scanTooling(projects: string[], env: NodeJS.ProcessEnv = process.env): Promise<ToolInventory> {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');
  const globalConfig = env.CLAUDE_CONFIG_DIR?.trim() ? path.join(configDir, '.claude.json') : path.join(os.homedir(), '.claude.json');
  let pluginList: PluginRecord[] | null = null;
  let error: string | null = null;
  const cmd = commandFor('claude');
  if (cmd) {
    try {
      pluginList = parsePluginList(JSON.parse(await run(cmd.file, [...cmd.args, 'plugin', 'list', '--json'], { timeoutMs: 30_000 })));
    } catch (err) {
      error = `claude plugin list failed, so plugins were read from their files: ${oneLine((err as Error).message, 200)}`;
    }
  }
  const items = buildInventory(diskFs, { configDir, globalConfig, projects, pluginList });
  return { items, scannedAt: Date.now(), scanning: false, error, via: pluginList ? 'claude plugin list + config files' : 'config files' };
}
