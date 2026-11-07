// Hover cards (#213), the pure part: when a peek opens and closes (hover, keyboard focus, long-press, Esc) and where
// it goes on screen (flip and shift, never off screen, never over the CEO chat). HoverCard.tsx draws it.

/** Hover or focus this long before it opens. */
export const OPEN_MS = 350;
/** It closes this long after the pointer leaves both the trigger and the card, so the card can be reached. */
export const CLOSE_MS = 150;
/** A touch held this long opens it as a small sheet. */
export const HOLD_MS = 450;

/** 'card': floating by its trigger (pointer, keyboard); 'sheet': a small sheet at the bottom (long-press on touch). */
export type PeekMode = 'card' | 'sheet';

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (t: unknown) => void;
}

export interface PeekController {
  /** The pointer is over the trigger or the card. */
  hoverIn(): void;
  /** It left them. */
  hoverOut(): void;
  /** The trigger got keyboard focus. */
  focusIn(): void;
  focusOut(): void;
  /** A touch went down on the trigger. */
  pressStart(): void;
  /** It lifted, moved away or was cancelled before the hold. */
  pressEnd(): void;
  /** The trigger was clicked or tapped: true does its main action, false when the tap ended a long-press. */
  click(): boolean;
  /** Esc: true when it closed an open peek (the key is then the peek's). */
  escape(): boolean;
  close(): void;
  readonly mode: PeekMode | null;
  dispose(): void;
}

const browserTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as number) };

/** One trigger's peek: `onChange` gets the mode it opens in, or null when it closes. */
export function createPeek(onChange: (mode: PeekMode | null) => void, timers: Timers = browserTimers): PeekController {
  let mode: PeekMode | null = null;
  let timer: unknown = null;
  let held = false;
  const stop = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const show = (m: PeekMode | null) => {
    stop();
    if (m === mode) return;
    mode = m;
    onChange(m);
  };
  const later = (ms: number, fn: () => void) => {
    stop();
    timer = timers.set(() => {
      timer = null;
      fn();
    }, ms);
  };
  const open = () => {
    if (mode) stop();
    else later(OPEN_MS, () => show('card'));
  };
  const leave = () => {
    // A sheet stays until it's dismissed (a tap elsewhere, ✕ or Esc).
    if (mode === 'sheet') return;
    if (mode) later(CLOSE_MS, () => show(null));
    else stop();
  };
  return {
    hoverIn: open,
    hoverOut: leave,
    focusIn: open,
    focusOut: leave,
    pressStart() {
      held = false;
      later(HOLD_MS, () => {
        held = true;
        show('sheet');
      });
    },
    pressEnd() {
      if (mode !== 'sheet') stop();
    },
    click() {
      if (held) {
        held = false;
        return false;
      }
      show(null);
      return true;
    },
    escape() {
      if (!mode) {
        stop();
        return false;
      }
      show(null);
      return true;
    },
    close: () => show(null),
    get mode() {
      return mode;
    },
    dispose: stop,
  };
}

// ---------- placement ----------

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * Where a `w`×`h` card goes beside `anchor` in a `vw`×`vh` window: below it, or above when below has no room (flip),
 * slid sideways to stay `margin` inside the window (shift), and moved off every `avoid` box (the CEO chat column, the
 * chat's message box) when any place can. Never over the anchor itself.
 */
export function placePeek(anchor: Box, w: number, h: number, vw: number, vh: number, avoid: Box[] = [], gap = 8, margin = 8): { left: number; top: number; side: 'top' | 'bottom' } {
  const below = vh - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const sides: ('top' | 'bottom')[] = below >= h || below >= above ? ['bottom', 'top'] : ['top', 'bottom'];
  const xs = [anchor.left, ...avoid.flatMap((a) => [a.left - gap - w, a.right + gap])].map((x) => clamp(x, margin, vw - margin - w));
  let best: { left: number; top: number; side: 'top' | 'bottom'; cost: number } | null = null;
  for (const side of sides) {
    const room = side === 'bottom' ? below : above;
    const top = clamp(side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - h, margin, vh - margin - h);
    for (const left of xs) {
      const box = { left, top, right: left + w, bottom: top + h };
      // Cost: what it covers of the avoided boxes, then of the anchor, then whether it had to squeeze in.
      const cost = avoid.reduce((n, a) => n + overlap(box, a), 0) * 4 + overlap(box, anchor) * 2 + (room >= h ? 0 : 1);
      if (!best || cost < best.cost) best = { left, top, side, cost };
      if (cost === 0) return { left, top, side };
    }
  }
  return { left: best!.left, top: best!.top, side: best!.side };
}
