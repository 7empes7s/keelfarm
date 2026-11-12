import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GEMINI_CONTEXT_FILE, geminiLimit, launchArgs, type LaunchContext } from './clis.ts';
import { geminiLoginSettings, geminiTrusted, prepareGeminiHome } from './geminiHome.ts';
import { prepareLogin } from './cliSetup.ts';
import { screenStep } from './cliScreens.ts';
import { cliEnv } from './unblock.ts';
import { accountSetup, builtInDir } from '../shared/accounts.ts';
import { detectLimit, resetTime } from '../shared/accountRotation.ts';
import { signInScreen } from '../shared/signIn.ts';
import type { ProviderAccount } from '../shared/types.ts';

// Gemini CLI as a coding agent (#365): its command line and settings, a login folder's environment and first-run
// settings, and its usage limit read from the terminal.

const sessionDir = path.join(os.tmpdir(), 'sessions', 'tok');
const ctx = (patch: Partial<LaunchContext> = {}): LaunchContext => ({
  prompt: '-starts like a flag',
  systemAppend: 'You are Ada. Office rules.',
  model: '',
  effort: 'medium',
  sessionId: 's',
  name: 'Ada',
  role: 'agent',
  additionalDirectories: [],
  files: { settings: path.join(sessionDir, 'settings.json'), mcp: null, system: path.join(sessionDir, 'instructions.md') },
  notify: { script: path.join('/bin', 'notify.cjs'), url: 'http://127.0.0.1:1/api/hooks/t' },
  codexHook: 'codex-hook.cjs',
  plugin: 'file:///p.mjs',
  browser: null,
  ...patch,
});
const geminiLogin: ProviderAccount = { id: 'gemini-k3x9q2', cli: 'gemini', kind: 'subscription-login', label: 'Google AI Plus', tags: [], priority: 0, enabled: true };

describe("Gemini CLI's command line", () => {
  it("runs it without approvals or the trust question, the prompt as one argument, the office's settings and instructions in its session folder", () => {
    const { args, env, write } = launchArgs('gemini', ctx());
    expect(args).toEqual(['--approval-mode', 'yolo', '--skip-trust', '--prompt-interactive=-starts like a flag']);
    expect(env).toEqual({ GEMINI_CLI_SYSTEM_SETTINGS_PATH: path.join(sessionDir, 'gemini-settings.json'), CUBEFARM_HOOK_URL: 'http://127.0.0.1:1/api/hooks/t' });
    const files = new Map(write);
    expect(files.get(path.join(sessionDir, GEMINI_CONTEXT_FILE))).toBe('You are Ada. Office rules.');
    const settings = JSON.parse(files.get(path.join(sessionDir, 'gemini-settings.json'))!);
    expect(settings.context).toEqual({ fileName: ['GEMINI.md', 'AGENTS.md', 'CLAUDE.md', GEMINI_CONTEXT_FILE], includeDirectories: [sessionDir], loadMemoryFromIncludeDirectories: true });
    expect(Object.keys(settings.hooks)).toEqual(['BeforeTool', 'AfterTool', 'AfterAgent']);
    expect(settings.hooks.AfterAgent[0].hooks[0]).toMatchObject({ type: 'command', command: expect.stringContaining(path.join('/bin', 'gemini-hook.cjs')) });
    expect(settings.general).toEqual({ enableAutoUpdate: false, enableAutoUpdateNotification: false });
    expect(settings.mcpServers).toBeUndefined();
  });

  it('resumes its session, takes only a Gemini model, and gets the browser as an MCP server', () => {
    const { args, write } = launchArgs('gemini', ctx({ resumeId: 'abc-123', model: 'gemini-3-pro', browser: { command: 'npx', args: ['@playwright/mcp'] } }));
    expect(args).toEqual(['--approval-mode', 'yolo', '--skip-trust', '--model', 'gemini-3-pro', '--resume', 'abc-123', '--prompt-interactive=-starts like a flag']);
    expect(JSON.parse(new Map(write).get(path.join(sessionDir, 'gemini-settings.json'))!).mcpServers).toEqual({ playwright: { command: 'npx', args: ['@playwright/mcp'] } });
    expect(launchArgs('gemini', ctx({ model: 'claude-opus-5-5' })).args).not.toContain('--model');
  });

  it("runs on an account's own login folder, with no Anthropic or Claude variables", () => {
    const dir = path.join(os.tmpdir(), 'accounts', geminiLogin.id, 'gemini');
    const setup = accountSetup(geminiLogin, dir, '');
    expect(setup).toEqual({ env: { GEMINI_CLI_HOME: dir }, keyEnv: null });
    const env = cliEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant-x', CLAUDE_CODE_OAUTH_TOKEN: 't' }, launchArgs('gemini', ctx()).env, { machine: setup.env });
    expect(env).toMatchObject({ PATH: '/bin', GEMINI_CLI_HOME: dir, CUBEFARM_HOOK_URL: 'http://127.0.0.1:1/api/hooks/t' });
    expect(Object.keys(env).filter((k) => /^(ANTHROPIC_|CLAUDE)/.test(k))).toEqual([]);
    expect(builtInDir(path.join, 'gemini', {}, '/home/m')).toBe('/home/m');
    expect(builtInDir(path.join, 'gemini', { GEMINI_CLI_HOME: '/g' }, '/home/m')).toBe('/g');
  });
});

