// Keep a bubble's tools inside the visible log without changing the bubble's size (#289).
export function toolsOffset(top: number, height: number, log: { top: number; bottom: number }): number {
  return Math.max(log.top, Math.min(top, log.bottom - height)) - top;
}
