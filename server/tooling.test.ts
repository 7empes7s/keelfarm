import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInventory, frontMatter, maskServer, mcpKey, memoryFiles, memoryFs, parsePluginList, pluginsFromFiles } from './tooling.ts';

const home = path.resolve('/home/me/.claude');
const plug = path.join(home, 'plugins', 'cache', 'official', 'canva', '1.0.0');
const project = path.resolve('/work/app');

const files = {
  [path.join(plug, '.claude-plugin', 'plugin.json')]: JSON.stringify({ name: 'canva', description: 'Design with Canva.', mcpServers: './mcp.json' }),
  [path.join(plug, 'mcp.json')]: JSON.stringify({ mcpServers: { canva: { type: 'http', url: 'https://mcp.canva.com/mcp?key=SECRET1', headers: { Authorization: 'Bearer SECRET2' } } } }),
  [path.join(plug, 'skills', 'brand-check', 'SKILL.md')]: '---\nname: brand-check\ndescription: "Checks a design against the brand kit."\n---\n# Brand',
  [path.join(plug, 'commands', 'resize.md')]: '# resize',
  [path.join(home, 'plugins', 'installed_plugins.json')]: JSON.stringify({ version: 2, plugins: { 'canva@official': [{ installPath: plug, version: '1.0.0' }], 'old@official': [{ installPath: '/nowhere', version: '0.1' }] } }),
  [path.join(home, 'settings.json')]: JSON.stringify({ enabledPlugins: { 'canva@official': true, 'old@official': false } }),
  [path.join(home, 'skills', 'pdf', 'SKILL.md')]: '---\nname: pdf\ndescription: Reads and fills PDF forms.\n---\n',
  [path.resolve('/home/me/.claude.json')]: JSON.stringify({
    mcpServers: { notion: { command: '/usr/bin/npx', args: ['-y', '@notion/mcp', '--api-key', 'SECRET3', 'TOKEN=SECRET4'], env: { NOTION_TOKEN: 'SECRET5' } } },
    projects: { [project]: { mcpServers: { db: { command: 'pg-mcp', env: { PGPASSWORD: 'SECRET6' } } } } },
    claudeAiMcpEverConnected: ['claude.ai Gmail', 'claude.ai Windsor.ai', 42],
  }),
  [path.join(project, '.mcp.json')]: JSON.stringify({ mcpServers: { sentry: { type: 'sse', url: 'https://user:SECRET7@sentry.io/mcp' } } }),
  [path.join(project, '.claude', 'skills', 'deploy', 'SKILL.md')]: '---\nname: deploy\ndescription: Ships it.\n---\n',
};

const scan = (pluginList: ReturnType<typeof parsePluginList> | null) =>
  buildInventory(memoryFs(files), { configDir: home, globalConfig: path.resolve('/home/me/.claude.json'), projects: [project], pluginList });

describe('the inventory', () => {
  it('lists plugins with their skills, commands and MCP servers, from the files when the CLI cannot say', () => {
    const items = scan(null);
    const canva = items.find((i) => i.id === 'plugin:canva@official')!;
    expect(canva).toMatchObject({ kind: 'plugin', name: 'canva', description: 'Design with Canva.', source: 'official · v1.0.0' });
    expect(canva.contents).toEqual({ skills: ['canva:brand-check'], commands: ['/canva:resize'], agents: [], mcp: ['canva'] });
    expect(canva.cost?.tools).toBe(2);
    expect(canva.locks).toBeUndefined();
    expect(items.find((i) => i.id === 'mcp:plugin_canva_canva')).toMatchObject({ kind: 'mcp', plugin: 'plugin:canva@official', source: 'plugin canva' });
    expect(items.find((i) => i.id === 'plugin:old@official')?.locks?.agent?.on).toBe(false);
  });

  it('takes plugins and their resolved servers from claude plugin list --json', () => {
    const list = parsePluginList([{ id: 'canva@official', enabled: false, installPath: plug, version: '1.0.0', mcpServers: { design: { command: 'canva-mcp' } } }, { nope: 1 }]);
    expect(list).toHaveLength(1);
    const items = scan(list);
    expect(items.find((i) => i.id === 'plugin:canva@official')?.locks?.ceo?.on).toBe(false);
    expect(items.some((i) => i.id === 'mcp:plugin_canva_design')).toBe(true);
    expect(items.some((i) => i.id === 'plugin:old@official')).toBe(false);
  });

  it('lists standalone skills and MCP servers from user, project and local config, and the office’s own', () => {
    const ids = scan(null).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['skill:pdf', 'skill:deploy', 'mcp:notion', 'mcp:db', 'mcp:sentry', 'mcp:office', 'mcp:playwright', 'tool:WebFetch']));
    expect(scan(null).find((i) => i.id === 'skill:pdf')).toMatchObject({ source: 'user', description: 'Reads and fills PDF forms.' });
  });

  it('lists the claude.ai connectors Claude Code ever connected, named as their tools are', () => {
    const connectors = scan(null).filter((i) => i.source === 'claude.ai');
    expect(connectors.map((i) => [i.id, i.name])).toEqual([
      ['mcp:claude_ai_Gmail', 'Gmail'],
      ['mcp:claude_ai_Windsor_ai', 'Windsor.ai'],
    ]);
  });

  it('never shows a secret from an MCP config', () => {
    const text = JSON.stringify(scan(null));
    for (let n = 1; n <= 7; n++) expect(text).not.toContain(`SECRET${n}`);
    const items = scan(null);
    expect(items.find((i) => i.id === 'mcp:notion')?.detail).toBe('stdio npx -y @notion/mcp --api-key •••• •••• · env: NOTION_TOKEN');
    expect(items.find((i) => i.id === 'mcp:plugin_canva_canva')?.detail).toBe('http https://mcp.canva.com/mcp · headers: Authorization');
    expect(items.find((i) => i.id === 'mcp:sentry')?.detail).toBe('sse https://sentry.io/mcp');
  });
});

