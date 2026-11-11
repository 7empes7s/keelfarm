import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useStore } from '../store';
import type { ChatArtifact } from '../../../shared/types';
import { artifactFileName } from '../../../shared/chatParts';
import { Markdown } from './Markdown';
import { useDialogFocus } from './dialogFocus';
import { copyText } from './clipboard';
import { CloseButton, Icon } from './Icon';
import { ChatTextPill, useChatPinch } from './ChatZoom';
import { useSurface, type SurfaceId } from './surfaces';

// The CEO's artifacts in the phone chat (shared/chatParts.ts): a card in the bubble, the document full-screen on a
// phone (a side panel on a desktop) with Copy, Share / Download, "Reply about this" and "Open in thread" (#132).

const toast = (ok: boolean, yes: string, no: string) => useStore.getState().pushToast(ok ? 'success' : 'error', ok ? yes : no);

/** An artifact's card in a bubble: its title and first line; opens the document. */
export function ArtifactCard({ artifact, onOpen }: { artifact: ChatArtifact; onOpen: () => void }) {
  return (
    <button type="button" className="artifact-card" onClick={onOpen} aria-label={`Open the attachment ${artifact.title}`}>
      <span className="artifact-card-icon" aria-hidden>
        <Icon name="file-text" />
      </span>
      <span className="grow artifact-card-body">
        <b className="artifact-card-title">{artifact.title}</b>
        {artifact.lead && <span className="artifact-card-lead">{artifact.lead}</span>}
      </span>
      <span className="artifact-card-open" aria-hidden>
        Open
      </span>
    </button>
  );
}

function download(title: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = artifactFileName(title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function share(title: string, markdown: string) {
  const file = new File([markdown], artifactFileName(title), { type: 'text/markdown' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ title, files: [file] });
    else await navigator.share({ title, text: markdown });
  } catch (err) {
    if ((err as Error).name !== 'AbortError') download(title, markdown); // the share sheet said no: save it instead
  }
}

/** `surface`: the page it shows (surfaces.ts), so the chat's side panels don't show it again and a second ask focuses this one. */
export function Sheet({ label, onClose, className, surface, children }: { label: ReactNode; onClose: () => void; className?: string; surface?: SurfaceId; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useSurface(surface);
  const titleId = useId();
  useDialogFocus(ref);
  useEffect(() => ref.current?.focus(), []);
  // A reader's text pinches like the chat's (#135).
  const [dialog, setDialog] = useState<HTMLDivElement | null>(null);
  useEffect(() => setDialog(ref.current), []);
  useChatPinch(dialog, useCallback(() => ref.current?.querySelector<HTMLElement>('.artifact-body') ?? null, []));
  return createPortal(
    <div className="artifact-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`artifact-sheet ${className ?? ''}`}
        data-surface={surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          // Esc closes this sheet only, not the phone under it.
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <div className="artifact-head">
          <b id={titleId} className="grow artifact-title">
            {label}
          </b>
          <CloseButton className="chat-reply-x" label="Close" title="Close (Esc)" onClick={onClose} />
        </div>
        <ChatTextPill />
        {children}
      </div>
    </div>,
    document.body,
  );
}

interface ViewProps {
  messageId: number;
  artifact: ChatArtifact;
  linked: (text: string) => string;
  onFloor: (floor: number) => void;
  onReplyAbout?: (messageId: number, title: string) => void; // absent: another thread's
  onOpenInThread?: () => void; // from Files & artifacts: back to the message it came in (#132)
  onClose: () => void;
}

/** One artifact, full-screen (a side panel on a wide screen). Its markdown is fetched when the snapshot left it out. */
export function ArtifactView({ messageId, artifact, linked, onFloor, onReplyAbout, onOpenInThread, onClose }: ViewProps) {
  const [fetched, setFetched] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const markdown = artifact.markdown ?? fetched;
  useEffect(() => {
    if (artifact.markdown !== undefined) return;
    let live = true;
    api.artifact(messageId, artifact.id).then(
      (r) => live && setFetched(r.markdown),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [messageId, artifact.id, artifact.markdown]);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <Sheet label={<><Icon name="file-text" /> {artifact.title}</>} onClose={onClose}>
      <div className="artifact-body">
        {markdown !== null ? (
          <Markdown className="artifact-md" text={linked(markdown)} onFloor={onFloor} />
        ) : (
          <p className="muted">{failed ? 'This attachment is no longer saved.' : 'Loading…'}</p>
        )}
      </div>
      <div className="artifact-actions">
        <button type="button" className="btn btn-small" disabled={markdown === null} onClick={() => markdown !== null && void copyText(markdown).then((ok) => toast(ok, 'Copied as markdown', "Couldn't reach the clipboard"))}>
          <Icon name="clipboard-list" /> Copy
        </button>
        {canShare && (
          <button type="button" className="btn btn-small" disabled={markdown === null} onClick={() => markdown !== null && void share(artifact.title, markdown)}>
            <Icon name="upload" /> Share
          </button>
        )}
        <button type="button" className="btn btn-small" disabled={markdown === null} onClick={() => markdown !== null && download(artifact.title, markdown)}>
          <Icon name="download" /> Download .md
        </button>
        {onOpenInThread && (
          <button type="button" className="btn btn-small" onClick={() => (onClose(), onOpenInThread())}>
            <Icon name="message-circle" /> Open in thread
          </button>
        )}
        {onReplyAbout && (
          <button
            type="button"
            className="btn btn-small btn-good"
            onClick={() => {
              onClose();
              onReplyAbout(messageId, artifact.title);
            }}
          >
            <Icon name="reply" /> Reply about this
          </button>
        )}
      </div>
    </Sheet>
  );
}
