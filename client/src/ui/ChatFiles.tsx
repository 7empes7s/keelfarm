import { useEffect, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { daysLeft, fileKind, formatSize, inlineType, type FileKind, type FileRef, type FileView } from '../../../shared/files';
import { usedLine, type QuickPicks, type UsedView } from '../../../shared/used';
import { slashItems } from './chatCardRules';
import './chatCards.css';
import { Sheet } from './ChatArtifacts';
import type { Pending } from './chatUpload';
import { CloseButton, Icon } from './Icon';
import type { IconName } from './icons';

// Files in the CEO chat (shared/files.ts): cards in the bubbles (a thumbnail for images, a chip for the rest), the
// full-size viewer, the tray of files being attached, the Files list, "Used" under a CEO reply and the "/" picks.

export const FILE_ICONS: Record<FileKind, IconName> = { image: 'image', video: 'video', pdf: 'book-open', document: 'notebook-pen', slides: 'chart-column', sheet: 'trending-up', text: 'file-text', archive: 'archive' };
const fileIcon = (f: Pick<FileRef, 'name' | 'type'>) => FILE_ICONS[fileKind(f.name, f.type) ?? 'text'];
const url = (id: string, download = false) => `/api/files/${id}${download ? '?download' : ''}`;
/** Images the browser can draw (HEIC is kept as it is and shown as a chip). */
const drawable = (type: string) => type.startsWith('image/') && inlineType(type) && !/hei[cf]/.test(type);

async function share(f: FileRef) {
  try {
    const blob = await (await fetch(url(f.id))).blob();
    const file = new File([blob], f.name, { type: f.type });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ title: f.name, files: [file] });
    else await navigator.share({ title: f.name, url: new URL(url(f.id), location.href).href });
  } catch (err) {
    if ((err as Error).name !== 'AbortError') useStore.getState().pushToast('error', "Couldn't share that file");
  }
}
const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

function KeepButton({ f }: { f: FileView }) {
  return (
    <button
      type="button"
      className={`btn btn-small ${f.keep ? 'btn-good' : ''}`}
      aria-pressed={f.keep}
      title={f.keep ? 'Kept: never deleted. Tap to let it go after its 30 days.' : `Deleted in ${daysLeft(f, Date.now())} days unless kept`}
      onClick={() => void api.keepFile(f.id, !f.keep)}
    >
      <Icon name="pin" /> {f.keep ? 'Kept' : 'Keep'}
    </button>
  );
}

/** A file in a bubble; "expired" once the store no longer has it. */
export function FileCard({ file, onOpen }: { file: FileRef; onOpen: (id: string) => void }) {
  const f = useStore((s) => s.files.find((x) => x.id === file.id));
  if (!f)
    return (
      <div className="file-card file-gone" aria-label={`${file.name}: expired`}>
        <span aria-hidden><Icon name={fileIcon(file)} /></span> <span className="grow file-name">{file.name}</span> <span className="small">expired</span>
      </div>
    );
  if (drawable(f.type))
    return (
      <button type="button" className="file-thumb" onClick={() => onOpen(f.id)} aria-label={`${f.name}, ${formatSize(f.size)}: show full size`}>
        <img src={url(f.id)} alt={f.name} loading="lazy" />
      </button>
    );
  const k = fileKind(f.name, f.type);
  const preview = k === 'pdf' || k === 'video' || drawable(f.type);
  return (
    <div className="file-card">
      <span className="file-icon" aria-hidden>
        <Icon name={fileIcon(f)} />
      </span>
      <span className="grow file-body">
        <b className="file-name">{f.name}</b>
        <span className="small muted">
          {formatSize(f.size)}
          {f.keep && (
            <>
              {' '}
              · <Icon name="pin" /> kept
            </>
          )}
        </span>
      </span>
      {preview && (
        <button type="button" className="btn btn-small" onClick={() => onOpen(f.id)} aria-label={`Preview ${f.name}`}>
          <Icon name="eye" />
        </button>
      )}
      <a className="btn btn-small" href={url(f.id, true)} download={f.name} aria-label={`Download ${f.name}`}>
        <Icon name="download" />
      </a>
      {!preview && (
        <button type="button" className="btn btn-small" onClick={() => onOpen(f.id)} aria-label={`More about ${f.name}`}>
          <Icon name="ellipsis" />
        </button>
      )}
    </div>
  );
}

