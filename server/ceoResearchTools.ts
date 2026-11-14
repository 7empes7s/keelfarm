// The CEO's request_research (#664): research goes to the Researcher's desk instead of the CEO searching the web inline.
// It queues and returns at once; the office's side is server/swarm/researcher.ts.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { runTool } from './ceo.ts';

export interface RequestResearchArgs {
  topic: string;
  floor?: number;
  questions?: string[];
  deadline_min?: number;
}

export interface ResearchHandlers {
  requestResearch(a: RequestResearchArgs): string;
}

export function researchTools(h: ResearchHandlers, run: typeof runTool) {
  return [
    tool(
      'request_research',
      "Hand web research (current docs, prior art, comparable products, pitfalls) to the Researcher instead of searching yourself. Returns at once with a research number; their sourced brief reaches the manager's phone and comes back to you: as a plan job for its floor, else as a follow-up. wait_for research_done to hold for it.",
      {
        topic: z.string().min(3).max(1000).describe('What to find out, e.g. "How do phone chat apps show voice messages?"'),
        floor: z.number().int().positive().optional().describe('The floor it is for'),
        questions: z.array(z.string().min(1).max(300)).max(8).optional().describe('What the brief must answer'),
        deadline_min: z.number().int().min(5).max(120).optional().describe("Its time budget; default Settings → The CEO's research minutes"),
      },
      (a) => run(async () => h.requestResearch(a)),
    ),
  ];
}
