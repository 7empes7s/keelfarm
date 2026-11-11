import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import './threads.css';
import { groupThreads, inScope, unreadThread, type Conversation, type ConversationHit, type ThreadScope } from '../../../shared/conversations';
import { Sheet } from './ChatArtifacts';
import { Icon } from './Icon';
import { RunChip } from './RunChip';
import { CeoMemory } from './CeoMemory';
import { Menu } from './Menu';

// The CEO chat's threads (#51, #132), like Claude's sidebar: a new one (a fresh CEO session) in a floor's project or
// the Company, the list by project with search, grouped Pinned / Today / This week / Older, each with its floors,
// last activity and unread dot; rename, pin and archive in its ⋯. A sheet on a phone, a column beside the chat when wide.

const PAGE = 30;
const when = (at: number, now: number) =>
  new Date(at).toLocaleString([], now - at < 24 * 3600_000 ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' });

function Row({ c, current, unread, snippet, floorOf, onOpen }: { c: Conversation; current: boolean; unread: boolean; snippet?: string; floorOf: (id: string) => string; onOpen: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(c.title);
  const edit = (patch: Parameters<typeof api.editConversation>[1]) => void api.editConversation(c.id, patch).catch(() => undefined);
  const floors = [...new Set([...(c.repoId ? [c.repoId] : []), ...(c.floors ?? [])])];
  if (renaming)
    return (
      <li className="conv-row thread-renaming">
        <form
          className="thread-rename"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && title.trim() !== c.title) edit({ title });
            setRenaming(false);
          }}
        >
          <input className="conv-search" value={title} onChange={(e) => setTitle(e.target.value)} aria-label={`New title for “${c.title}”`} autoFocus onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setRenaming(false))} />
          <button className="btn btn-small btn-good">Save</button>
        </form>
      </li>
    );
  return (
    <li className={`conv-row ${current ? 'conv-row-current' : ''}`}>
      <button type="button" className="conv-open" onClick={onOpen} aria-current={current || undefined}>
        <span className="thread-top">
          {unread && <span className="thread-unread" aria-label="Unread" />}
          <b className="conv-title">
            {c.pinned && <span aria-label="Pinned"><Icon name="pin" /> </span>}
            {c.title}
          </b>
          <span className="muted small thread-when">{when(c.updatedAt, Date.now())}</span>
        </span>
        <span className="thread-meta small muted">
          {floors.length ? floors.map((f) => <span key={f} className="thread-floor">{floorOf(f)}</span>) : <span className="thread-floor">Company</span>}
          <span>
            {c.count} message{c.count === 1 ? '' : 's'}
            {c.files ? (
              <>
                {' · '}
                <Icon name="paperclip" /> {c.files}
              </>
            ) : null}
          </span>
        </span>
        <RunChip run={c.run} />
        {snippet && <span className="small conv-snippet">{snippet}</span>}
      </button>
      <Menu
        label={`More for “${c.title}”`}
        title={c.title}
        className="thread-more"
        items={[
          { label: 'Rename', onSelect: () => (setTitle(c.title), setRenaming(true)) },
          { label: c.pinned ? 'Unpin' : 'Pin', hint: c.pinned ? undefined : 'Kept at the top, and never dropped', onSelect: () => edit({ pinned: !c.pinned }) },
          { label: c.archived ? 'Unarchive' : 'Archive', hint: c.archived ? undefined : 'Out of the list, still searchable', onSelect: () => edit({ archived: !c.archived }) },
        ]}
      />
    </li>
  );
}