describe("a Gemini login folder's first-run settings", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-gemini-'));
  afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

  it('picks the Google sign-in and turns auto-update off, keeping every key already there', () => {
    expect(JSON.parse(geminiLoginSettings('')!)).toEqual({ security: { auth: { selectedType: 'oauth-personal' } }, general: { enableAutoUpdate: false, enableAutoUpdateNotification: false } });
    const own = { ui: { theme: 'GitHub' }, security: { auth: { selectedType: 'gemini-api-key' }, folderTrust: { enabled: true } }, general: { enableAutoUpdate: true } };
    expect(JSON.parse(geminiLoginSettings(JSON.stringify(own))!)).toEqual({ ...own, general: { enableAutoUpdate: true, enableAutoUpdateNotification: false } });
  });

  it("leaves a complete file alone, and one that isn't plain JSON", () => {
    expect(geminiLoginSettings(geminiLoginSettings('')!)).toBeNull();
    expect(geminiLoginSettings('{ // a comment\n}')).toBeNull();
    expect(geminiLoginSettings('[]')).toBeNull();
  });

  it("trusts the session's worktree, keeping the folders already trusted or not", () => {
    const own = JSON.stringify({ '/home/m/code': 'TRUST_PARENT', '/tmp/x': 'DO_NOT_TRUST' });
    expect(JSON.parse(geminiTrusted(own, ['/w/desk'])!)).toEqual({ '/home/m/code': 'TRUST_PARENT', '/tmp/x': 'DO_NOT_TRUST', '/w/desk': 'TRUST_FOLDER' });
    expect(geminiTrusted(geminiTrusted('', ['/w/desk'])!, ['/w/desk'])).toBeNull();
    expect(geminiTrusted('not json', ['/w/desk'])).toBeNull();
  });

  it("is what an account's login folder gets before each session (#360's prepareLogin)", () => {
    const login = path.join(home, 'login');
    const desk = path.join(home, 'desk');
    expect(prepareLogin('gemini', login, [desk])).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(login, '.gemini', 'trustedFolders.json'), 'utf8'))).toEqual({ [desk]: 'TRUST_FOLDER' });
    expect(prepareLogin('gemini', login, [desk])).toBe(false); // already set up
  });

  it('writes them into <GEMINI_CLI_HOME>/.gemini/settings.json', () => {
    prepareGeminiHome(home);
    const file = path.join(home, '.gemini', 'settings.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).security.auth.selectedType).toBe('oauth-personal');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { mine: { command: 'x' } }, security: { auth: { selectedType: 'oauth-personal' } } }));
    prepareGeminiHome(home);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ mcpServers: { mine: { command: 'x' } }, general: { enableAutoUpdate: false } });
  });
});

describe("Gemini CLI's usage limit", () => {
  const now = new Date(2026, 10, 10, 12, 0).getTime();

  it('reads its limit screen, with the menu that would wait forever, and when access is back', () => {
    const screen = ['╭──────╮', '│ ✕ Usage limit reached for gemini-3-pro.', '│ Access resets at 4:15 PM UTC.', '│ /stats model for usage details', '│ /model to switch models.', '│ ● 1. Switch to gemini-3-flash', '│   2. Stop'].join('\n');
    expect(geminiLimit(screen, now)).toEqual({ line: 'Usage limit reached for gemini-3-pro.', until: new Date(2026, 10, 10, 16, 15).getTime() });
  });

  it("doesn't take a file that quotes the words for the limit", () => {
    expect(geminiLimit("expect(text).toMatch('Usage limit reached for gemini-3-pro')", now)).toBeNull();
    expect(geminiLimit('● Done: all tests pass.', now)).toBeNull();
  });

  it('marks the account limited from its quota errors, until the reset they name', () => {
    expect(detectLimit('You have exhausted your capacity on this model. Your quota will reset after 19h14m47s.', now)).toEqual({ kind: 'limited', until: now + (19 * 3600 + 14 * 60 + 47) * 1000 });
    expect(detectLimit('Gemini CLI stopped: Usage limit reached for gemini-3-pro.', now)).toMatchObject({ kind: 'limited' });
    expect(resetTime('Quota exceeded for metric … Please retry in 44.5s.', now)).toBe(now + 44_500);
    expect(resetTime('Please retry in 900.2ms', now)).toBe(now + 901);
  });
});

describe("Gemini CLI's sign-in", () => {
  it("ends a session that opens on its sign-in: only the manager can sign it in", () => {
    const menu = ['How would you like to authenticate for this project?', '', '● 1. Sign in with Google', '  2. Use Gemini API Key', '  3. Vertex AI'].join('\n');
    expect(screenStep(menu, 'gemini')).toEqual({ do: 'sign-in' });
    expect(screenStep('  Waiting for authentication... (Press Esc or Ctrl+C to cancel)', 'gemini')).toEqual({ do: 'sign-in' });
    expect(screenStep('● Wrote docs/accounts.md', 'gemini')).toBeNull();
  });

  it('waits for the code at its prompt, and reads a failed code', () => {
    const start = '── Signing Gemini CLI in ──';
    const asked = [start, 'Please visit the following URL to authorize the application:', '', 'https://accounts.google.com/o/oauth2/v2/auth?x=1', '', 'Enter the authorization code: '].join('\n');
    expect(signInScreen(asked)).toMatchObject({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', waiting: true, result: null });
    expect(signInScreen(`${asked}\nFailed to authenticate with user code.`).result).toBe('failed');
    // A wrong code (Gemini CLI 0.68): it says it retries and asks again with a new link (#540).
    const again = signInScreen(`${asked}\nFailed to authenticate with user code. Retrying...\nPlease visit the following URL to authorize the application:\n\nhttps://accounts.google.com/o/oauth2/v2/auth?x=2\n\nEnter the authorization code: `);
    expect(again).toMatchObject({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=2', waiting: true, result: null });
  });
});
