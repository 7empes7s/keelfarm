import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { builtInPrefs, claudeSeed, CODEX_OFFICE_MARK, codexHookTrust, mergeClaudeConfig, prepareCodexSession, prepareLogin, readyCodexSession, trustCodexHooksToml, trustCodexToml } from './cliSetup.ts';

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

// ---------- Codex's trust for the office's own session hooks (#638) ----------

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Interrupt'];
const HOOK_CMD = "'/root/.local/node22/bin/node' '/x/codex-hook.cjs'";
// What Codex 0.166.0's own `codex app-server` hooks/list reported for these -c hooks (timeout=10): key, currentHash.
const CODEX_0166: Record<string, string> = {
  '/<session-flags>/config.toml:session_start:0:0': 'sha256:e71769935971577b8aa168898f7c1f9c6e275380f0165267f93692cf52f7ebde',
  '/<session-flags>/config.toml:user_prompt_submit:0:0': 'sha256:2c6528d1c7294e1dbb36f2290de348175dbcfb0dc220d84646f490ba16718b9a',
  '/<session-flags>/config.toml:pre_tool_use:0:0': 'sha256:144981477d98e2cb9ab1ed92afd7d53760188f003cb687d7382c162067c22068',
  '/<session-flags>/config.toml:post_tool_use:0:0': 'sha256:53e57615194e6213f32b6d9e5c06fdb2c3327618547e099785a26ab3cb3c2b34',
  '/<session-flags>/config.toml:interrupt:0:0': 'sha256:30f11b36296fb61436e2a88deb7c2ef52fd694e067629e55a2e162a4f24ef3b3', // its timeout clamped to 3 s
};
const hooks = codexHookTrust(HOOK_CMD, EVENTS, 10, false);
const read = (f: string) => fs.readFileSync(f, 'utf8');

describe('codexHookTrust', () => {
  it("gives the keys and hashes the installed Codex computes for the office's session hooks", () => {
    expect(Object.fromEntries(hooks.map((h) => [h.key, h.hash]))).toEqual(CODEX_0166);
  });

  it("changes the hash with the hook's command, and keys Windows sessions on Codex's own spelling", () => {
    const other = codexHookTrust("'/usr/bin/node' '/x/codex-hook.cjs'", EVENTS, 10, false);
    expect(other.map((h) => h.key)).toEqual(hooks.map((h) => h.key));
    expect(other.every((h, i) => h.hash !== hooks[i].hash)).toBe(true);
    expect(codexHookTrust('node "C:\\x\\codex-hook.cjs"', ['PreToolUse'], 10, true)[0].key).toBe('C:\\<session-flags>\\config.toml:pre_tool_use:0:0');
  });
});

describe('trustCodexHooksToml', () => {
  const header = (k: string) => `[hooks.state.${JSON.stringify(k)}]`;
  const pre = hooks[2];

  it('trusts each office hook under its mark, keeping every other line, and is idempotent', () => {
    const text = 'model = "gpt-5"\n\n[[hooks.PreToolUse]]\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "mine"\n';
    const r = trustCodexHooksToml(text, hooks)!;
    expect(r.foreign).toEqual([]);
    expect(r.text.startsWith(text)).toBe(true);
    expect(r.text).toContain(`${CODEX_OFFICE_MARK}\n${header(pre.key)}\ntrusted_hash = "${pre.hash}"\n`);
    expect(trustCodexHooksToml(r.text, hooks)!.text).toBe(r.text);
  });

  it("renews a stale hash the office wrote, but never one it didn't", () => {
    const stale = `${CODEX_OFFICE_MARK}\n${header(pre.key)}\ntrusted_hash = "sha256:old"\nenabled = true\n\n[other]\nx = 1\n`;
    expect(trustCodexHooksToml(stale, [pre])).toEqual({ text: `${CODEX_OFFICE_MARK}\n${header(pre.key)}\ntrusted_hash = "${pre.hash}"\nenabled = true\n\n[other]\nx = 1\n`, foreign: [] });
    const theirs = `${header(pre.key)}\ntrusted_hash = "sha256:theirs"\n`;
    expect(trustCodexHooksToml(theirs, [pre])).toEqual({ text: theirs, foreign: [pre.key] });
    const same = `${header(pre.key)}\ntrusted_hash = "${pre.hash}"\n`; // the manager trusted this very hook in /hooks
    expect(trustCodexHooksToml(same, [pre])).toEqual({ text: same, foreign: [] });
  });

  it("leaves other hooks' trust alone, and a hook the manager turned off stays off", () => {
    const repo = `${header('/repo/.codex/hooks.json:pre_tool_use:0:0')}\ntrusted_hash = "sha256:r"\n`;
    const off = `${header(pre.key)}\nenabled = false\n`;
    const r = trustCodexHooksToml(repo + off, [pre])!;
    expect(r.text).toContain(repo);
    expect(r.text).toContain(`${CODEX_OFFICE_MARK}\n${header(pre.key)}\ntrusted_hash = "${pre.hash}"\nenabled = false\n`);
  });

  it("refuses a hooks state it can't edit safely (inline or dotted), rather than writing a config Codex can't read", () => {
    expect(trustCodexHooksToml('[hooks]\nstate = { }\n', hooks)).toBeNull();
    expect(trustCodexHooksToml('[hooks]\nstate."k".trusted_hash = "x"\n', hooks)).toBeNull();
    expect(trustCodexHooksToml('hooks.state."k".trusted_hash = "x"\n', hooks)).toBeNull();
    expect(trustCodexHooksToml('[hooks.state]\n"k" = { trusted_hash = "x" }\n', hooks)).toBeNull();
    expect(trustCodexHooksToml('hooks = { }\n', hooks)).toBeNull();
  });
});

