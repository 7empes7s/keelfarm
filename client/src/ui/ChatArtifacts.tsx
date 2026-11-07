import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useStore } from '../store';
import type { ChatArtifact, PhoneMessage } from '../../../shared/types';
import { artifactFileName } from '../../../shared/chatParts';
import { Markdown } from './Markdown';
import { useDialogFocus } from './dialogFocus';
import { copyText } from './clipboard';
import { CloseButton } from './Icon';

// The CEO's artifacts in the phone chat (shared/chatParts.ts): a card in the bubble, the document full-screen on a
// phone (a side panel on a desktop) with Copy, Share / Download and "Reply about this", and the list of every one.

const toast = (ok: boolean, yes: string, no: string) => useStore.getState().pushToast(ok ? 'success' : 'error', ok ? yes : no);

/** An artifact's card in a bubble: its title and first line; opens the document. */
export function ArtifactCard({ artifact, onOpen }: { artifact: ChatArtifact; onOpen: () => void }) {
  return (
    <button type="button" className="artifact-card" onClick={onOpen} aria-label={`Open the attachment ${artifact.title}`}>
      <span className="artifact-card-icon" aria-hidden>
        📄
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

export function Sheet({ label, onClose, className, children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(ref);
  useEffect(() => ref.current?.focus(), []);
  return createPortal(
    <div className="artifact-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`artifact-sheet ${className ?? ''}`}
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
  onReplyAbout: (messageId: number, title: string) => void;
  onClose: () => void;
}

/** One artifact, full-screen (a side panel on a wide screen). Its markdown is fetched when the snapshot left it out. */
export function ArtifactView({ messageId, artifact, linked, onFloor, onReplyAbout, onClose }: ViewProps) {
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
    <Sheet label={`📄 ${artifact.title}`} onClose={onClose}>
      <div className="artifact-body">
        {markdown !== null ? (
          <Markdown className="artifact-md" text={linked(markdown)} onFloor={onFloor} />
        ) : (
          <p className="muted">{failed ? 'This attachment is no longer saved.' : 'Loading…'}</p>
        )}
      </div>
      <div className="artifact-actions">
        <button type="button" className="btn btn-small" disabled={markdown === null} onClick={() => markdown !== null && void copyText(markdown).then((ok) => toast(ok, 'Copied as markdown', "Couldn't reach the clipboard"))}>
          📋 Copy
        </button>
        {canShare && (
          <button type="button" className="btn btn-small" disabled={markdown === null} onClick={() => markdown !== null && void share(artifact.title, markdown)}>
            📤 Share
          </button>
        )}
        <button type="button" className="btn btn-small" disabled={markdown === null} onClick={() => markdown !== null && download(artifact.title, markdown)}>
          ⬇ Download .md
        </button>
        <button
          type="button"
          className="btn btn-small btn-good"
          onClick={() => {
            onClose();
            onReplyAbout(messageId, artifact.title);
          }}
        >
          ↩ Reply about this
        </button>
      </div>
    </Sheet>
  );
}

/** Every artifact in the conversation, newest first. */
export function ArtifactList({ messages, onOpen, onClose }: { messages: readonly PhoneMessage[]; onOpen: (messageId: number, artifactId: string) => void; onClose: () => void }) {
  const all = messages.flatMap((m) => (m.artifacts ?? []).map((a) => ({ m, a }))).reverse();
  return (
    <Sheet label={`Artifacts (${all.length})`} onClose={onClose} className="artifact-list">
      <div className="artifact-body">
        {all.length === 0 ? (
          <p className="muted">No artifacts yet. When the CEO sends a plan, a report or a list, it shows up here.</p>
        ) : (
          <ul className="artifact-items">
            {all.map(({ m, a }) => (
              <li key={a.id}>
                <ArtifactCard artifact={a} onOpen={() => onOpen(m.id, a.id)} />
                <span className="muted small artifact-when">{new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
