// The CEO's propose_charter tool (#48): its description and zod input for ceo.ts's office tools, and what it hands the
// swarm (ceoTools.ts proposeCharter), which only stores it as a proposal for the manager.
import { z } from 'zod';
import { CHARTER_PROMPT_MAX, FOCUS_MAX, NON_GOAL_MAX, NON_GOALS_MAX, OBJECTIVES_MAX, OUTCOME_MAX, STANDARD_MAX, STANDARDS_MAX } from '../shared/charter.ts';

/** propose_charter's input: parts left out stay as they are. */
export interface CharterProposalArgs {
  floor: number;
  reason: string;
  mission?: string;
  focus?: string;
  objectives?: { id?: string; outcome: string; measure?: string }[];
  standards?: string[];
  non_goals?: string[];
}

export const PROPOSE_CHARTER_TEXT = `Propose a floor's charter, or a change to it: mission, current focus, objectives (each with how we know it's met), standards (must-always rules: quality bars, safety, style, "never" lists) and non-goals. Parts left out stay as they are. It waits for the manager, who approves or edits it; nothing changes until then. Agents get the first ${CHARTER_PROMPT_MAX} characters in every prompt: keep it tight.`;

export const PROPOSE_CHARTER = {
  floor: z.number().int(),
  reason: z.string().min(1).max(600).describe('Why, in a sentence or two. The manager reads this.'),
  mission: z.string().max(400).optional().describe('One or two lines: what the project is for'),
  focus: z.string().max(FOCUS_MAX).optional().describe('The milestone, or the 1-3 objectives worked on now, e.g. "O2, O3: the beta"'),
  objectives: z
    .array(z.object({ id: z.string().regex(/^O\d{1,2}$/).optional().describe('Keep existing ids; new ones get the next free one'), outcome: z.string().min(1).max(OUTCOME_MAX), measure: z.string().max(OUTCOME_MAX).optional() }))
    .max(OBJECTIVES_MAX)
    .optional(),
  standards: z.array(z.string().min(1).max(STANDARD_MAX)).max(STANDARDS_MAX).optional(),
  non_goals: z.array(z.string().min(1).max(NON_GOAL_MAX)).max(NON_GOALS_MAX).optional(),
};