describe('prepareCodexSession', () => {
  it("readies a fresh home for a worktree reached through a link: its real path trusted too, the office's hooks trusted", () => {
    const home = path.join(tmp, 'codex-fresh');
    const real = path.join(tmp, 'disk2', 'acme__web');
    fs.mkdirSync(real, { recursive: true });
    const link = path.join(tmp, 'linked');
    fs.symlinkSync(path.join(tmp, 'disk2'), link, 'junction');
    const wt = path.join(link, 'acme__web');
    const r = prepareCodexSession(home, [wt], hooks);
    expect(r).toEqual({ changed: true, hooksTrusted: true, problem: null });
    const text = read(path.join(home, 'config.toml'));
    expect(text).toContain(`[projects.${JSON.stringify(wt)}]`);
    expect(text).toContain(`[projects.${JSON.stringify(fs.realpathSync.native(wt))}]`);
    for (const h of hooks) expect(text).toContain(`trusted_hash = "${h.hash}"`);
    expect(prepareCodexSession(home, [wt], hooks)).toEqual({ changed: false, hooksTrusted: true, problem: null });
    expect(fs.readdirSync(home)).toEqual(['config.toml']);
  });

  it("keeps the config and hooks there, and says so when it can't trust the office's hooks", () => {
    const home = path.join(tmp, 'codex-kept');
    fs.mkdirSync(home, { recursive: true });
    const mine = `model = "o9"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "mine"\n\n[hooks.state.${JSON.stringify(hooks[0].key)}]\ntrusted_hash = "sha256:theirs"\n`;
    fs.writeFileSync(path.join(home, 'config.toml'), mine);
    const r = prepareCodexSession(home, [desk], hooks);
    expect(r.hooksTrusted).toBe(false);
    expect(r.problem).toMatch(/session_start/);
    const text = read(path.join(home, 'config.toml'));
    expect(text.startsWith(mine)).toBe(true);
    expect(text).toContain(`trusted_hash = "${hooks[2].hash}"`); // the others are still trusted
    fs.writeFileSync(path.join(home, 'config.toml'), '[hooks]\nstate = { }\n');
    expect(prepareCodexSession(home, [desk], hooks)).toMatchObject({ hooksTrusted: false, problem: expect.stringMatching(/hooks state/) });
    expect(read(path.join(home, 'config.toml'))).toContain(`[projects.${JSON.stringify(desk)}]`); // the worktree is still trusted
  });

  it('loses no write when several office processes ready the same home at once', async () => {
    const home = path.join(tmp, 'codex-race');
    const dirs = Array.from({ length: 4 }, (_, i) => path.join(tmp, `race-${i}`));
    const script = `import { prepareCodexSession, codexHookTrust } from ${JSON.stringify(new URL('./cliSetup.ts', import.meta.url).href)};
for (let i = 0; i < 20; i++) prepareCodexSession(process.argv[1], [process.argv[2] + '-' + i], codexHookTrust('x', ['PreToolUse'], 10, false));`;
    await Promise.all(dirs.map((d) => new Promise<void>((ok, fail) => {
      const c = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, home, d], { stdio: 'inherit' });
      c.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`exit ${code}`))));
    })));
    const text = read(path.join(home, 'config.toml'));
    for (const d of dirs) for (let i = 0; i < 20; i++) expect(text).toContain(`[projects.${JSON.stringify(`${d}-${i}`)}]`);
    expect(text.match(/\[hooks\.state\./g)).toHaveLength(1);
    expect(fs.readdirSync(home)).toEqual(['config.toml']);
  }, 30_000);
});

describe('readyCodexSession', () => {
  it("readies the session's own Codex home once and says so, and the office's hooks count as trusted", () => {
    const home = path.join(tmp, 'codex-session');
    const first = readyCodexSession(hooks, { CODEX_HOME: home }, desk, 'Ada');
    expect(first).toEqual({ officeHooksTrusted: true, line: { kind: 'system', text: expect.stringMatching(/^✓ Ada's Codex is ready: this worktree and the office's 5 hooks trusted/) } });
    expect(readyCodexSession(hooks, { CODEX_HOME: home }, desk, 'Ada')).toEqual({ officeHooksTrusted: true, line: null });
  });

  it("says what to do when it can't trust the office's hooks, and leaves them to the manager rather than skipping them", () => {
    const home = path.join(tmp, 'codex-odd');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'config.toml'), 'hooks = { }\n');
    const r = readyCodexSession(hooks, { CODEX_HOME: home }, desk, 'Ada');
    expect(r.officeHooksTrusted).toBe(false);
    expect(r.line).toMatchObject({ kind: 'error', text: expect.stringMatching(/couldn't trust its own Codex hooks.*\/hooks/) });
    expect(readyCodexSession(undefined, { CODEX_HOME: home }, desk, 'Ada')).toEqual({ officeHooksTrusted: false, line: null }); // not Codex
  });
});
