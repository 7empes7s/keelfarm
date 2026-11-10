import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { builtInPrefs, claudeSeed, mergeClaudeConfig, prepareLogin, trustCodexToml } from './cliSetup.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-clisetup-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const desk = path.join(tmp, 'machines', 'm1', 'work', 'acme__web');

describe('mergeClaudeConfig', () => {
  const existing = { oauthAccount: { emailAddress: 'a@b.c' }, theme: 'light', userID: 'u1', projects: { '/old': { allowedTools: ['x'], hasTrustDialogAccepted: false } } };

  it('marks onboarding done on the CLI version and trusts the worktree, keeping every key there', () => {
    const c = mergeClaudeConfig(existing, claudeSeed([desk], '2.1.3'));
    expect(c).toMatchObject({ oauthAccount: { emailAddress: 'a@b.c' }, userID: 'u1', theme: 'light', hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.3' });
    expect(c.projects).toEqual({ '/old': { allowedTools: ['x'], hasTrustDialogAccepted: false }, [desk]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } });
  });

  it('is idempotent', () => {
    const once = mergeClaudeConfig(existing, claudeSeed([desk], '2.1.3'));
    expect(mergeClaudeConfig(once, claudeSeed([desk], '2.1.3'))).toEqual(once);
  });

  it("adds trust for a new path, keeps a project's own keys, and doesn't change the input", () => {
    const before = JSON.parse(JSON.stringify(existing));
    const c = mergeClaudeConfig(existing, claudeSeed(['/old', '/new'], null));
    expect((c.projects as Record<string, unknown>)['/old']).toEqual({ allowedTools: ['x'], hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true });
    expect((c.projects as Record<string, unknown>)['/new']).toEqual({ hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true });
    expect(c).not.toHaveProperty('lastOnboardingVersion');
    expect(existing).toEqual(before);
  });

  it("gives a fresh config the built-in login's theme (else dark), never its secrets", () => {
    expect(mergeClaudeConfig(null, claudeSeed([], null)).theme).toBe('dark');
    const c = mergeClaudeConfig({}, claudeSeed([], null, { theme: 'light-daltonized', editorMode: 'vim' }));
    expect(c).toMatchObject({ theme: 'light-daltonized', editorMode: 'vim', hasCompletedOnboarding: true });
  });
});

describe('trustCodexToml', () => {
  it('adds a trusted project table, keeping every other line', () => {
    const text = 'model = "gpt-5"\n\n[mcp_servers.x]\ncommand = "x"\n';
    const out = trustCodexToml(text, [desk]);
    expect(out.startsWith(text)).toBe(true);
    expect(out).toContain(`[projects.${JSON.stringify(desk)}]\ntrust_level = "trusted"\n`);
    expect(trustCodexToml(out, [desk])).toBe(out);
  });

  it("sets trust on a table that's there without touching its other keys or the next table", () => {
    const text = `[projects.${JSON.stringify(desk)}]\ntrust_level = "untrusted"\nfoo = 1\n\n[other]\ntrust_level = "x"\n`;
    expect(trustCodexToml(text, [desk])).toBe(`[projects.${JSON.stringify(desk)}]\ntrust_level = "trusted"\nfoo = 1\n\n[other]\ntrust_level = "x"\n`);
    const bare = `[projects.${JSON.stringify(desk)}]\nfoo = 1\n`;
    expect(trustCodexToml(bare, [desk])).toBe(`[projects.${JSON.stringify(desk)}]\ntrust_level = "trusted"\nfoo = 1\n`);
  });

  it('writes a Windows path as a valid TOML string', () => {
    expect(trustCodexToml('', ['C:\\Users\\me\\desk'])).toBe('[projects."C:\\\\Users\\\\me\\\\desk"]\ntrust_level = "trusted"\n');
  });
});

describe('prepareLogin', () => {
  it("writes a login folder's .claude.json once, keeping what the CLI wrote, and leaves no temp files", () => {
    const dir = path.join(tmp, 'accounts', 'claude-two', 'claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'x@y.z' } }));
    expect(prepareLogin('claude', dir, [desk], { version: '2.1.3' })).toBe(true);
    expect(prepareLogin('claude', dir, [desk], { version: '2.1.3' })).toBe(false);
    const c = JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'));
    expect(c).toMatchObject({ oauthAccount: { emailAddress: 'x@y.z' }, hasCompletedOnboarding: true });
    expect(c.projects[desk].hasTrustDialogAccepted).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(['.claude.json']);
  });

  it("creates a fresh folder's config, leaves one that isn't JSON alone, and trusts Codex's worktree", () => {
    const fresh = path.join(tmp, 'accounts', 'claude-new', 'claude');
    expect(prepareLogin('claude', fresh, [desk])).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(fresh, '.claude.json'), 'utf8')).hasCompletedOnboarding).toBe(true);
    fs.writeFileSync(path.join(fresh, '.claude.json'), '{ broken');
    expect(prepareLogin('claude', fresh, [desk])).toBe(false);
    expect(fs.readFileSync(path.join(fresh, '.claude.json'), 'utf8')).toBe('{ broken');
    const codex = path.join(tmp, 'accounts', 'codex-two', 'codex');
    expect(prepareLogin('codex', codex, [desk])).toBe(true);
    expect(fs.readFileSync(path.join(codex, 'config.toml'), 'utf8')).toContain('trust_level = "trusted"');
  });

  it("reads only the built-in login's preferences", () => {
    const file = path.join(tmp, 'builtin.json');
    fs.writeFileSync(file, JSON.stringify({ theme: 'light', oauthAccount: { emailAddress: 'me@x' }, primaryApiKey: 'sk-x' }));
    expect(builtInPrefs(file)).toEqual({ theme: 'light' });
    expect(builtInPrefs(path.join(tmp, 'missing.json'))).toEqual({});
  });
});
