// Measures what the toasts must not cover (#230, #521) and places them at the top with toastPlace.ts: under panel
// headers, tab rows and the app's header, above the composer, the field being typed in, the tab bar and the 3D
// office's What's new card, beside a CEO chat docked on the right, inside the safe areas and the part of the page the
// keyboard leaves. Only while toasts show, on their changes, a resize and a short tick (panels open and close under them).
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { appViewport } from '../viewport';
import { placeToasts, type Box } from './toastPlace';

/** What a toast never covers. */
const TOAST_AVOID = '.panel-head, [role="tablist"], .pk-head, .pk-tabs, .hud-status, .hud-banner, .chat-input, .term-input, .tour-invite-float';
/** Columns docked on the right (pocket's CEO chat, the 3D office's phone): the toasts stay left of them. */
const DOCKS = '.pk-dock, .phone';
/** The field being typed in, kept clear too. */
const TYPED = 'textarea, input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"]), [contenteditable=""], [contenteditable="true"]';
const TICK_MS = 500;

const shown = (r: Box) => r.right > r.left && r.bottom > r.top;

let probe: HTMLDivElement | null = null;
/** The safe areas, px, read through an invisible probe padded by them. */
function safeAreas() {
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:var(--ds-safe-top) var(--ds-safe-right) var(--ds-safe-bottom) var(--ds-safe-left)';
    document.body.append(probe);
  }
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
}

/** The UI scale's zoom on the toasts (their left/top are in zoomed px). */
function zoomOf(el: HTMLElement) {
  const z = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom;
  if (z) return z;
  return document.documentElement.hasAttribute('data-ui-scale') ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1 : 1;
}

/** The toasts' position (null until measured, or with none showing). `count`: how many show. */
export function useToastSpot(ref: RefObject<HTMLElement | null>, count: number): CSSProperties | undefined {
  const [spot, setSpot] = useState<{ left: number; top: number; room: number; clip: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !count) return;
    const place = () => {
      const vw = document.documentElement.clientWidth;
      const vv = window.visualViewport;
      const view = appViewport(window.innerHeight, vv && { height: vv.height, offsetTop: vv.offsetTop, scale: vv.scale });
      const me = el.getBoundingClientRect();
      const typingIn = document.activeElement instanceof HTMLElement && document.activeElement.matches(TYPED) ? [document.activeElement] : [];
      const avoid = [...document.querySelectorAll(TOAST_AVOID), ...typingIn].filter((n) => !el.contains(n)).map((n) => n.getBoundingClientRect()).filter(shown);
      const docks = [...document.querySelectorAll(DOCKS)].map((n) => n.getBoundingClientRect()).filter((r) => shown(r) && r.left > vw / 2);
      const z = zoomOf(el);
      const height = el.scrollHeight * z; // all of it, not what fits under a max-height
      const p = placeToasts({ vw, vh: view.height, viewTop: view.top, width: me.width, height, safe: safeAreas(), dockLeft: docks.length ? Math.min(...docks.map((d) => d.left)) : null, avoid });
      const next = { left: Math.round(p.left / z), top: Math.round(p.top / z), room: Math.floor(p.room / z), clip: p.room < height };
      setSpot((s) => (s && s.left === next.left && s.top === next.top && s.room === next.room && s.clip === next.clip ? s : next));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    const tick = setInterval(place, TICK_MS);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      clearInterval(tick);
      window.removeEventListener('resize', place);
    };
  }, [ref, count]);
  if (!count) return undefined;
  // no room under the bars (a short screen with the keyboard up): they wait rather than cover the composer
  return spot && spot.room > 0 ? { position: 'fixed', left: spot.left, top: spot.top, right: 'auto', bottom: 'auto', maxHeight: spot.room, overflow: spot.clip ? 'hidden' : undefined } : { visibility: 'hidden' };
}
