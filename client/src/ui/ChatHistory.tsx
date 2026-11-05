import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { Conversation, ConversationHit } from '../../../shared/conversations';
import { Sheet } from './ChatArtifacts';

// The CEO chat's conversations (#51): a new one (a fresh CEO session), the earlier ones with search across them, and pins.

const when = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Row({ c, current, snippet, onOpen }: { c: Conversation; current: boolean; snippet?: string; onOpen: () => void }) {
  return (
    <li className={`conv-row ${current ? 'conv-row-current' : ''}`}>
      <button type="button" className="conv-open" onClick={onOpen} aria-current={current || undefined}>
        <b className="conv-title">{c.title}</b>
        <span className="muted small">
          {current ? 'Open now · ' : ''}
          {when(c.updatedAt)} · {c.count} message{c.count === 1 ? '' : 's'}
        </span>
        {snippet && <span className="small conv-snippet">{snippet}</span>}
      </button>
      <button
        type="button"
        className={`conv-pin ${c.pinned ? 'conv-pin-on' : ''}`}
        aria-pressed={c.pinned}
        aria-label={`${c.pinned ? 'Unpin' : 'Pin'} “${c.title}”`}
        title={c.pinned ? 'Unpin' : 'Pin: kept at the top, and never dropped'}
        onClick={() => void api.pinConversation(c.id, !c.pinned).catch(() => undefined)}
      >
        📌
      </button>
    </li>
  );
}

export function Conversations({ onClose }: { onClose: () => void }) {
  const chat = useStore((s) => s.chat);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ConversationHit[] | null>(null);
  const [busy, setBusy] = useState(false);
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
      .then(onClose)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  const byId = new Map(chat.conversations.map((c) => [c.id, c]));
  const shown = hits ? hits.flatMap((h) => (byId.has(h.id) ? [{ c: byId.get(h.id)!, snippet: h.snippet }] : [])) : chat.conversations.map((c) => ({ c, snippet: undefined }));
  return (
    <Sheet label="Conversations" onClose={onClose} className="conv-sheet">
      <div className="artifact-body conv-body">
        <button type="button" className="btn btn-good conv-new" disabled={busy} onClick={() => act(api.newConversation)} title="A fresh start: the CEO begins a new session, its notes carry over">
          ＋ New conversation
        </button>
        <input className="conv-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every conversation…" aria-label="Search conversations" />
        {shown.length === 0 ? (
          <p className="muted">{hits ? 'Nothing matches.' : 'No conversations yet.'}</p>
        ) : (
          <ul className="conv-list">
            {shown.map(({ c, snippet }) => (
              <Row key={c.id} c={c} current={c.id === chat.current} snippet={snippet} onOpen={() => (c.id === chat.current ? onClose() : act(() => api.openConversation(c.id)))} />
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
