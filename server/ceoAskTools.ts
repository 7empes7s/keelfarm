// The CEO's tools for what the manager asks in chat (#403): console actions that are normally theirs, run only when the
// call names the manager's message that asked for it (asked_in; checked in server/swarm/managerAsks.ts, rules in
// server/managerAsks.ts). createOfficeTools (ceo.ts) adds them to the office's MCP server.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { PROPOSE_CHARTER, type CharterProposalArgs } from './charterTool.ts';
import { PRACTICE_SWITCHES } from './practiceSchema.ts';

/** asked_in: the manager's message that asks for the call. */
export const ASKED_IN = z.number().int().nonnegative().describe('The manager\'s message that asks for this: the N of its "(message N)"');

type Asked = { asked_in: number };

/** The office's side of these tools (part of OfficeHandlers). */
export interface AskHandlers {
  runExperiment(a: Asked & { experiment: string; action: 'start' | 'stop' | 'promote'; variant?: string | null }): string;
  setFloorSwitches(a: Asked & { floor: number; auto_assign?: boolean; auto_merge?: boolean; practices?: z.infer<typeof PRACTICE_SWITCHES> }): string;
  setIssuePriority(a: Asked & { floor: number; number: number; priority?: boolean; parked?: boolean }): Promise<string>;
  setCeoSetup(a: Asked & { account?: string; model?: string; effort?: string }): string;
  applyCharter(a: Asked & CharterProposalArgs): string;
  mergePull(a: Asked & { floor: number; pr: number }): Promise<string>;
}

type Run = (fn: () => string | Promise<string>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;

const WHEN = 'Only when the manager asks for it in a message to you now (pass asked_in).';

export function askTools(h: AskHandlers, run: Run) {
  return [
    tool(
      'run_experiment',
      `Start, stop or promote a variant of an experiment, as the manager does in Mission control. ${WHEN}`,
      {
        experiment: z.string().min(1).max(80).describe('Its id or name (company_status experiments)'),
        action: z.enum(['start', 'stop', 'promote']),
        variant: z.string().max(4).nullable().optional().describe('promote: the variant id (a, b…), or null to promote none'),
        asked_in: ASKED_IN,
      },
      (a) => run(() => h.runExperiment(a)),
    ),
    tool(
      'set_floor_switches',
      `Turn a floor's auto-assign, auto-merge or version-control practices on or off, as in its settings. ${WHEN}`,
      { floor: z.number().int(), auto_assign: z.boolean().optional(), auto_merge: z.boolean().optional(), practices: PRACTICE_SWITCHES, asked_in: ASKED_IN },
      (a) => run(() => h.setFloorSwitches(a)),
    ),
    tool(
      'set_issue_priority',
      `Mark an open issue as a priority (started first) or park it (never handed out), or undo either. ${WHEN}`,
      { floor: z.number().int(), number: z.number().int().positive().describe('The issue number'), priority: z.boolean().optional(), parked: z.boolean().optional(), asked_in: ASKED_IN },
      (a) => run(() => h.setIssuePriority(a)),
    ),
    tool(
      'set_ceo_setup',
      `Change your own account, model or reasoning effort, from your next job. ${WHEN}`,
      {
        account: z.string().max(40).optional().describe('An account id or tag (company_status lists them), or "rotation"'),
        model: z.string().max(80).optional().describe('A Claude model id, "" for the default'),
        effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', '']).optional(),
        asked_in: ASKED_IN,
      },
      (a) => run(() => h.setCeoSetup(a)),
    ),
    tool(
      'apply_charter',
      `Change a floor's charter at once, without a proposal; parts left out stay. Standards that protect the live office stay as they are. ${WHEN}`,
      { ...PROPOSE_CHARTER, asked_in: ASKED_IN },
      (a) => run(() => h.applyCharter(a)),
    ),
    tool(
      'merge_pull',
      `Merge a pull request whose QA passed, even with a red or pending check (the console's Merge anyway). ${WHEN}`,
      { floor: z.number().int(), pr: z.number().int().positive(), asked_in: ASKED_IN },
      (a) => run(() => h.mergePull(a)),
    ),
  ];
}
