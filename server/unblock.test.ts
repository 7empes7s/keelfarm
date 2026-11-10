import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchArgs, type LaunchContext } from './clis.ts';
import { ANSWER_AFTER_MS, answerHook, blockedNotice, cliEnv, DEFAULT_REPLY, nonInteractiveEnv, NOTIFY_BLOCKED_MS, permissionAnswer, permissionScreen, PROTECTED_DIRS, rulePath, sessionRoots, STALL_MS, watchdogStep, worktreePermissions, type Waiting } from './unblock.ts';

const home = os.homedir();
const worktree = path.join(home, '.cubefarm', 'machines', 'm1', 'work', 'acme__shop');
const temp = path.join(home, '.cubefarm', 'machines', 'm1', 'tmp');
const roots = [worktree, temp];

describe('per-session permission rules', () => {
  it('turn a folder into a rule path on either system', () => {
    expect(rulePath('/home/a/work/shop')).toBe('//home/a/work/shop');
    expect(rulePath('/home/a/work/shop/')).toBe('//home/a/work/shop');
    expect(rulePath('C:\\Users\\A B\\work\\shop')).toBe('//c/Users/A B/work/shop');
  });

  it("allow edits in the worktree's guarded folders, and nothing outside the worktree", () => {
    const { allow } = worktreePermissions(worktree);
    const root = rulePath(worktree);
    for (const d of ['.claude', '.git']) expect(allow).toContain(`Edit(${root}/${d}/**)`);
    expect(allow).toHaveLength(PROTECTED_DIRS.length + 1);
    for (const rule of allow) expect(rule.startsWith(`Edit(${root}/`)).toBe(true);
    expect(allow.join(' ')).not.toContain(rulePath(path.join(home, '.claude')) + '/');
  });
});

describe('the non-interactive environment', () => {
  it('stops git, npm and ssh from waiting on a terminal', () => {
    expect(nonInteractiveEnv({})).toEqual({
      GIT_EDITOR: 'true',
      GIT_SEQUENCE_EDITOR: 'true',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      CI: '1',
      npm_config_yes: 'true',
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
    });
  });

  it("overrides an editor that would wait, but keeps the manager's own ssh command", () => {
    const env = nonInteractiveEnv({ GIT_EDITOR: 'vim', GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' });
    expect(env.GIT_EDITOR).toBe('true');
    expect(env.GIT_SSH_COMMAND).toBeUndefined();
    expect(nonInteractiveEnv({ GIT_SSH: 'plink' }).GIT_SSH_COMMAND).toBeUndefined();
  });
});

describe('permission answers', () => {
  it('allow writes in the worktree (guarded folders too) and the temp folder, and any other tool', () => {
    expect(permissionAnswer('Write', { file_path: path.join(worktree, '.claude', 'skills', 'x', 'SKILL.md') }, roots)).toEqual({ behavior: 'allow' });
    expect(permissionAnswer('Edit', { file_path: '.git/hooks/pre-commit' }, roots)).toEqual({ behavior: 'allow' }); // relative: in the worktree
    expect(permissionAnswer('NotebookEdit', { notebook_path: path.join(temp, 'n.ipynb') }, roots)).toEqual({ behavior: 'allow' });
    expect(permissionAnswer('Bash', { command: 'npm test' }, roots)).toEqual({ behavior: 'allow' });
  });

  it("deny writes outside the session's folders with the reason: ~/.claude, the live office, other floors' clones", () => {
    for (const file of [path.join(home, '.claude', 'settings.json'), path.join(home, 'Projects', 'keelfarm', 'server', 'swarm.ts'), path.join(home, '.cubefarm', 'machines', 'm2', 'work', 'other', 'a.ts'), path.join(worktree, '..', 'x.ts')]) {
      const a = permissionAnswer('Write', { file_path: file }, roots);
      expect(a.behavior).toBe('deny');
      expect(a.behavior === 'deny' && a.message).toContain('outside your worktree');
    }
    expect(permissionAnswer('Write', { file_path: `${worktree}-evil${path.sep}a.ts` }, roots).behavior).toBe('deny'); // a sibling with the same prefix
  });
});

describe('answerHook', () => {
  it("answers Claude Code's permission request, and says so in the feed", () => {
    const ok = answerHook({ hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: path.join(worktree, '.claude', 'skills', 'a.md') } }, roots)!;
    expect(ok.reply).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    expect(ok.note).toContain('allowed Write');
    const no = answerHook({ hook_event_name: 'PermissionRequest', tool_name: 'Edit', tool_input: { file_path: path.join(home, '.claude', 'CLAUDE.md') } }, roots)!;
    expect(no.reply.hookSpecificOutput).toMatchObject({ decision: { behavior: 'deny', message: expect.stringContaining('outside your worktree') } });
    expect(no.note).toContain('denied Edit');
  });

  it("denies writes to a linked repo's clone, though the session gets it as an additional directory", () => {
    const linked = path.join(home, '.cubefarm', 'workspaces', 'acme__api', 'main');
    const sessionDir = path.join(home, '.cubefarm', 'sessions', 't1');
    const r = sessionRoots(worktree, { TMPDIR: temp, TEMP: temp }, sessionDir);
    expect(r).toEqual([worktree, temp, temp, sessionDir]);
    for (const file of [path.join(linked, '.git', 'config'), path.join(linked, '.claude', 'settings.json'), path.join(linked, 'src', 'a.ts')]) {
      const a = answerHook({ hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: file } }, r)!;
      expect(a.reply.hookSpecificOutput).toMatchObject({ decision: { behavior: 'deny' } });
    }
    expect(answerHook({ hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: path.join(sessionDir, 'x.json') } }, r)!.note).toContain('allowed');
  });

  it('declines MCP forms and answers questions with the default reply', () => {
    expect(answerHook({ hook_event_name: 'Elicitation', mcp_server_name: 'notion' }, roots)).toEqual({ reply: { hookSpecificOutput: { hookEventName: 'Elicitation', action: 'decline' } }, note: expect.stringContaining("notion's form") });
    const q = answerHook({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: {} }, roots)!;
    expect(q.reply).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: DEFAULT_REPLY } });
  });

  it('leaves every other hook to the session', () => {
    expect(answerHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }, roots)).toBeNull();
    expect(answerHook({ hook_event_name: 'Stop' }, roots)).toBeNull();
  });
});

