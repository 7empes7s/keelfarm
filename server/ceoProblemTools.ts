// The problems register's tools (#544), the CEO's and the IT lead's: problems (the register, worst first) and
// note_problem (a process problem by hand, or an entry's state, owner and resolution). The office's side is
// server/swarm/problems.ts; rules in shared/problems.ts.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { runTool } from './ceo.ts';
import { PROBLEM_OWNERS, PROBLEM_STATES, PROCESS_CAUSES } from '../shared/problems.ts';

export interface ProblemsArgs {
  open_only?: boolean;
  floor?: number;
}

export interface NoteProblemArgs {
  id?: string;
  title?: string;
  cause?: (typeof PROCESS_CAUSES)[number];
  detail?: string;
  floor?: number;
  pr?: number;
  issue?: number;
  owner?: (typeof PROBLEM_OWNERS)[number];
  state?: (typeof PROBLEM_STATES)[number];
  resolution?: string;
}

export interface ProblemHandlers {
  problemsList(a: ProblemsArgs): string;
  noteProblem(a: NoteProblemArgs): string;
}

export function problemTools(h: ProblemHandlers, run: typeof runTool) {
  return [
    tool(
      'problems',
      "The office's problems register: work (failed QA rounds by cause, PRs needing a human, conflicts, agents in error, blocked issues, wasted sessions), infrastructure (IT's tickets) and process, worst first by time and dollars lost, with owner, state and whether it recurs. Read-only.",
      { open_only: z.boolean().optional().describe('Default true'), floor: z.number().int().optional() },
      (a) => run(() => h.problemsList(a)),
    ),
    tool(
      'note_problem',
      "Note a process problem by hand (a vague brief, a missing QA check) with title, or change an entry by id: its state (resolved or wont-fix need a resolution) or owner (manager only for a real decision). IT tickets (t<n>) are IT's to close.",
      {
        id: z.string().max(12).optional().describe('An entry to change, e.g. "p14"'),
        title: z.string().min(1).max(200).optional().describe('A new problem in a line'),
        cause: z.enum(PROCESS_CAUSES).optional(),
        detail: z.string().max(600).optional(),
        floor: z.number().int().optional(),
        pr: z.number().int().positive().optional(),
        issue: z.number().int().positive().optional(),
        owner: z.enum(PROBLEM_OWNERS).optional(),
        state: z.enum(PROBLEM_STATES).optional(),
        resolution: z.string().max(600).optional().describe('What was done, or why not'),
      },
      (a) => run(() => h.noteProblem(a)),
    ),
  ];
}
