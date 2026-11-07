// The CEO's resolve_decision tool (#114): its description and zod input for ceo.ts's office tools. The swarm closes the
// open decision (team.ts resolveDecision, shared/decisions.ts), so the manager's tray stops showing it.
import { z } from 'zod';

export const RESOLVE_DECISION_TEXT = "Close one of company_status's openDecisions the manager answered in words (a tap on an option closes it by itself). Use the id from that list.";

export const RESOLVE_DECISION = {
  id: z.string().min(1).max(200).describe('The decision\'s id, e.g. "msg:42"'),
  outcome: z.string().min(1).max(200).describe('What the manager decided, in a few words'),
};
