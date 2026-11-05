// The demo's permission prompts and questions, answered by the office the way it answers a real session's (#54).
import path from 'node:path';
import crypto from 'node:crypto';
import type { LogEntry, SessionCallbacks, SessionOptions } from './agentRunner.ts';
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
function demoQuestion(issueNumber: number): string | null {
  if (issueNumber % 6 === 2) return 'Before I go on: should the new badge be red or blue?\n1. Red\n2. Blue';
  if (issueNumber % 6 === 4) return 'Should the new tests go next to the code or in a __tests__ folder?\n- Next to the code\n- In a __tests__ folder';
  return null;
}

/**
 * A fake build session's part in agents' questions: `answered` when its prompt answers its question ("Answer from … to
 * your question about #12: …", it goes on to the PR), else the `question` it stops halfway to ask, if any.
 */
export function demoAsks(build: boolean, opts: Pick<SessionOptions, 'prompt' | 'resumeSessionId'>, issueNumber: number, title: string, issues: { number: number; title: string }[]): { answered: boolean; question: string | null; title: string } {
  const answered = build && Number(opts.prompt.match(/^Answer from .+? to your question about #(\d+): /)?.[1] ?? 0) === issueNumber;
  if (answered) return { answered, question: null, title: issues.find((i) => i.number === issueNumber)?.title ?? title };
  return { answered, question: build && !opts.resumeSessionId ? demoQuestion(issueNumber) : null, title };
}

/** The fake session ends its turn with the question, keeping a session id the answer resumes. */
export function demoAsked(cb: SessionCallbacks, question: string) {
  cb.tool(null);
  cb.sessionId(`demo-issue-${crypto.randomUUID()}`);
  cb.log([{ kind: 'text', text: `● ${question}` }]);
  cb.finished({ ok: true, text: question, costUsd: 0.4, turns: 12, errors: [] });
}

/** The demo CEO's call on a question event, through the real tools: the badge colour goes to the manager with a pick; the rest it answers. */
export async function demoCeoAnswer(event: string, use: (tool: string, args: Record<string, unknown>) => Promise<string>, think: (text: string) => Promise<void>): Promise<boolean> {
  const agent = event.match(/\(([\w-]+)\) on /)?.[1];
  if (!agent || !/ asks about /.test(event)) return false;
  if (/red or blue/i.test(event)) {
    await think("A product call: that's the manager's.");
    await use('ask_manager_choice', { agent_id: agent, question: 'Should the new badge be red or blue?', options: ['Red', 'Blue'], recommendation: 'Blue: it matches the rest of the app.' });
  } else {
    await think('The repo settles this one: tests sit next to the code.');
    await use('answer_agent', { agent_id: agent, text: 'Next to the code, like the rest of the repo.' });
  }
  return true;
}
