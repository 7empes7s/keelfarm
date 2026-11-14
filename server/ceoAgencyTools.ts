// The CEO's floor and agency tools (#667): create_floor (a new private repo and its floor, only when the manager asks),
// and the Agency floor's opportunities, approvals and external actions. The office's side is server/swarm/agency.ts,
// the rules shared/agency.ts.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { ACTION_KINDS, type ActionInput, type OpportunityInput, type PlanRoute } from '../shared/agency.ts';
import { USE_CASE_IDS } from '../shared/useCases.ts';
import type { UseCase } from '../shared/types.ts';
import { ASKED_IN } from './ceoAskTools.ts';
import type { runTool } from './ceo.ts';

export interface CreateFloorArgs {
  name: string;
  repo_slug: string;
  use_case: UseCase;
  description: string;
  private?: boolean;
  team_size?: number;
  opportunity?: string; // an approved agency opportunity it builds: its earnings count for it
  asked_in?: number;
}

export interface AgencyHandlers {
  createFloor(a: CreateFloorArgs): Promise<string>;
  agencyOpportunities(a: { floor: number; opportunities?: OpportunityInput[] }): string;
  agencyDecide(a: { id: string; approve: boolean; route?: PlanRoute; asked_in?: number }): Promise<string>;
  agencyProposeAction(a: ActionInput & { floor: number }): string;
  agencyActionDone(a: { id: string; result: string }): string;
}

const OPPORTUNITY = z.object({
  slug: z.string().describe('Its file: opportunities/<slug>.md'),
  title: z.string().max(100),
  revenue_month: z.number().min(0).describe('Expected $ a month once running'),
  cost_month: z.number().min(0).optional().describe('$ a month to run it'),
  effort_days: z.number().min(0).describe('Agent-days to build or set up'),
  days_to_first_dollar: z.number().min(0),
  confidence: z.number().min(0).max(1).optional().describe('0..1, default 0.5'),
});

export function agencyTools(h: AgencyHandlers, run: typeof runTool) {
  return [
    tool(
      'create_floor',
      'Only when the manager asks (asked_in): create a private GitHub repo (README, main branch), clone it, open its floor with the use case, a charter stub and that use case\'s QA brief, and hire its team. Safe to call again: an existing repo or floor is reused.',
      {
        name: z.string().min(1).max(60).describe('The floor\'s name, e.g. "Agency"'),
        repo_slug: z.string().min(1).max(140).describe('"owner/repo" or "repo" (the office\'s GitHub account)'),
        use_case: z.enum(USE_CASE_IDS as [UseCase, ...UseCase[]]),
        description: z.string().min(1).max(300).describe('One line: what the floor makes; becomes its mission'),
        private: z.boolean().optional().describe('Default true'),
        team_size: z.number().int().min(1).max(8).optional().describe('Default 1'),
        opportunity: z.string().max(80).optional().describe("The approved agency opportunity's slug it builds"),
        asked_in: ASKED_IN,
      },
      (a) => run(() => h.createFloor(a)),
    ),
    tool(
      'agency_opportunities',
      "An agency floor's opportunities: register or update each one's numbers from its opportunities/<slug>.md, and the office ranks them (profit × confidence ÷ days to pay off). New ones in the top 3 go to the manager with Approve / Not now. Without opportunities: the ranked list.",
      { floor: z.number().int(), opportunities: z.array(OPPORTUNITY).max(20).optional() },
      (a) => run(async () => h.agencyOpportunities(a)),
    ),
    tool(
      'agency_decide',
      'The manager\'s answer to an opportunity (its slug) or an external action (ax-N), from their message (asked_in). Approve an opportunity: a "Plan:" issue is filed on its agency floor; route build (a new floor: create_floor) or ops.',
      { id: z.string().min(1).max(80), approve: z.boolean(), route: z.enum(['build', 'ops']).optional(), asked_in: ASKED_IN },
      (a) => run(() => h.agencyDecide(a)),
    ),
    tool(
      'agency_propose_action',
      'Draft anything that leaves the office (a post, an email, a sign-up, a listing, a gig proposal): it waits on a card for the manager. Never do it yourself before agency_decide approves it.',
      {
        floor: z.number().int(),
        opportunity: z.string().max(80).optional().describe('Its slug'),
        kind: z.enum(ACTION_KINDS as [string, ...string[]]),
        target: z.string().min(1).max(300).describe('Where: the site, job link or address'),
        summary: z.string().min(1).max(200),
        draft: z.string().min(1).max(4000).describe('The exact text that would go out'),
      },
      (a) => run(async () => h.agencyProposeAction(a)),
    ),
    tool(
      'agency_action_done',
      'After doing an approved external action: mark it done so it never goes out twice. Refused unless the manager approved it.',
      { id: z.string().min(1).max(20), result: z.string().min(1).max(300).describe('What happened, e.g. the post\'s link') },
      (a) => run(async () => h.agencyActionDone(a)),
    ),
  ];
}
