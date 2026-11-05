// The 3D view on a touch screen, page-wide: <html data-touch> while it's shown (styles.css makes targets thumb-sized
// and turns off text selection, the long-press menu, double-tap zoom and pull-to-refresh), and data-full-window while
// a panel with text is open (touchRules.ts), where selection and scrolling come back. A tap that slides off its
// button is dropped before the button sees it.

import { useEffect } from 'react';
import { useStore } from '../store';
import { isTouch } from '../world/touch/touchState';
import { selectableWindow, slidOff } from './touchRules';

const TAPPABLE = 'button, [role="button"], a[href], label, summary, select';

const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || !!t.closest('input, textarea, select, [contenteditable="true"]'));

/** While the 3D office is up on a touch screen. */
export function useTouchPage() {
  useEffect(() => {
    if (!isTouch) return;
    const root = document.documentElement;
    root.setAttribute('data-touch', '');
    const full = () => {
      const s = useStore.getState();
      return selectableWindow(s.overlay);
    };
    const apply = () => (full() ? root.setAttribute('data-full-window', '') : root.removeAttribute('data-full-window'));
    apply();
    const unsub = useStore.subscribe((s, prev) => s.overlay !== prev.overlay && apply());

    // no browser menu or selection from a long press outside text panels and boxes
    const noBrowser = (e: Event) => {
      if (!full() && !editable(e.target)) e.preventDefault();
    };

    // the tap's button, and where the finger lifted
    let pressed: Element | null = null;
    let up: { x: number; y: number; at: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pressed = e.target instanceof Element ? e.target.closest(TAPPABLE) : null;
      up = null;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') up = { x: e.clientX, y: e.clientY, at: performance.now() };
    };
    const onClick = (e: MouseEvent) => {
      const b = pressed;
      if (!b || !up || performance.now() - up.at > 800 || !(e.target instanceof Node) || !b.contains(e.target)) return;
      if (!slidOff(b.getBoundingClientRect(), up.x, up.y)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    document.addEventListener('contextmenu', noBrowser, true);
    document.addEventListener('selectstart', noBrowser, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('click', onClick, true);
    return () => {
      unsub();
      root.removeAttribute('data-touch');
      root.removeAttribute('data-full-window');
      document.removeEventListener('contextmenu', noBrowser, true);
      document.removeEventListener('selectstart', noBrowser, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('click', onClick, true);
    };
  }, []);
}
