// define_experiment's practice switches (#24) for a variant, as the CEO gives them; shared/practices.ts checks them again.
import { z } from 'zod';

export const PRACTICE_SWITCHES = z
  .object({ upToDate: z.boolean(), leases: z.boolean(), autoRebase: z.boolean(), busyFiles: z.boolean(), liveLeases: z.boolean(), generated: z.array(z.string().max(200)).max(30), appendOnly: z.array(z.string().max(200)).max(30), diffBudget: z.number().int().min(0).max(100_000) })
  .partial()
  .optional()
  .describe('Version-control switches (#24): upToDate (merge only up to date with CI on that), leases (hold back overlapping issues), autoRebase, busyFiles (conflict-aware scheduling and merge order), liveLeases (leases from real worktree diffs, merge-main nudges), generated / appendOnly files, diffBudget (lines, 0 none)');