/** The list itself; `onDone`: after opening or starting a thread (the sheet closes). */
function Threads({ ceoName, onDone, onMemory }: { ceoName: string; onDone: () => void; onMemory: () => void }) {
  const chat = useStore((s) => s.chat);
  const repos = useStore((s) => s.repos);
  const readAt = useStore((s) => s.phoneReadAt);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ConversationHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<ThreadScope>('all');
  const [archived, setArchived] = useState(false);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    if (!q.trim()) return setHits(null);
    let stale = false;
    const t = setTimeout(() => void api.searchConversations(q.trim()).then((r) => !stale && setHits(r.hits)).catch(() => !stale && setHits([])), 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn()
      .then(onDone)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  const floorOf = (id: string) => {
    const r = repos.find((x) => x.id === id);
    return r ? `Floor ${r.floor}` : 'A floor';
  };
  const project = scope !== 'all' && scope !== 'company' ? repos.find((r) => r.id === scope) : undefined;
  const snippets = new Map(hits?.map((h) => [h.id, h.snippet]));
  // A search looks in archived threads too.
  const groups = hits ? [{ group: 'Found', threads: chat.conversations.filter((c) => snippets.has(c.id) && inScope(c, scope)) }] : groupThreads(chat.conversations, Date.now(), { scope, archived });
  const archivedCount = chat.conversations.filter((c) => c.archived && inScope(c, scope)).length;
  let left = shown;
  return (
    <div className="artifact-body conv-body">
      <button type="button" className="btn btn-good conv-new" disabled={busy} onClick={() => act(() => api.newConversation(project?.id ?? null))} title="A fresh start: the CEO begins a new session, its notes carry over">
        ＋ New thread{project ? ` on floor ${project.floor}` : ''}
      </button>
      <input className="conv-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every thread…" aria-label="Search threads" />
      <div className="thread-scopes" role="group" aria-label="Projects">
        {(['all', 'company', ...repos.map((r) => r.id)] as ThreadScope[]).map((s) => (
          <button key={s} type="button" className={`thread-scope ${scope === s ? 'thread-scope-on' : ''}`} aria-pressed={scope === s} onClick={() => (setScope(s), setShown(PAGE))}>
            {s === 'all' ? 'All' : s === 'company' ? 'Company' : floorOf(s)}
          </button>
        ))}
      </div>
      {groups.every((g) => !g.threads.length) ? (
        <p className="muted">{hits ? 'Nothing matches.' : archived ? 'No archived threads.' : 'No threads here yet.'}</p>
      ) : (
        groups.map(({ group, threads }) => {
          const page = threads.slice(0, Math.max(0, left));
          left -= page.length;
          if (!page.length) return null;
          return (
            <section key={group} className="thread-group" aria-label={group}>
              <h3 className="thread-group-head">{group}</h3>
              <ul className="conv-list">
                {page.map((c) => (
                  <Row key={c.id} c={c} current={c.id === chat.current} unread={c.id !== chat.current && unreadThread(c, readAt)} snippet={snippets.get(c.id)} floorOf={floorOf} onOpen={() => (c.id === chat.current ? onDone() : act(() => api.openConversation(c.id)))} />
                ))}
              </ul>
            </section>
          );
        })
      )}
      {groups.reduce((n, g) => n + g.threads.length, 0) > shown && (
        <button type="button" className="btn conv-new" onClick={() => setShown(shown + PAGE)}>
          Show more
        </button>
      )}
      {!hits && (archived || archivedCount > 0) && (
        <button type="button" className="btn conv-new" aria-pressed={archived} onClick={() => (setArchived(!archived), setShown(PAGE))}>
          {archived ? (
            <>
              <Icon name="chevron-left" /> Back to the threads
            </>
          ) : (
            <>
              <Icon name="archive" /> Archived ({archivedCount})
            </>
          )}
        </button>
      )}
      <button type="button" className="btn conv-new" onClick={onMemory}>
        <Icon name="brain" /> What {ceoName} remembers
      </button>
    </div>
  );
}

/** `onMemory`: opens what the CEO remembers (#81: it shares the top bar's 🔍 with the threads). */
export function Conversations({ ceoName, onClose, onMemory }: { ceoName: string; onClose: () => void; onMemory: () => void }) {
  return (
    <Sheet label="Threads" onClose={onClose} className="conv-sheet">
      <Threads ceoName={ceoName} onDone={onClose} onMemory={onMemory} />
    </Sheet>
  );
}

/** The threads in a column beside the chat on a wide screen (#132). */
export function ThreadsColumn({ ceoName }: { ceoName: string }) {
  const [memory, setMemory] = useState(false);
  return (
    <nav className="threads-col" aria-label="Threads">
      <Threads ceoName={ceoName} onDone={() => undefined} onMemory={() => setMemory(true)} />
      {memory && <CeoMemory ceoName={ceoName} onClose={() => setMemory(false)} />}
    </nav>
  );
}
