// The CEO chat's header row (#270): which of its tools stay as buttons and which fold into its ⋯ at a given width,
// and the badge ⋯ carries for what folded. Pure, so the rule is tested without a page (ChatActionsSheet.tsx draws it).

export type ChatToolId = 'search' | 'charts' | 'full' | 'files' | 'text' | 'call' | 'handsFree' | 'it';

/** Most used first: the last ones fold first as the header narrows. */
export const TOOL_ORDER: readonly ChatToolId[] = ['search', 'charts', 'full', 'files', 'text', 'call', 'handsFree', 'it'];

/** A tool button (44 px) and its gap (8 px). */
export const TOOL_SLOT = 52;
/** What the CEO's avatar (28 px and its gap) and a short name keep before tools take the room. */
export const NAME_ROOM = 100;

/**
 * The header row's tools at `width` px (the row the name and tools share; 0 before it's measured): the tools there are
 * (`present`) in their order, the most used kept as buttons while they fit beside the name and the ⋯, the rest folded.
 */
export function foldTools(width: number, present: readonly ChatToolId[]): { shown: ChatToolId[]; folded: ChatToolId[] } {
  const tools = TOOL_ORDER.filter((t) => present.includes(t));
  const room = width > 0 ? Math.floor((width - NAME_ROOM) / TOOL_SLOT) - 1 : 3; // one slot is the ⋯'s
  const keep = Math.max(1, room); // 🔍 always shows
  return { shown: tools.slice(0, keep), folded: tools.slice(keep) };
}

/** The ⋯'s badge: the counts of the tools folded into it (the thread's files), 0 for none. */
export const foldedBadge = (folded: readonly ChatToolId[], counts: Partial<Record<ChatToolId, number>>): number => folded.reduce((n, t) => n + (counts[t] ?? 0), 0);