describe('the prompt watchdog', () => {
  const at = 1_000_000;
  const waiting = (o: Partial<Waiting> = {}): Waiting => ({ kind: 'permission', since: at, tool: 'Write', input: { file_path: path.join(worktree, 'a.ts') }, tries: 0, blocked: false, ...o });

  it('waits for the prompt to draw, then allows a permission with Enter', () => {
    expect(watchdogStep(waiting(), at + ANSWER_AFTER_MS - 1, roots)).toEqual({ do: 'wait' });
    expect(watchdogStep(waiting(), at + ANSWER_AFTER_MS, roots)).toMatchObject({ do: 'keys', keys: '\r' });
    expect(watchdogStep(waiting({ tool: '', input: {} }), at + ANSWER_AFTER_MS, roots)).toMatchObject({ do: 'keys', keys: '\r' }); // tool unknown
  });

  it('dismisses a form with Esc', () => {
    expect(watchdogStep(waiting({ kind: 'elicitation' }), at + ANSWER_AFTER_MS, roots)).toMatchObject({ do: 'keys', keys: '\x1b' });
  });

  it("doesn't press Yes on a denied write: the agent is blocked, with the reason", () => {
    const step = watchdogStep(waiting({ input: { file_path: path.join(home, '.claude', 'settings.json') } }), at + ANSWER_AFTER_MS, roots);
    expect(step).toMatchObject({ do: 'blocked', reason: expect.stringContaining('outside your worktree') });
  });

  it('reports blocked once a prompt is still there a minute after being answered', () => {
    expect(watchdogStep(waiting({ tries: 1 }), at + STALL_MS - 1, roots)).toEqual({ do: 'wait' });
    expect(watchdogStep(waiting({ tries: 1 }), at + STALL_MS, roots)).toMatchObject({ do: 'blocked' });
    expect(watchdogStep(waiting({ tries: 1, blocked: true }), at + STALL_MS * 2, roots)).toEqual({ do: 'wait' }); // said once
  });

  it("tells the manager only after five minutes blocked, and once", () => {
    const b = { reason: "a permission prompt the office couldn't answer.", since: at, told: false };
    expect(blockedNotice('Ada', b, at + NOTIFY_BLOCKED_MS - 1)).toBeNull();
    expect(blockedNotice('Ada', b, at + NOTIFY_BLOCKED_MS, 2)).toEqual({ title: 'Ada is blocked', body: "Waiting 5 minutes on a permission prompt the office couldn't answer on floor 2. Open their terminal to answer it.", who: 'Ada (floor 2)' });
    expect(blockedNotice('Ada', { ...b, told: true }, at + NOTIFY_BLOCKED_MS * 2)).toBeNull();
    expect(blockedNotice('Ada', null, at)).toBeNull();
  });

  it("recognises Claude Code's permission dialog on screen", () => {
    expect(permissionScreen('Edit file\n Do you want to make this edit to SKILL.md?\n ❯ 1. Yes\n   2. Yes, allow all edits\n   3. No')).toBe(true);
    expect(permissionScreen('● Done. Do you want to proceed with the next step?')).toBe(false);
  });
});

describe('cliEnv', () => {
  const ctx = { prompt: 'Go', systemAppend: '', model: '', effort: '', sessionId: 's', name: 'n', role: 'agent', additionalDirectories: [], files: { settings: 's.json', mcp: null, system: 'i.md' }, notify: { script: 'n.cjs', url: 'http://x' }, codexHook: 'h.cjs', plugin: 'file:///p.mjs', browser: null } satisfies LaunchContext;
  const wanted = nonInteractiveEnv({});

  it('gives every CLI, here and in a Box, an environment where nothing waits on a prompt', () => {
    for (const cli of ['claude', 'codex', 'opencode', 'gemini'] as const) {
      const launch = launchArgs(cli, ctx).env;
      expect(cliEnv({ PATH: '/bin', GIT_EDITOR: 'vim' }, launch, { machine: { TMPDIR: '/t' } })).toMatchObject({ ...wanted, PATH: '/bin', TMPDIR: '/t' });
      expect(cliEnv({ PATH: '/bin' }, launch, { box: { CLAUDE_CODE_OAUTH_TOKEN: 'x' } })).toMatchObject(wanted);
    }
  });

  it("drops the office's API keys and Claude variables here, and its whole environment in a Box", () => {
    const env = cliEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'k', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/c' }, {}, {});
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe('/c');
    expect(cliEnv({ PATH: '/bin', SECRET: 's' }, {}, { box: {} }).SECRET).toBeUndefined();
  });
});
