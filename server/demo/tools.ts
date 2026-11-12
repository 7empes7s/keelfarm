// The demo's coding agents' models and Tools & skills (#257): a made-up model catalog and setup (its CLIs: demo/clis.ts).
import path from 'node:path';
import { HOME_DIR } from '../config.ts';
import { DEMO_PICKS } from '../demoFiles.ts';
import { buildInventory, memoryFs } from '../tooling.ts';
import { mergeCatalog } from '../../shared/models.ts';
import type { ToolInventory } from '../../shared/tooling.ts';
import { registerDemo } from './registry.ts';

/** A made-up Claude Code setup, read by the real inventory parser from files in memory (never this computer's ~/.claude). */
function demoTooling(projects: string[]): ToolInventory {
  const home = path.join(HOME_DIR, 'demo-claude');
  const plugin = (name: string, description: string, opts: { skills?: [string, string][]; commands?: string[]; mcp?: Record<string, unknown> }) => {
    const dir = path.join(home, 'plugins', 'cache', 'claude-plugins-official', name, '1.0.0');
    const files: Record<string, string> = { [path.join(dir, '.claude-plugin', 'plugin.json')]: JSON.stringify({ name, description }) };
    for (const [s, d] of opts.skills ?? []) files[path.join(dir, 'skills', s, 'SKILL.md')] = `---\nname: ${s}\ndescription: ${d}\n---\n`;
    for (const c of opts.commands ?? []) files[path.join(dir, 'commands', `${c}.md`)] = `# ${c}`;
    if (opts.mcp) files[path.join(dir, '.mcp.json')] = JSON.stringify({ mcpServers: opts.mcp });
    return { dir, files };
  };
  const plugins = {
    canva: plugin('canva', 'Create and edit Canva designs from Claude Code.', { skills: [['brand-check', 'Checks a design against the brand kit.'], ['resize-for-social-media', 'Resizes a design for each social network.']], mcp: { canva: { type: 'http', url: 'https://mcp.canva.com/mcp' } } }),
    superpowers: plugin('superpowers', 'Skills for planning, test-driven development and debugging.', { skills: [['brainstorming', 'Use before any creative work: explores intent before building.'], ['test-driven-development', 'Write the failing test first, then the code.'], ['systematic-debugging', 'Find the root cause before proposing fixes.']] }),
    github: plugin('github', 'GitHub issues, pull requests and Actions through GitHub’s MCP server.', { mcp: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer demo-not-a-real-token' } } } }),
    'commit-commands': plugin('commit-commands', 'Commit, push and open a PR in one command.', { commands: ['commit', 'commit-push-pr', 'clean_gone'] }),
    'code-review': plugin('code-review', 'Reviews a diff for bugs and project conventions.', { skills: [['code-review', 'Reviews the current diff at a chosen effort.']] }),
    figma: plugin('figma', 'Turn Figma designs into code.', { skills: [['figma-design-to-code', 'Implements a Figma frame as components.']], mcp: { figma: { type: 'http', url: 'https://mcp.figma.com/mcp' } } }),
  };
  const files: Record<string, string> = Object.assign({}, ...Object.values(plugins).map((p) => p.files));
  files[path.join(home, 'skills', 'pdf', 'SKILL.md')] = '---\nname: pdf\ndescription: Reads, fills and merges PDF files.\n---\n';
  files[path.join(home, 'skills', 'release-notes', 'SKILL.md')] = '---\nname: release-notes\ndescription: Writes release notes from merged pull requests.\n---\n';
  const global = path.join(home, '.claude.json');
  files[global] = JSON.stringify({
    mcpServers: {
      notion: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'demo-secret-never-shown' } },
      linear: { type: 'http', url: 'https://mcp.linear.app/mcp?key=demo-secret-never-shown' },
    },
    claudeAiMcpEverConnected: ['claude.ai Gmail', 'claude.ai Google Drive', 'claude.ai Vercel'],
  });
  if (projects[0]) files[path.join(projects[0], '.mcp.json')] = JSON.stringify({ mcpServers: { sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp' } } });
  const pluginList = Object.entries(plugins).map(([name, p]) => ({ id: `${name}@claude-plugins-official`, enabled: name !== 'figma', installPath: p.dir, version: '1.0.0' }));
  const items = buildInventory(memoryFs(files), { configDir: home, globalConfig: global, projects, pluginList });
  return { items, scannedAt: Date.now(), scanning: false, error: null, via: 'the demo’s made-up setup' };
}

/**
 * The model catalog, made up (#198): Anthropic's list, Codex's, OpenCode's and an Ollama with one model;
 * SWARM_DEMO_MODELS=fail shows Claude Code's built-in list, as when its login can't read Anthropic's.
 */
export function demoCatalog(now: number) {
  const claude = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5'].map((id) => ({ id }));
  return mergeCatalog(
    [
      { cli: 'claude', models: process.env.SWARM_DEMO_MODELS === 'fail' ? null : claude },
      { cli: 'codex', models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', isDefault: true }, { id: 'gpt-6-astra', name: 'GPT-6-Astra' }, { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' }] },
      { cli: 'opencode', models: [{ id: 'anthropic/claude-opus-5-5' }, { id: 'openai/gpt-6.1-sol' }, { id: 'opencode/big-pickle' }] },
      { local: 'ollama', models: ['qwen3-coder:30b'] },
    ],
    now,
  );
}

registerDemo('tools', () => ({
  quickPicks: async () => DEMO_PICKS,
  toolInventory: async (projects) => demoTooling(projects),
  modelCatalog: async () => demoCatalog(Date.now()),
}));
