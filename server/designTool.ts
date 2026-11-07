// The CEO's propose_design tool (#209): its description and zod input for ceo.ts's office tools. The swarm copies the
// screenshots into the files store, posts the proposal in the chat and opens a 'design' decision (team.ts proposeDesign).
import { z } from 'zod';

export const PROPOSE_DESIGN_TEXT =
  "Put a style or UX change to the manager before or after building it: 2 or 3 options, each with screenshots you made (absolute image paths, as attach_file takes) and an optional live preview link. It shows in their Approvals with the shots side by side; their pick comes back to you as a reply. Pass it on to the floor's agent yourself.";

export const PROPOSE_DESIGN = {
  floor: z.number().int().min(1),
  title: z.string().min(1).max(80).describe('What changes, in a few words'),
  question: z.string().min(1).max(200).describe('One plain sentence the manager answers'),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(60).describe('The option in a few words, e.g. "Cards with a soft shadow"'),
        shots: z.array(z.string().min(1).max(1000)).max(3).describe('Absolute paths of its screenshots (png, jpg, webp, svg)'),
        previewUrl: z.string().url().max(500).optional(),
      }),
    )
    .min(2)
    .max(3),
  issue: z.number().int().min(1).optional().describe('The issue it is for'),
};

export type ProposeDesignInput = z.infer<z.ZodObject<typeof PROPOSE_DESIGN>>;
