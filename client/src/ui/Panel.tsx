// The office's panel (a titled card over a dimmed backdrop) and closing it. Kept apart from Overlays.tsx, which pulls
// in the 3D world, so pocket mode can open panels without loading it. A panel is a modal dialog for the keyboard and
// screen readers (dialogFocus.ts): focus moves in, stays in, and goes back when it closes.
import { useEffect, useId, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useStore } from '../store';
import { pushLayer } from './backStack';
import { focusRaises, isTopDialog, raiseDialog, useDialogFocus } from './dialogFocus';
import { CloseButton } from './Icon';

// Closing a panel grabs the mouse again right away (world/lookLock.ts; "Grab the mouse when panels
// close" in help turns that off), and mouse presses are swallowed for a moment so a double click on
// ✕ or the backdrop can't act on whatever the crosshair lands on.
export function closeOverlay() {
  useStore.getState().openOverlay(null);
}

/**
 * While mounted, the back gesture and the browser's Back run `close` instead of leaving the app (backStack.ts).
 * Returns what makes it the layer Back closes first.
 */
export function useBackLayer(close: () => void): () => void {
  const latest = useRef(close);
  const raise = useRef(() => {});
  useEffect(() => void (latest.current = close));
  useEffect(() => {
    const remove = pushLayer(() => latest.current());
    raise.current = remove.raise;
    return remove;
  }, []);
  return () => raise.current();
}

let pressedBackdrop: EventTarget | null = null;

/**
 * A window's backdrop: a tap or click that starts and ends on it, outside the window, closes it like ✕. Pointer down
 * and click, not mousedown: iOS sends a tap's mouse events only to what it thinks is clickable (#83).
 */
export const backdropClose = (close: () => void) => ({
  onPointerDown: (e: PointerEvent<HTMLElement>) => void (pressedBackdrop = e.target === e.currentTarget ? e.currentTarget : null),
  onClick: (e: MouseEvent<HTMLElement>) => void (e.target === e.currentTarget && pressedBackdrop === e.currentTarget && close()),
});

export function Panel({
  title,
  children,
  wide,
  accent,
  className,
  onClose,
}: {
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  accent?: string;
  className?: string;
  onClose?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(box);
  const raiseBack = useBackLayer(onClose ?? closeOverlay);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // two panels side by side (#212): Esc closes the top one only, the one last opened, clicked or focused
      if (e.key === 'Escape' && isTopDialog(box.current)) {
        e.preventDefault();
        onClose ? onClose() : closeOverlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" {...backdropClose(onClose ?? closeOverlay)}>
      <div
        ref={box}
        className={`panel ds-screen ${wide ? 'panel-wide' : ''} ${className ?? ''}`}
        style={{ ['--accent' as string]: accent ?? '#ff8a5b' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onFocus={(e) => {
          if (!focusRaises(box.current, e.target)) return;
          raiseDialog(box.current!);
          raiseBack();
        }}
      >
        <div className="panel-head">
          <h2 className="panel-title" id={titleId}>
            {title}
          </h2>
          <CloseButton className="panel-x" onClick={() => (onClose ? onClose() : closeOverlay())} label="Close" />
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}
