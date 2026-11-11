// The CEO's setup tool (#366): apply_setup, a floor's use case and a setup gap's recommended fix when the manager asks.
// Its handler is the swarm's (server/swarm/setup.ts); createOfficeTools (ceo.ts) adds it to the office's MCP server.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { UseCase } from '../shared/types.ts';
import { USE_CASE_IDS } from '../shared/useCases.ts';

/** The office's side of apply_setup (part of OfficeHandlers). */
export interface SetupHandlers {
  applySetup(a: { floor: number; use_case?: UseCase; gap?: string }): string;
}

type Run = (fn: () => string) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;

export function setupTools(h: SetupHandlers, run: Run) {
  return [
    tool(
      'apply_setup',
      "When the manager asks: set a floor's use case and/or apply a setup gap's recommended fix (company_status' setup line lists the gap ids). Sign-ins and keys need the manager.",
      {
        floor: z.number().int().describe('Floor number'),
        use_case: z.enum(USE_CASE_IDS as [UseCase, ...UseCase[]]).optional().describe("The floor's kind of project"),
        gap: z.string().max(120).optional().describe('A gap id from the setup line, e.g. "qa-brief", "preview", "browser"'),
      },
      (a) => run(() => h.applySetup(a)),
    ),
  ];
}
