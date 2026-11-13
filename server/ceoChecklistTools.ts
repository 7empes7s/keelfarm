// The CEO's checklist tools (#612): checklist_create (steps for the manager as a tickable card in the chat),
// checklist_update (add, edit or remove steps) and checklist_read (each step's state and comments, only what changed
// since a version). The office's side is server/swarm/checklists.ts; rules in shared/checklists.ts.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { runTool } from './ceo.ts';
import { MAX_STEPS, SECRET_PROVIDERS } from '../shared/checklists.ts';

const copy = z.array(z.object({ label: z.string().max(60), value: z.string().min(1).max(1000) })).max(6).describe('Values the manager copies with one tap, e.g. a redirect URI');
const secret = z
  .object({ label: z.string().min(1).max(60).describe('e.g. "Client secret"'), provider: z.enum(SECRET_PROVIDERS).describe('The Providers entry it is saved as') })
  .describe('A field the manager pastes a secret into: it goes straight to Providers, never into the chat or the checklist');
const step = z.object({ title: z.string().min(1).max(200), details: z.string().max(2000).optional().describe('Light markdown: links, **bold**, lists'), copy: copy.optional(), secret: secret.optional() });

export interface ChecklistCreateArgs {
  title: string;
  floor?: number;
  steps: z.infer<typeof step>[];
}

export interface ChecklistUpdateArgs {
  id: string;
  title?: string;
  add?: { step: z.infer<typeof step>; after?: string }[];
  edit?: ({ id: string } & Partial<z.infer<typeof step>>)[];
  remove?: string[];
}

export interface ChecklistReadArgs {
  id?: string;
  since?: number;
}

export interface ChecklistHandlers {
  checklistCreate(a: ChecklistCreateArgs): string;
  checklistUpdate(a: ChecklistUpdateArgs): string;
  checklistRead(a: ChecklistReadArgs): string;
}

export function checklistTools(h: ChecklistHandlers, run: typeof runTool) {
  return [
    tool(
      'checklist_create',
      "Give the manager steps to do as a checklist: a card in the chat they tick, mark not needed, comment on and duplicate (e.g. once per account). Each step: a title, details, values to copy, and a secret field that saves straight to Providers. You're woken when they work on it.",
      { title: z.string().min(1).max(120), floor: z.number().int().optional().describe('Pin it on this floor'), steps: z.array(step).min(1).max(MAX_STEPS) },
      (a) => run(() => h.checklistCreate(a)),
    ),
    tool(
      'checklist_update',
      'Change a checklist: retitle it, add steps (after a step id), edit or remove steps by id (checklist_read lists them). The manager’s ticks and comments stay.',
      {
        id: z.string().max(12).describe('e.g. "c3"'),
        title: z.string().min(1).max(120).optional(),
        add: z.array(z.object({ step, after: z.string().max(8).optional() })).max(MAX_STEPS).optional(),
        edit: z.array(step.partial().extend({ id: z.string().max(8) })).max(MAX_STEPS).optional(),
        remove: z.array(z.string().max(8)).max(MAX_STEPS).optional(),
      },
      (a) => run(() => h.checklistUpdate(a)),
    ),
    tool(
      'checklist_read',
      "A checklist's steps with their state, saved secrets (last 4 only) and the manager's latest comments; with since, only the steps changed after that version. Without id: the open checklists.",
      { id: z.string().max(12).optional(), since: z.number().int().min(0).optional().describe('A version from an earlier read') },
      (a) => run(() => h.checklistRead(a)),
    ),
  ];
}
