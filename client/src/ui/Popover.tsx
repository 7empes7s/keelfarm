import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { placeAnchored, type Anchored } from './popoverRules';
import { pushLayer } from './backStack';
import { useDialogFocus } from './dialogFocus';
import { CloseButton } from './Icon';
import './popover.css';

// Header popovers (#416): Sound, Captions and Notifications open under their button, on the top layer (over the chat,
// windows and toasts), with an arrow at the button. Placement is pure, in popoverRules.ts. `useAnchored` is shared by
// the hover peeks (HoverCard.tsx's `anchored`) and `Popover`, the click-opened panel with its × .

/** Where the element in `card` goes under `anchor` while `open`, kept there as the window or the content resizes. */
export function useAnchored(open: boolean, anchor: RefObject<HTMLElement | null>, card: RefObject<HTMLElement | null>, align: 'center' | 'end' = 'center') {
  const [pos, setPos] = useState<Anchored | null>(null);
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const el = card.current;
    if (!el) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      // scrollHeight: the content's own height, not the one a previous maxHeight cut it to
      if (a) setPos(placeAnchored(a, el.offsetWidth, el.scrollHeight, window.innerWidth, window.innerHeight, align));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [open, anchor, card, align]);
  const style: CSSProperties = pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight, ['--pop-arrow' as string]: `${pos.arrow}px` } : { visibility: 'hidden' };
  return { style, side: pos?.side ?? 'bottom' };
}

/** A click-opened header panel: Esc, a tap outside (which reaches nothing behind it), × and the back gesture close it; focus goes in and back to `anchor`. */
export function Popover({ anchor, label, title, align, className, onClose, children }: { anchor: RefObject<HTMLElement | null>; label: string; title: ReactNode; align?: 'center' | 'end'; className?: string; onClose: () => void; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  const { style, side } = useAnchored(true, anchor, card, align);
  useDialogFocus(card);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      close.current();
    };
    document.addEventListener('keydown', onKey, true);
    const unlayer = pushLayer(() => close.current());
    const trigger = anchor.current;
    return () => {
      document.removeEventListener('keydown', onKey, true);
      unlayer();
      // a click doesn't focus a button in every browser: focus goes back to the trigger either way
      if (trigger?.isConnected && (!document.activeElement || document.activeElement === document.body)) trigger.focus({ preventScroll: true });
    };
  }, [anchor]);
  return createPortal(
    <>
      {/* React sends a portal's clicks up its tree: they mustn't reach the trigger's ancestors */}
      <div
        className="pop-scrim"
        aria-hidden
        onPointerDown={(e) => {
          e.preventDefault();
          onClose();
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <div ref={card} role="dialog" aria-label={label} tabIndex={-1} className={`pop pop-${side} ${className ?? ''}`} style={style} onClick={(e) => e.stopPropagation()}>
        <i className="pop-arrow" aria-hidden />
        <div className="pop-head">
          <b className="pop-title">{title}</b>
          <CloseButton className="pop-x" label="Close" onClick={onClose} />
        </div>
        <div className="pop-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}
