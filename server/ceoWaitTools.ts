// The CEO's waiting tools (#28): wait_for, ask_manager and consult, their schemas and output cap. Their handlers are
// the swarm's (server/swarm/ceoTools.ts); createOfficeTools (ceo.ts) adds them to the office's MCP server.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { ASK_MAX_MIN, WAIT_KINDS, type WaitCondition } from './ceoWaits.ts';

/** The most any of the waiting tools returns: what happened, an answer, a consult's reply. */
export const WAIT_OUTPUT_MAX = 6500;
/** Cut to WAIT_OUTPUT_MAX, keeping the lines (an answer's list and file:line references). */
const capWait = (s: string) => (s.length > WAIT_OUTPUT_MAX ? `${s.slice(0, WAIT_OUTPUT_MAX - 1)}…` : s);
const WAIT_CONDITION = z.object({
  kind: z.enum(WAIT_KINDS as [WaitCondition['kind'], ...WaitCondition['kind'][]]),
  floor: z.number().int().positive().optional(),
  pr: z.number().int().positive().optional(),
  issue: z.number().int().positive().optional(),
  agent_id: z.string().min(1).max(100).optional(),
  usage: z.enum(['normal', 'pacing', 'paused']).optional(),
  message: z.number().int().positive().optional(),
});

/** The office's side of the waiting tools (part of OfficeHandlers). */
export interface WaitHandlers {
  waitFor(a: { conditions: WaitCondition[]; timeout_min?: number }): Promise<string>;
  askManager(a: { question: string; suggestions?: string[]; timeout_min?: number }): Promise<string>;
  consult(a: { floor: number; agent_id?: string; question: string; hint?: string }): Promise<string>;
}

type Run = (fn: () => Promise<string>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;

export function waitTools(h: WaitHandlers, run: Run) {
  return [
    tool(
      'wait_for',
      "Wait, holding this job, until any of the conditions holds: pr_qa (floor, pr: QA's verdict), pr_merged (floor, pr), issue_closed (floor, issue), agent_idle (agent_id), preview_running (floor), usage (usage: normal, pacing or paused), it_answer (message: ask_it's message id). Returns what happened, or that it timed out. Your session slot is free while you wait.",
      {
        conditions: z.array(WAIT_CONDITION).min(1).max(5),
        timeout_min: z.number().int().min(1).max(30).optional().describe('Default 10, at most 30 (or Settings → The CEO)'),
      },
      (a) => run(async () => capWait(await h.waitFor(a))),
    ),
    tool(
      'ask_manager',
      `Ask the manager a question on their phone and wait for their reply (up to ${ASK_MAX_MIN} minutes). If they don't answer in time, end the job saying you're waiting; their reply comes back as a new job.`,
      {
        question: z.string().min(1).max(1000),
        suggestions: z.array(z.string().min(1).max(60)).max(4).optional().describe('Replies they can tap'),
        timeout_min: z.number().int().min(1).max(ASK_MAX_MIN).optional().describe('Default 30'),
      },
      (a) => run(async () => capWait(await h.askManager(a))),
    ),
    tool(
      'consult',
      "Ask an agent on a floor a question about its code (\"how does the restore approval flow work?\"): a named agent, or any free agent there. They answer in a short read-only session (no edits, commits or PRs) with file:line references; you wait for it. Several consults may run at once. Quote long answers in an artifact.",
      {
        floor: z.number().int().positive(),
        agent_id: z.string().min(1).max(100).optional().describe('An id or name; leave out for any free agent on the floor'),
        question: z.string().min(1).max(2000),
        hint: z.string().max(200).optional().describe('A role or skill, e.g. "as a security reviewer", "use the architecture skill"'),
      },
      (a) => run(async () => capWait(await h.consult(a))),
    ),
  ];
}
