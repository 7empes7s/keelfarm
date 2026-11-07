// The chat's text size (#135), pure: a pinch's distance to a text size, Ctrl + wheel and A−/A+ steps, keeping what's
// under the fingers in place, and which touches are a pinch rather than a press (swipe-to-reply, long press, a tap).
// Sizes are percent, like the other a11y settings (a11yPrefs.ts LIMITS.chatText).

export const CHAT_TEXT = { min: 80, max: 200, step: 5 } as const;

/** A size kept between 80% and 200%, unrounded (a live pinch is smooth). */
export const clampText = (v: number) => Math.min(CHAT_TEXT.max, Math.max(CHAT_TEXT.min, Number.isFinite(v) ? v : 100));

/** A size as it's saved: clamped and snapped to 5%. */
export const snapText = (v: number) => clampText(Math.round(clampText(v) / CHAT_TEXT.step) * CHAT_TEXT.step);

/** The size while pinching: the size at the start, times how far the fingers have spread since. */
export function pinchText(start: number, startDistance: number, distance: number): number {
  if (!(startDistance > 0) || !(distance > 0)) return clampText(start);
  return clampText(start * (distance / startDistance));
}

/** The distance between two touch points, px. */
export const touchDistance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Ctrl/Cmd + wheel, or a trackpad pinch (which browsers send as one): up grows the text, down shrinks it. */
export const wheelText = (current: number, deltaY: number) => clampText(current * Math.exp(-deltaY * 0.01));

/** A− / A+: the next 10% step down or up. */
export const stepText = (current: number, dir: 1 | -1) => snapText((dir > 0 ? Math.floor(current / 10) + 1 : Math.ceil(current / 10) - 1) * 10);

/** The scroll position that keeps the content at `anchorY` (px from the scroller's top) under it after resizing by `ratio`. */
export const anchorScroll = (scrollTop: number, anchorY: number, ratio: number) => Math.max(0, (scrollTop + anchorY) * ratio - anchorY);

export type ChatGesture = 'none' | 'press' | 'pinch';

/**
 * What the fingers on the chat are doing, after a touch lands or lifts: two or more is a pinch, and it stays a pinch
 * until every finger is up (the last finger left is never a press or a scroll); one finger from rest is a press.
 */
export function gestureFor(touches: number, current: ChatGesture): ChatGesture {
  if (touches <= 0) return 'none';
  if (touches >= 2 || current === 'pinch') return 'pinch';
  return 'press';
}

/** Whether a pinch since the press began cancels it: no reply, no long-press menu (times from one clock). */
export const pinchCancels = (pressAt: number, pinchAt: number | null) => pinchAt !== null && pinchAt >= pressAt;

/** Two fingers that came down and lifted without spreading count as a tap; two such taps this close reset the size. */
const TWO_TAP_MS = 350;
export const TAP_SLOP_PX = 12;

/** Whether this two-finger tap is the second of a double tap: `prevTapAt` the last one's time (null: none). */
export const isTwoFingerDoubleTap = (prevTapAt: number | null, now: number) => prevTapAt !== null && now - prevTapAt <= TWO_TAP_MS;

/**
 * The starting size from the phone's own text size (iOS Dynamic Type through `-apple-system-body`, 17 px at the
 * default size): its percent, snapped; 100 when it can't be read.
 */
export function systemText(bodyPx: number | null): number {
  if (bodyPx === null || !Number.isFinite(bodyPx) || bodyPx <= 0) return 100;
  return snapText((bodyPx / 17) * 100);
}

/** The pill's words. */
export const textLabel = (v: number) => `Text ${Math.round(v)}%`;