/** One file full size (images, PDFs, video) or its details, with Download, Share and Keep. */
export function FileViewer({ id, onClose, onOpenInThread }: { id: string; onClose: () => void; onOpenInThread?: () => void }) {
  const f = useStore((s) => s.files.find((x) => x.id === id));
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (!f) onClose();
  }, [f, onClose]);
  if (!f) return null;
  const k = fileKind(f.name, f.type);
  const left = daysLeft(f, Date.now());
  return (
    <Sheet label={<><Icon name={fileIcon(f)} /> {f.name}</>} onClose={onClose} className="file-viewer">
      <div className="artifact-body file-view-body">
        {drawable(f.type) ? (
          // a tap zooms to full size (scroll to pan), another fits it again
          <button type="button" className={`file-zoom ${zoom ? 'file-zoomed' : ''}`} aria-pressed={zoom} aria-label={zoom ? 'Fit to the screen' : 'Zoom in'} onClick={() => setZoom(!zoom)}>
            <img src={url(f.id)} alt={f.name} className="file-full" />
          </button>
        ) : k === 'pdf' ? (
          <iframe src={url(f.id)} title={f.name} className="file-full file-pdf" />
        ) : k === 'video' ? (
          <video src={url(f.id)} controls playsInline className="file-full" />
        ) : (
          <p className="muted">No preview for this kind of file: download it to open it.</p>
        )}
        <p className="small muted">
          {formatSize(f.size)} · from {f.from === 'manager' ? 'you' : f.from === 'ceo' ? 'the CEO' : 'an agent'} · {f.keep ? `kept${f.keepReason ? ` (${f.keepReason})` : ''}` : left ? `deletes in ${left} day${left === 1 ? '' : 's'}` : 'deletes today'}
        </p>
      </div>
      <div className="artifact-actions">
        <a className="btn btn-small btn-good" href={url(f.id, true)} download={f.name}>
          <Icon name="download" /> Download
        </a>
        {canShare() && (
          <button type="button" className="btn btn-small" onClick={() => void share(f)}>
            <Icon name="upload" /> Share
          </button>
        )}
        <KeepButton f={f} />
        {onOpenInThread && (
          <button type="button" className="btn btn-small" onClick={() => (onClose(), onOpenInThread())}>
            <Icon name="message-circle" /> Open in thread
          </button>
        )}
      </div>
    </Sheet>
  );
}

const ago = (at: number, now: number) => {
  const d = Math.floor((now - at) / (24 * 3600_000));
  if (d >= 1) return `${d} day${d === 1 ? '' : 's'} ago`;
  const h = Math.floor((now - at) / 3600_000);
  return h >= 1 ? `${h} h ago` : 'just now';
};

