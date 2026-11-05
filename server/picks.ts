// The "/" quick picks in the CEO chat: the skills and apps (MCP servers) installed in the manager's Claude Code setup,
// which the CEO's sessions load (settingSources user/project/local). Read from ~/.claude; only names leave the server.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { connectorName, type QuickPicks } from '../shared/used.ts';

const dirs = async (dir: string) => (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name);
const hasSkill = (dir: string) => fs.access(path.join(dir, 'SKILL.md')).then(() => true, () => false);
const json = async (file: string): Promise<Record<string, unknown>> => {
  try {
    const v = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const keys = (v: unknown) => (v && typeof v === 'object' ? Object.keys(v) : []);

/** The manager's skills (their own, then plugins' as plugin:skill) and their MCP servers, sorted, without duplicates. */
export async function readPicks(claudeDir = path.join(os.homedir(), '.claude'), claudeJson = path.join(os.homedir(), '.claude.json')): Promise<QuickPicks> {
  const skills = new Set<string>();
  for (const name of await dirs(path.join(claudeDir, 'skills'))) if (await hasSkill(path.join(claudeDir, 'skills', name))) skills.add(name);
  const installed = (await json(path.join(claudeDir, 'plugins', 'installed_plugins.json'))).plugins;
  for (const [id, entries] of Object.entries(installed && typeof installed === 'object' ? installed : {})) {
    const plugin = id.split('@')[0];
    for (const e of Array.isArray(entries) ? entries : []) {
      const at = typeof e?.installPath === 'string' ? path.join(e.installPath, 'skills') : null;
      if (!at) continue;
      for (const name of await dirs(at)) if (await hasSkill(path.join(at, name))) skills.add(`${plugin}:${name}`);
    }
  }
  const apps = new Set([...keys((await json(claudeJson)).mcpServers), ...keys((await json(path.join(claudeDir, 'settings.json'))).mcpServers)].map(connectorName));
  return { skills: [...skills].sort().slice(0, 200), apps: [...apps].sort().slice(0, 100) };
}
