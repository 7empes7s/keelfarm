// The 3D view on a touch screen, page-wide: <html data-touch> while it's shown (styles.css makes targets thumb-sized
// and turns off text selection, the long-press menu, double-tap zoom and pull-to-refresh), and data-full-window while
// a panel with text is open (touchRules.ts), where selection and scrolling come back. A tap that slides away is the
// browser's to drop: comparing a button's box with the finger was wrong under the UI scale's CSS zoom, where WebKit
// gives the box in another space than the finger and most taps looked slid off (#83).

import { useEffect } from 'react';
import { useStore } from '../store';
import { isTouch } from '../world/touch/touchState';
import { selectableWindow } from './touchRules';

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

    document.addEventListener('contextmenu', noBrowser, true);
    document.addEventListener('selectstart', noBrowser, true);
    return () => {
      unsub();
      root.removeAttribute('data-touch');
      root.removeAttribute('data-full-window');
      document.removeEventListener('contextmenu', noBrowser, true);
      document.removeEventListener('selectstart', noBrowser, true);
    };
  }, []);
}
