// The terminal's paste sheet (#278): when the clipboard can't be read (plain http, a refused read, nothing on it), one
// focused field takes the text, so the phone's own Paste bubble is a long press away. What's typed is never kept: it
// can be a sign-in code or a key.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackLayer } from './Panel';
import { isTopDialog, useDialogFocus } from './dialogFocus';
import './paste.css';

export function PasteSheet({ onSend, onClose }: { onSend: (text: string, enter: boolean) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  useDialogFocus(box);
  useBackLayer(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTopDialog(box.current)) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // the sheet closes, not the panel under it
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const ready = !!text.trim();
  return createPortal(
    <div className="paste-sheet-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="paste-sheet ds-screen" role="dialog" aria-modal="true" aria-label="Paste into the terminal" tabIndex={-1}>
        <div className="paste-sheet-head">
          <b className="grow">Paste into the terminal</b>
          <button type="button" className="panel-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="small muted">The clipboard couldn’t be read here. Long-press the box and choose Paste, or type it.</p>
        <textarea className="paste-sheet-field" aria-label="Text to paste" value={text} onChange={(e) => setText(e.target.value)} autoFocus rows={3} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
        <div className="paste-sheet-actions">
          <button type="button" className="btn" disabled={!ready} onClick={() => onSend(text, false)}>
            Send
          </button>
          <button type="button" className="btn btn-good" disabled={!ready} onClick={() => onSend(text, true)}>
            Send + Enter
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
