// Keep a bubble's tools inside the visible log without changing the bubble's size (#289).
/** A row scrolled out of the log keeps its tools by its bubble: pinned to the log, they'd slide with every scroll. */
export function toolsOffset(top: number, height: number, log: { top: number; bottom: number }, rowBottom = top + height): number {
  if (rowBottom <= log.top || top >= log.bottom) return 0;
  return Math.max(log.top, Math.min(top, log.bottom - height)) - top;
}

/** A short log (Waiting on you open, a reply in progress) can't hold the stack: it lies down as one row over the bubble. */
export function toolsInRow(stack: number, logHeight: number): boolean {
  return stack > logHeight;
}