/** Every file in the store: size, age, kept or "deletes in N days", Keep and Delete now, and the total used. */
export function FilesList({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const files = useStore((s) => s.files);
  const [sure, setSure] = useState<string | null>(null);
  const now = Date.now();
  const total = files.reduce((n, f) => n + f.size, 0);
  return (
    <Sheet label={`Files (${files.length})`} onClose={onClose} className="files-list">
      <div className="artifact-body">
        <p className="small muted">
          {formatSize(total)} on the office server. Files are deleted 30 days after upload unless kept (<Icon name="pin" />).
        </p>
        {files.length === 0 ? (
          <p className="muted">
            No files yet. Attach one with <Icon name="paperclip" />, or ask the CEO for a document.
          </p>
        ) : (
          <ul className="files-items">
            {files.map((f) => {
              const left = daysLeft(f, now);
              return (
                <li key={f.id} className="files-item">
                  <button type="button" className="files-open" onClick={() => onOpen(f.id)}>
                    <span aria-hidden><Icon name={fileIcon(f)} /></span> <b className="file-name">{f.name}</b>
                  </button>
                  <span className="small muted">
                    {formatSize(f.size)} · {ago(f.at, now)} ·{' '}
                    {f.keep ? (
                      <>
                        <Icon name="pin" /> kept
                      </>
                    ) : left ? (
                      `deletes in ${left} day${left === 1 ? '' : 's'}`
                    ) : (
                      'deletes today'
                    )}
                  </span>
                  <span className="files-actions">
                    <KeepButton f={f} />
                    {sure === f.id ? (
                      <button type="button" className="btn btn-small btn-bad" onClick={() => void api.deleteFile(f.id).finally(() => setSure(null))}>
                        Delete for good?
                      </button>
                    ) : (
                      <button type="button" className="btn btn-small" onClick={() => setSure(f.id)}>
                        <Icon name="trash-2" /> Delete now
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** The files waiting to go with the message: thumbnails or chips, progress, ✕ to cancel or remove. */
export function AttachTray({ pending, onRemove }: { pending: readonly Pending[]; onRemove: (key: number) => void }) {
  if (!pending.length) return null;
  return (
    <ul className="attach-tray" aria-label="Files to send">
      {pending.map((p) => (
        <li key={p.key} className={`attach-item ${p.error ? 'attach-failed' : ''}`} title={p.error ?? p.name}>
          {p.preview ? <img src={p.preview} alt="" className="attach-thumb" /> : <span aria-hidden><Icon name={fileIcon(p)} /></span>}
          <span className="attach-name">{p.name}</span>
          {p.error ? (
            <span className="small attach-error">
              <Icon name="triangle-alert" /> {p.error}
            </span>
          ) : !p.ref ? (
            <progress className="attach-progress" max={1} value={p.progress} aria-label={`Uploading ${p.name}`} />
          ) : (
            <span className="small muted">{formatSize(p.size)}</span>
          )}
          <CloseButton className="chat-reply-x" label={p.ref || p.error ? `Remove ${p.name}` : `Cancel the upload of ${p.name}`} onClick={() => onRemove(p.key)} />
        </li>
      ))}
    </ul>
  );
}

/** "Used: 2 skills · Gmail · 5 tools" under a CEO reply, opening to the list. */
export function UsedLine({ used }: { used: UsedView }) {
  return (
    <details className="used">
      <summary>{usedLine(used)}</summary>
      <ul>
        {used.skills.map((s) => (
          <li key={`s-${s}`}>
            <Icon name="sparkles" /> {s} skill
          </li>
        ))}
        {used.connectors.map((c) => (
          <li key={`c-${c.name}`}>
            <Icon name="plug" /> {c.name} · {c.tools} call{c.tools === 1 ? '' : 's'}
          </li>
        ))}
        {used.tools.map((t) => (
          <li key={`t-${t.name}`}>
            <Icon name="wrench" /> {t.name} × {t.count}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Files dropped anywhere on the chat; `dragging` while some are held over it. */
export function useDropZone(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const props = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => e.currentTarget === e.target && setDragging(false),
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setDragging(false);
      onFiles([...e.dataTransfer.files]);
    },
  };
  return { dragging, props };
}

/** The "/" picks for the message box: the list to show (or null) and its keys (arrows move, Enter or Tab pick). */
export function useSlash(text: string, setText: (t: string) => void, focus: () => void) {
  const [at, setAt] = useState(0);
  const floor = useStore((s) => s.repos.find((r) => r.floor === s.floor)?.floor ?? s.repos[0]?.floor ?? 1);
  const m = /^\/(\S*)$/.exec(text);
  const pick = (t: string | null) => {
    if (t) setText(t);
    setAt(0);
  };
  const picks: ReactNode = m ? (
    <SlashPicks
      query={m[1]}
      floor={floor}
      active={at}
      onPick={(t) => {
        pick(t);
        focus();
      }}
    />
  ) : null;
  /** True when the key was the list's. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (!m) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setAt((n) => Math.max(0, n + (e.key === 'ArrowDown' ? 1 : -1)));
      return true;
    }
    if (e.key !== 'Tab' && (e.key !== 'Enter' || e.shiftKey)) return false;
    e.preventDefault();
    void slashPick(m[1], at, floor).then(pick);
    return true;
  };
  return { picks, onKeyDown };
}

let picks: Promise<QuickPicks> | null = null;

/** The "/" list above the message box: the office's commands, then the manager's skills and apps; picking one starts the message with it. */
function SlashPicks({ query, floor, active, onPick }: { query: string; floor: number; active: number; onPick: (text: string) => void }) {
  const [p, setP] = useState<QuickPicks | null>(null);
  useEffect(() => {
    picks ??= api.ceoPicks().catch(() => {
      picks = null;
      return { skills: [], apps: [] };
    });
    let live = true;
    void picks.then((x) => live && setP(x));
    return () => {
      live = false;
    };
  }, []);
  const list = slashItems(p, query, floor);
  return (
    <ul className="slash-picks" role="listbox" aria-label="Commands, skills and apps">
      {!p && !list.length && <li className="muted small">Loading…</li>}
      {p && !list.length && <li className="muted small">No command, skill or app matches “{query}”.</li>}
      {list.map((x, i) => (
        <li key={x.key} role="option" aria-selected={i === active % list.length}>
          <button type="button" className={`slash-pick ${i === active % list.length ? 'slash-pick-on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(x.text)}>
            <Icon name={x.icon} /> {x.name} <span className="muted small">{x.hint}</span>
            {x.example && <span className="muted small slash-cmd-example">e.g. {x.example}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What Enter or Tab picks in the "/" list, or null when it's empty. */
async function slashPick(query: string, active: number, floor: number): Promise<string | null> {
  const p = await (picks ?? Promise.resolve(null));
  const list = slashItems(p, query, floor);
  return list.length ? list[active % list.length].text : null;
}
