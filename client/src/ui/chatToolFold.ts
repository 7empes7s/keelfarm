// Which of the chat's header buttons fit beside the CEO's name, and which fold into its ⋯ (#270). Pure, so it's tested
// without a page; ChatActionsSheet.tsx measures the header and draws the result.

export type ChatToolId = 'search' | 'charts' | 'full' | 'files' | 'call' | 'text' | 'handsFree';

/** Always in the row: search, 📊 and ⛶ (with ⋯ and ✕). */
const KEPT: ChatToolId[] = ['search', 'charts', 'full'];
/** The rest, the first to stay in the row when there's room. */
const BY_USE: ChatToolId[] = ['files', 'call', 'text', 'handsFree'];

/** The header's own room: padding, the avatar, the name at its shortest, ⋯ and ✕. */
const HEAD_CHROME = 260;
/** One 44 px button and its gap. */
const TOOL_SLOT = 50;

/**
 * The tools present (`present`), split for a header `width` px wide: what shows in the row, in its order, and what goes
 * into ⋯. Unmeasured (0) folds everything that can fold, so the first frame never overflows.
 */
export function foldTools(width: number, present: readonly ChatToolId[]): { shown: ChatToolId[]; folded: ChatToolId[] } {
  const kept = KEPT.filter((t) => present.includes(t));
  const rest = BY_USE.filter((t) => present.includes(t));
  const room = Math.max(0, Math.floor((width - HEAD_CHROME) / TOOL_SLOT) - kept.length);
  const shown = new Set([...kept, ...rest.slice(0, room)]);
  const order: ChatToolId[] = ['search', 'charts', 'files', 'text', 'call', 'handsFree', 'full'];
  return { shown: order.filter((t) => shown.has(t)), folded: rest.filter((t) => !shown.has(t)) };
}

/** The badge ⋯ carries: the counts of the tools folded into it (the files' count, so far). */
export function foldedBadge(folded: readonly ChatToolId[], counts: Partial<Record<ChatToolId, number>>): number {
  return folded.reduce((n, t) => n + (counts[t] ?? 0), 0);
}
