// A row of chips that could run long (the Charter's drift view, #240): the first few, then a "+N more" chip that
// opens the rest in place. Pure.

/** How many chips a row shows before "+N more". */
export const CHIP_LIMIT = 8;

/** The chips to draw and how many "+N more" stands for (0: no such chip). Never "+1 more": that one chip fits instead. */
export function chipRow<T>(items: readonly T[], open: boolean, limit = CHIP_LIMIT): { shown: readonly T[]; more: number } {
  if (open || items.length <= limit + 1) return { shown: items, more: 0 };
  return { shown: items.slice(0, limit), more: items.length - limit };
}
