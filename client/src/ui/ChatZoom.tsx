// Pinch the chat's text (#135): two fingers anywhere in the messages or a reader scale its text size (CSS zoom through
// --chat-text, chat.css) while the page's own zoom stays locked (viewport.ts), Ctrl/Cmd + wheel or a trackpad pinch
// does the same on a computer, and the "Text 120%" pill shows the size with A−, A+ and Reset. Saved per device with
// the other a11y settings. The rules are pure, in chatPinch.ts.

import { useEffect } from 'react';
import { create } from 'zustand';
import { getA11y, setA11y, setChatTextVar, useA11y } from './a11y';
import { anchorScroll, gestureFor, isTwoFingerDoubleTap, pinchText, snapText, stepText, TAP_SLOP_PX, textLabel, touchDistance, wheelText, type ChatGesture } from './chatPinch';

const PILL_MS = 2000;

/** The size while the fingers are down (null: the saved one), and whether the pill shows. */
const usePill = create<{ live: number | null; open: boolean }>(() => ({ live: null, open: false }));
let hide = 0;
const showPill = (ms = PILL_MS) => {
  clearTimeout(hide);
  usePill.setState({ open: true });
  hide = window.setTimeout(() => usePill.setState({ open: false }), ms);
};

// Bubbles ask these before a swipe-to-reply or the long-press menu: a pinch since their press began cancels it.
let pinchedAt: number | null = null;
let pinching = false;
/** When the last pinch began or ended (performance.now()), null before any. */
export const lastPinchAt = () => pinchedAt;
/** Two fingers are on the chat right now. */
export const isPinching = () => pinching;

const textNow = () => usePill.getState().live ?? getA11y().chatText;

/** A new size, with what's at `anchorY` (viewport px) kept in place in `scroller`. */
function resize(v: number, scroller: HTMLElement | null, anchorY: number | null) {
  const prev = textNow();
  setChatTextVar(v);
  usePill.setState({ live: v });
  showPill();
  if (scroller && anchorY !== null && v !== prev) scroller.scrollTop = anchorScroll(scroller.scrollTop, anchorY - scroller.getBoundingClientRect().top, v / prev);
}

function save(v = textNow()) {
  usePill.setState({ live: null });
  setA11y({ chatText: snapText(v) }); // a11y.ts puts the saved size on the page
}

/** A−, A+ and Reset, and the Aa button: steps that show the pill. */
function stepChatText(dir: 1 | -1 | 0) {
  save(dir === 0 ? 100 : stepText(textNow(), dir));
  showPill();
}

export const openTextPill = () => showPill(5000);

/** Pinch and Ctrl + wheel on `el`; `scroller` is what scrolls inside it (kept anchored on the fingers). */
export function useChatPinch(el: HTMLElement | null, scroller: () => HTMLElement | null) {
  useEffect(() => {
    if (!el) return;
    let gesture: ChatGesture = 'none';
    let startDist = 0;
    let startText = 100;
    let moved = false;
    let lastTap: number | null = null;
    let wheelSave = 0;
    const pair = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      return { d: touchDistance({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY }), y: (a.clientY + b.clientY) / 2 };
    };
    const rebase = (e: TouchEvent) => {
      startDist = pair(e).d;
      startText = textNow();
    };
    const start = (e: TouchEvent) => {
      const next = gestureFor(e.touches.length, gesture);
      if (next === 'pinch' && e.touches.length >= 2) {
        if (gesture !== 'pinch') moved = false;
        pinching = true;
        pinchedAt = performance.now();
        rebase(e);
      }
      gesture = next;
    };
    const move = (e: TouchEvent) => {
      if (gesture !== 'pinch') return;
      e.preventDefault(); // the finger left after a pinch doesn't scroll either
      if (e.touches.length < 2) return;
      const { d, y } = pair(e);
      if (!moved && Math.abs(d - startDist) < TAP_SLOP_PX) return;
      moved = true;
      resize(pinchText(startText, startDist, d), scroller(), y);
    };
    const end = (e: TouchEvent) => {
      const next = gestureFor(e.touches.length, gesture);
      if (gesture === 'pinch' && e.touches.length >= 2) rebase(e);
      if (gesture === 'pinch' && next === 'none') {
        pinching = false;
        pinchedAt = performance.now();
        if (moved) save();
        else if (isTwoFingerDoubleTap(lastTap, pinchedAt)) {
          lastTap = null;
          stepChatText(0);
        } else lastTap = pinchedAt;
      }
      gesture = next;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); // the page doesn't zoom, the chat's text does
      resize(wheelText(textNow(), e.deltaY), scroller(), e.clientY);
      clearTimeout(wheelSave);
      wheelSave = window.setTimeout(save, 300);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('wheel', wheel);
      clearTimeout(wheelSave);
      if (gesture === 'pinch') {
        pinching = false;
        save();
      }
    };
  }, [el, scroller]);
}

/** "A− Text 120% A+ · Reset", while pinching and for 2 s after. */
export function ChatTextPill() {
  const { live, open } = usePill();
  const saved = useA11y((s) => s.prefs.chatText);
  if (!open) return null;
  const v = live ?? saved;
  return (
    <div className="chat-text-pill" role="group" aria-label="Chat text size" onPointerDown={() => showPill()}>
      <button type="button" className="chat-text-step" aria-label="Smaller text" onClick={() => stepChatText(-1)}>
        A−
      </button>
      <span aria-live="polite">{textLabel(v)}</span>
      <button type="button" className="chat-text-step" aria-label="Bigger text" onClick={() => stepChatText(1)}>
        A+
      </button>
      {Math.round(v) !== 100 && (
        <button type="button" className="chat-text-reset" onClick={() => stepChatText(0)}>
          Reset
        </button>
      )}
    </div>
  );
}
