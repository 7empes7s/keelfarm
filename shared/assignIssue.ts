// Assign to… (#265): the manager's (Kanban card, issue sheet) and the CEO's (assign_issue) pick of who builds an issue.
// A free agent starts it now; a busy one gets it as their next task, after the one they're on, so running work never
// stops. Pure, shared by the server (the decision) and the Assign sheet (its order).

/** One of the floor's agents, as the decision sees them. */
export interface AssignCandidate {
  id: string;
  name: string;
  free: boolean; // can start an issue right now
  startedAt: number | null; // when their current task started (busy agents who started first are likely done first)
  nextIssue?: number | null; // the issue already waiting as their next task
}

/** assign_issue's agent when the CEO doesn't name one. */
export const NEXT_FREE = 'next free';

export interface AssignPlan {
  agentId: string;
  start: boolean; // true: they start it now; false: it waits as their next task
  replaces: number | null; // the next task it takes the place of
}

/**
 * Who gets the issue: the agent named (by id or name, any case), or for "next free" the first free agent, else the
 * busy one without a next task who started first. Throws with what to do instead. `holder`: who is building it now.
 */
export function planAssign(team: readonly AssignCandidate[], issue: number, who: string, holder?: string | null): AssignPlan {
  if (holder) throw new Error(`${holder} is already working on #${issue}.`);
  if (!team.length) throw new Error('This floor has no agents: add one first.');
  const ref = who.trim().toLowerCase();
  const plan = (a: AssignCandidate): AssignPlan => ({ agentId: a.id, start: a.free, replaces: !a.free && a.nextIssue != null && a.nextIssue !== issue ? a.nextIssue : null });
  if (!ref || ref === NEXT_FREE) {
    const free = team.find((a) => a.free);
    if (free) return plan(free);
    const first = team.filter((a) => a.nextIssue == null || a.nextIssue === issue).sort((x, y) => (x.startedAt ?? 0) - (y.startedAt ?? 0))[0];
    if (!first) throw new Error(`Everyone on this floor is busy and already has a next task: name an agent to replace theirs (${team.map((a) => `${a.name}: #${a.nextIssue}`).join(', ')}).`);
    return plan(first);
  }
  const a = team.find((x) => x.id === who.trim() || x.name.toLowerCase() === ref);
  if (!a) throw new Error(`No agent "${who.trim()}" on this floor. Agents here: ${team.map((x) => x.name).join(', ')}, or "${NEXT_FREE}".`);
  return plan(a);
}

/** The Assign sheet's order: free agents first, then busy ones (who started first, first), each group as given. */
export const assignOrder = <T extends AssignCandidate>(team: readonly T[]): T[] =>
  [...team.filter((a) => a.free), ...team.filter((a) => !a.free).sort((x, y) => (x.startedAt ?? 0) - (y.startedAt ?? 0))];
