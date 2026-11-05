// The demo's permission prompts and questions, answered by the office the way it answers a real session's (#54).
import path from 'node:path';
import type { LogEntry } from './agentRunner.ts';
import { answerHook } from './unblock.ts';

/**
 * The prompts a real session can raise, answered by the office exactly as it answers them there (unblock.ts): a
 * write to a folder Claude Code guards (a skill in the worktree's .claude) and a question nobody is there to answer.
 */
export function demoPrompts(cwd: string): LogEntry[] {
  const asks = [
    { hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: path.join(cwd, '.claude', 'skills', 'release', 'SKILL.md') } },
    { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Should the badge be red or blue?' }] } },
  ];
  return asks.flatMap((b) => {
    const a = answerHook(b, [cwd]);
    return a ? [{ kind: 'system' as const, text: a.note }] : [];
  });
}