describe('memory files (#50)', () => {
  it("finds the user's CLAUDE.md and each folder's from the root down to the session's", () => {
    const fs = memoryFs({
      [path.join(home, 'CLAUDE.md')]: 'user rules',
      [path.resolve('/work/CLAUDE.md')]: 'abc',
      [path.resolve('/work/shop/CLAUDE.md')]: 'shop rules',
      [path.resolve('/work/shop/.claude/CLAUDE.md')]: 'more',
      [path.resolve('/work/shop/src/CLAUDE.md')]: 'only when reading src',
    });
    expect(memoryFiles(fs, path.resolve('/work/shop'), home)).toEqual([
      { file: path.join(home, 'CLAUDE.md'), chars: 10 },
      { file: path.resolve('/work/CLAUDE.md'), chars: 3 },
      { file: path.resolve('/work/shop/CLAUDE.md'), chars: 10 },
      { file: path.resolve('/work/shop/.claude/CLAUDE.md'), chars: 4 },
    ]);
  });
});

describe('helpers', () => {
  it("names a server's tools the way Claude Code does", () => {
    expect(mcpKey('notion')).toBe('notion');
    expect(mcpKey('google calendar', 'design')).toBe('plugin_design_google_calendar');
    expect(mcpKey('chrome-devtools', 'chrome-devtools-mcp')).toBe('plugin_chrome-devtools-mcp_chrome-devtools');
  });

  it('reads front matter, quoted or not', () => {
    expect(frontMatter('---\nname: a\ndescription: "Does b."\n---\nbody')).toEqual({ name: 'a', description: 'Does b.' });
    expect(frontMatter('no front matter')).toEqual({ name: '', description: '' });
  });

  it('masks long tokens passed as arguments', () => {
    expect(maskServer({ command: 'x', args: ['abcdefghijklmnopqrstuvwxyz0123456789ABCD'] })).toBe('stdio x ••••');
    // only flags and package names show: scripts, paths and values don't
    expect(maskServer({ command: 'node', args: ['-e', "require('x')", '/home/me/key.json', 'chrome-devtools-mcp@1.11.0'] })).toBe('stdio node -e •••• •••• chrome-devtools-mcp@1.11.0');
    expect(maskServer({ type: 'http', url: 'https://mcp.example.com/u/sk4Fq9xZr2LmN8pQw3Ty7/mcp' })).toBe('http https://mcp.example.com/u/••••/mcp');
  });

  it('reads enabled state from settings.json', () => {
    expect(pluginsFromFiles({ plugins: { 'a@m': [{ installPath: '/a' }] } }, { enabledPlugins: { 'a@m': true } })[0]).toMatchObject({ id: 'a@m', enabled: true, installPath: '/a' });
    expect(pluginsFromFiles({ plugins: { 'a@m': { installPath: '/a' } } }, {})[0].enabled).toBe(false);
  });
});
