import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Icon } from './Icon';
import { anchoredTop, removal, UNDO_MS, wantsOlder, withOlder, type ChatPage } from '../../../shared/chatPage';
import type { PhoneMessage } from '../../../shared/types';

// A chat in pages (#145, shared/chatPage.ts): older messages load as the list nears its top, the scroll held on the same
// message; and removing a message, with Undo for a few seconds before it goes to the office. For the CEO chat now,
// agent chats and threads later.

/**
 * Loads the page before `first` (the oldest message shown) as `scroller` nears its top, while `older` says there is
 * one. `fetch` gets it, `apply` puts it in; the list then scrolls by what went in above, so nothing jumps.
 */
export function useOlderPages<T>(scroller: RefObject<HTMLElement | null>, o: { first: number | undefined; older: boolean; fetch: (before: number) => Promise<T>; apply: (page: T) => void }) {
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const anchor = useRef<{ top: number; height: number } | null>(null);
  const opts = useRef(o);
  opts.current = o;
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    anchor.current = null;
    if (el && a) el.scrollTop = anchoredTop(a, el.scrollHeight);
  }, [o.first, scroller]);
  const onScroll = useCallback(
    (el: HTMLElement) => {
      const { first, older, fetch, apply } = opts.current;
      if (first === undefined || !wantsOlder(el.scrollTop, { older, loading: busy.current })) return;
      busy.current = true;
      setLoading(true);
      void fetch(first)
        .then((page) => {
          anchor.current = { top: el.scrollTop, height: el.scrollHeight }; // where it is now, the moment the page goes in
          apply(page);
        })
        .catch(() => undefined) // api() already toasted it; the next scroll tries again
        .finally(() => {
          busy.current = false;
          setLoading(false);
        });
    },
    [],
  );
  return { loading, onScroll };
}

/** The CEO chat's page before a message, into the store (never during the time-lapse: it shows a recorded day). */
export const fetchChatPage = (before: number) => (useStore.getState().replaying ? Promise.reject(new Error('replaying')) : api.chatMessages(before));
export const applyChatPage = (page: ChatPage) => useStore.setState((s) => ({ messages: withOlder(s.messages, page.messages), chatOlder: page.older }));

/** The spinner at the top of the list while a page loads. */
export function OlderSpinner({ loading }: { loading: boolean }) {
  return loading ? (
    <div className="chat-older" role="status">
      <span className="chat-older-spin" aria-hidden />
      <span className="sr-only">Loading earlier messages</span>
    </div>
  ) : null;
}

/**
 * Removing messages: gone from the list at once, sent to the office after UNDO_MS unless undone (or at once when the
 * chat closes). `hidden`: the ones to leave out; `action`: a message's menu entry; `bar`: the Undo bar.
 */
export function useRemovals(away = false) {
  const [pending, setPending] = useState<{ id: number; kind: 'delete' | 'hide' }[]>([]);
  const timers = useRef(new Map<number, number>());
  const commit = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setPending((p) => p.filter((x) => x.id !== id));
    void api.removeMessage(id).catch(() => undefined);
  }, []);
  // Leaving the chat (closed, or away on another tab) commits what's waiting.
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of t.keys()) commit(id);
    };
  }, [commit, away]);
  const remove = (m: Pick<PhoneMessage, 'id' | 'from'>) => {
    setPending((p) => [...p, { id: m.id, kind: removal(m) }]);
    timers.current.set(
      m.id,
      window.setTimeout(() => commit(m.id), UNDO_MS),
    );
  };
  const undo = (id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setPending((p) => p.filter((x) => x.id !== id));
  };
  /** The actions menu's entry: Delete, or Hide for the CEO's. */
  const action = (m: Pick<PhoneMessage, 'id' | 'from'>) => (removal(m) === 'hide' ? { label: 'Hide', icon: 'eye-off' as const, run: () => remove(m) } : { label: 'Delete', icon: 'trash-2' as const, run: () => remove(m) });
  const last = pending[pending.length - 1];
  const bar = last && (
    <div className="chat-reply chat-undo" role="status">
      <b className="grow small">
        <Icon name={last.kind === 'hide' ? 'eye-off' : 'trash-2'} /> {last.kind === 'hide' ? 'Message hidden' : 'Message deleted'}
      </b>
      <button type="button" className="btn btn-small" onClick={() => undo(last.id)}>
        Undo
      </button>
    </div>
  );
  return { hidden: pending, action, bar };
}
