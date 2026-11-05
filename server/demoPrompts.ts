// The demo's permission prompts and questions, answered by the office the way it answers a real session's (#54).
import path from 'node:path';
import type { LogEntry } from './agentRunner.ts';
import { answerHook } from './unblock.ts';

/** The prompt a fake session is blocked on now and then, until the manager answers it. */
export const BLOCKED_DEMO = "a permission prompt the office couldn't answer";

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

/** Now and then a fake builder stops to ask something (#36): a product call for the manager, or one the repo settles. */
export function demoQuestion(issueNumber: number): string | null {
  if (issueNumber % 6 === 2) return 'Before I go on: should the new badge be red or blue?\n1. Red\n2. Blue';
  if (issueNumber % 6 === 4) return 'Should the new tests go next to the code or in a __tests__ folder?\n- Next to the code\n- In a __tests__ folder';
  return null;
}

/** The issue an answer resuming a session is about ("Answer from … to your question about #12: …"), or 0. */
export const demoAnswered = (prompt: string) => Number(prompt.match(/^Answer from .+? to your question about #(\d+): /)?.[1] ?? 0);

/** The demo CEO's call on a question event: the badge colour goes to the manager with a pick; the rest it answers. */
export function demoCeoAnswer(event: string): { tool: 'ask_manager_choice' | 'answer_agent'; args: Record<string, unknown> } | null {
  const agent = event.match(/\(([\w-]+)\) on /)?.[1];
  if (!agent || !/ asks about /.test(event)) return null;
  if (/red or blue/i.test(event)) return { tool: 'ask_manager_choice', args: { agent_id: agent, question: 'Should the new badge be red or blue?', options: ['Red', 'Blue'], recommendation: 'Blue: it matches the rest of the app.' } };
  return { tool: 'answer_agent', args: { agent_id: agent, text: 'Next to the code, like the rest of the repo.' } };
}
