import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from '../store';
import type { PhoneMessage } from '../../../shared/types';
import { excerpt, type OutgoingMessage } from '../../../shared/chat';
import { retrySend } from './chatSend';
import { copyText } from './clipboard';
import { useDialogFocus } from './dialogFocus';
import { ReactionBar } from './ChatReactions';

// The actions on one chat message (ui/Phone.tsx): reactions on the CEO's (#118), Reply, Copy, Retry a failed send, and the chat's own (#51).

/** A message the chat can act on: from the office (`m`), or still in this tab's outbox (`out`). */
export type Item = { m: PhoneMessage; out?: undefined } | { m?: undefined; out: OutgoingMessage };

export const who = (m: Pick<PhoneMessage, 'from'>, ceoName: string) => (m.from === 'ceo' ? ceoName : m.from === 'manager' ? 'you' : 'the office');

/** The actions on one message (long-press, right-click or ⋯): Reply, Copy text, Retry for a failed send, and `more` (edit, retry, remember). */
export function MessageActions({ item, ceoName, more, onReply, onClose }: { item: Item; ceoName: string; more: { label: string; run: () => void }[]; onReply: (id: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(ref);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('button')?.focus(), []);
  const text = item.m ? item.m.text : item.out.text;
  const from = item.m ? who(item.m, ceoName) : 'you';
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const copy = () => void copyText(text).then((ok) => useStore.getState().pushToast(ok ? 'success' : 'error', ok ? 'Copied' : "Couldn't reach the clipboard"));
  // A long-press's lifted finger sends a mouse press and a click onto the backdrop that just opened: not a dismissal.
  const [openedAt] = useState(() => Date.now());
  return (
    <div className="chat-menu-back" onClick={(e) => e.target === e.currentTarget && Date.now() - openedAt > 500 && onClose()}>
      <div
        ref={ref}
        className="chat-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <div id={titleId} className="chat-menu-title">
          Message actions · from {from}
        </div>
        <div className="chat-menu-quote">{excerpt(text, 120)}</div>
        {item.m?.from === 'ceo' && <ReactionBar m={item.m} onDone={onClose} />}
        <div className="chat-menu-actions">
          {item.m && (
            <button type="button" className="btn btn-small" onClick={act(() => onReply(item.m!.id))}>
              ↩ Reply
            </button>
          )}
          <button type="button" className="btn btn-small" onClick={act(copy)}>
            📋 Copy text
          </button>
          {more.map((x) => (
            <button key={x.label} type="button" className="btn btn-small" onClick={act(x.run)}>
              {x.label}
            </button>
          ))}
          {item.out?.delivery === 'failed' && (
            <button type="button" className="btn btn-small btn-good" onClick={act(() => retrySend(item.out!.key))}>
              ⟳ Retry
            </button>
          )}
          <button type="button" className="btn btn-small" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
