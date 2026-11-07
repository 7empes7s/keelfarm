// Measures what the toasts must not cover (#230) and places them with toastPlace.ts: panel headers, tab rows, the
// app's header, the composer and the tab bar, beside a CEO chat docked on the right, inside the safe areas. Only while
// toasts show, on their changes, a resize and a short tick (panels open and close under them).
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { placeToasts, toastsFrom, type Box } from './toastPlace';

/** What a toast never covers. */
const TOAST_AVOID = '.panel-head, [role="tablist"], .pk-head, .pk-tabs, .hud-status, .hud-banner, .chat-input, .term-input';
/** Columns docked on the right (pocket's CEO chat, the 3D office's phone): the toasts stay left of them. */
const DOCKS = '.pk-dock, .phone';
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
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !count) return;
    const place = () => {
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const me = el.getBoundingClientRect();
      const avoid = [...document.querySelectorAll(TOAST_AVOID)].filter((n) => !el.contains(n)).map((n) => n.getBoundingClientRect()).filter(shown);
      const docks = [...document.querySelectorAll(DOCKS)].map((n) => n.getBoundingClientRect()).filter((r) => shown(r) && r.left > vw / 2);
      const p = placeToasts({ vw, vh, width: me.width, height: me.height, from: toastsFrom(vw), safe: safeAreas(), dockLeft: docks.length ? Math.min(...docks.map((d) => d.left)) : null, avoid });
      const z = zoomOf(el);
      const next = { left: Math.round(p.left / z), top: Math.round(p.top / z) };
      setSpot((s) => (s && s.left === next.left && s.top === next.top ? s : next));
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
  return spot ? { position: 'fixed', left: spot.left, top: spot.top, right: 'auto', bottom: 'auto' } : { visibility: 'hidden' };
}
