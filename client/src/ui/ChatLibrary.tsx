import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import './threads.css';
import type { PhoneMessage } from '../../../shared/types';
import type { Conversation } from '../../../shared/conversations';
import { fileKind, formatSize, inlineType } from '../../../shared/files';
import { filterLibrary, LIBRARY_FILTERS, libraryCounts, libraryItems, type LibraryFilter, type LibraryItem } from '../../../shared/library';
import { FILE_ICONS, FilesList } from './ChatFiles';
import { Icon } from './Icon';

// The chat's Files & artifacts (#132): the thread's (or its project's, or the whole office's) artifacts and files as
// cards with an icon or thumbnail, title, date and size, filtered All / Artifacts / Images / Documents. The open
// thread's are built here from its messages; the others come from the office a page at a time.

type Scope = 'thread' | 'project' | 'all';

/** The open thread's artifacts and attachments (its 📎 count is their number). */
export function useThreadLibrary(messages: readonly PhoneMessage[]) {
  const current = useStore((s) => s.chat.current);
  return useMemo(() => libraryItems([{ id: current, messages }]), [current, messages]);
}

const when = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Card({ item, onOpen }: { item: LibraryItem; onOpen: () => void }) {
  const f = item.file;
  const thumb = f && f.type.startsWith('image/') && inlineType(f.type) && !/hei[cf]/.test(f.type);
  const icon = item.kind === 'artifact' ? 'file-text' : FILE_ICONS[(f && fileKind(f.name, f.type)) ?? 'document'];
  const size = item.size === null ? 'Artifact' : formatSize(item.size);
  return (
    <li>
      <button type="button" className="lib-card" onClick={onOpen} aria-label={`${item.title}, ${size}, ${when(item.at)}: open`}>
        {thumb ? <img className="lib-thumb" src={`/api/files/${f.id}`} alt="" loading="lazy" /> : <span className="lib-icon" aria-hidden>
            <Icon name={icon} />
          </span>}
        <span className="lib-text">
          <b className="lib-title">{item.title}</b>
          {item.lead && <span className="lib-lead small">{item.lead}</span>}
          <span className="small muted">
            {when(item.at)} · {size}
          </span>
        </span>
      </button>
    </li>
  );
}

interface Props {
  messages: readonly PhoneMessage[];
  thread: Conversation | undefined;
  onArtifact: (item: LibraryItem) => void;
  onFile: (item: LibraryItem) => void;
}

export function ChatLibrary({ messages, thread, onArtifact, onFile }: Props) {
  const repos = useStore((s) => s.repos);
  const files = useStore((s) => s.files);
  const own = useThreadLibrary(messages);
  const [scope, setScope] = useState<Scope>('thread');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [fetched, setFetched] = useState<{ items: LibraryItem[]; next: string | null; counts: Record<LibraryFilter, number> } | null>(null);
  const [stored, setStored] = useState(false);
  const project = thread?.repoId ? repos.find((r) => r.id === thread.repoId) : undefined;
  const server = scope === 'project' ? (project?.id ?? 'company') : 'all';
  useEffect(() => {
    if (scope === 'thread') return setFetched(null);
    let live = true;
    setFetched(null);
    api.library(server, filter).then((r) => live && setFetched(r), () => live && setFetched({ items: [], next: null, counts: { all: 0, artifact: 0, image: 0, document: 0 } }));
    return () => {
      live = false;
    };
  }, [scope, server, filter, messages.length, files.length]);
  const more = () => fetched?.next && void api.library(server, filter, fetched.next).then((r) => setFetched({ ...r, items: [...fetched.items, ...r.items] }), () => undefined);
  const counts = scope === 'thread' ? libraryCounts(own) : fetched?.counts;
  const items = scope === 'thread' ? filterLibrary(own, filter) : fetched?.items;
  const scopes: [Scope, string][] = [
    ['thread', 'This thread'],
    ['project', project ? `Floor ${project.floor}` : 'Company'],
    ['all', 'Everything'],
  ];
  return (
    <div className="chat-library">
      <div className="lib-bar">
        <div className="seg lib-scopes" role="group" aria-label="Whose files">
          {scopes.map(([id, label]) => (
            <button key={id} type="button" className={`seg-btn ${scope === id ? 'seg-on' : ''}`} aria-pressed={scope === id} onClick={() => setScope(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="thread-scopes" role="group" aria-label="Kind of file">
          {LIBRARY_FILTERS.map((f) => (
            <button key={f.id} type="button" className={`thread-scope ${filter === f.id ? 'thread-scope-on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {counts ? ` ${counts[f.id]}` : ''}
            </button>
          ))}
        </div>
      </div>
      <div className="lib-body">
        {!items ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">{filter === 'all' ? 'Nothing here yet. Plans, reports and tables the CEO writes, and the files you send, show up here.' : 'None of this kind here.'}</p>
        ) : (
          <ul className="lib-list">
            {items.map((i) => (
              <Card key={i.key} item={i} onOpen={() => (i.kind === 'artifact' ? onArtifact(i) : onFile(i))} />
            ))}
          </ul>
        )}
        {scope !== 'thread' && fetched?.next && (
          <button type="button" className="btn conv-new" onClick={more}>
            Show more
          </button>
        )}
        <button type="button" className="btn conv-new" onClick={() => setStored(true)}>
          <Icon name="archive" /> Stored files ({files.length}): keep or delete
        </button>
      </div>
      {stored && (
        <FilesList
          onClose={() => setStored(false)}
          onOpen={(id) => {
            setStored(false);
            const f = files.find((x) => x.id === id);
            if (f) onFile({ key: `f:${id}`, kind: 'document', title: f.name, at: f.at, size: f.size, from: f.from, messageId: null, conversationId: null, file: f });
          }}
        />
      )}
    </div>
  );
}
