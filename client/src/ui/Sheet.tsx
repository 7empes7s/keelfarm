// A small sheet over whatever is open (#109): the ⓘ help, the search palette and the 3D office's guide. A bottom sheet
// on a phone, a centred card on a computer; ✕, Esc and the backdrop close it, and only it (capture phase).
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from './dialogFocus';
import { backdropClose } from './Panel';
import './finder.css';
import { CloseButton } from './Icon';

export function Sheet({ title, onClose, children, className, top }: { title: ReactNode; onClose: () => void; children: ReactNode; className?: string; top?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(box);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className={`sheet-scrim ${top ? 'sheet-scrim-top' : ''}`} {...backdropClose(onClose)}>
      <div ref={box} className={`sheet ds-screen ${className ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="sheet-head">
          <h2 className="sheet-title" id={titleId}>
            {title}
          </h2>
          <CloseButton className="panel-x" onClick={onClose} label="Close" />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
