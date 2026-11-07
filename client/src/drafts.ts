// What the manager is writing survives a reload, a crash or an office update (#216): composers' drafts (text and
// picked files) and the chat's outbox, kept in IndexedDB per conversation. Every storage call is wrapped: where
// IndexedDB is missing or refuses (private mode), they live in memory for this page only.
import { useEffect, useRef } from 'react';

/** A tiny key-value store: IndexedDB here, a Map in tests and private mode. */
export interface Kv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export function memoryKv(): Kv {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
  };
}

/** IndexedDB's object store `kv` in database `name`; on the first error everything goes to memory instead. */
function idbKv(name = 'cubefarm-drafts'): Kv {
  const mem = memoryKv();
  let db: Promise<IDBDatabase> | null = null;
  let broken = typeof indexedDB === 'undefined';
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
    const t = (await open()).transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    return new Promise<T>((resolve, reject) => {
      t.oncomplete = () => resolve(req.result as T);
      t.onerror = t.onabort = () => reject(t.error);
    });
  };
  const safely = async <T,>(idb: () => Promise<T>, fallback: () => Promise<T>): Promise<T> => {
    if (!broken) {
      try {
        return await idb();
      } catch (err) {
        console.warn('drafts stay in memory only:', err);
        broken = true;
      }
    }
    return fallback();
  };
  return {
    get: (k) => safely(() => tx('readonly', (s) => s.get(k)), () => mem.get(k)),
    set: (k, v) => safely(() => tx<void>('readwrite', (s) => s.put(v, k)).then(() => undefined), () => mem.set(k, v)),
    del: (k) => safely(() => tx<void>('readwrite', (s) => s.delete(k)).then(() => undefined), () => mem.del(k)),
  };
}

/** Drafts on a store: saves wait `delayMs` after the last change to a key (typing), `flush` writes them now. */
export function createDrafts(kv: Kv, delayMs = 300) {
  const waiting = new Map<string, { value: unknown; timer: ReturnType<typeof setTimeout> }>();
  const write = (key: string, value: unknown) => (value === null ? kv.del(key) : kv.set(key, value)).catch(() => undefined);
  const now = (key: string) => {
    const w = waiting.get(key);
    if (!w) return Promise.resolve();
    clearTimeout(w.timer);
    waiting.delete(key);
    return write(key, w.value);
  };
  return {
    /** Keeps `value` for `key` (null forgets it), 300 ms after the last change. */
    save(key: string, value: unknown) {
      clearTimeout(waiting.get(key)?.timer);
      waiting.set(key, { value, timer: setTimeout(() => void now(key), delayMs) });
    },
    /** The latest value for `key`, a save still waiting included. */
    async load<T>(key: string): Promise<T | undefined> {
      const w = waiting.get(key);
      if (w) return (w.value ?? undefined) as T | undefined;
      try {
        return ((await kv.get(key)) ?? undefined) as T | undefined;
      } catch {
        return undefined;
      }
    },
    /** Writes every waiting save (before a reload). */
    flush: () => Promise.all([...waiting.keys()].map(now)).then(() => undefined),
    /** Written at once, not debounced: the outbox must be on disk before its message leaves. */
    put: (key: string, value: unknown) => write(key, value),
  };
}

export const drafts = createDrafts(idbKv());

/**
 * A composer's draft under `key` (e.g. the CEO conversation's id): restored when the key is shown, saved on every
 * change after that, forgotten when `empty`. On first mount, typing before the stored draft arrives keeps what was
 * typed; switching keys shows that key's draft, or `blank`.
 */
export function useDraft<T>(key: string, value: T, blank: T, empty: (v: T) => boolean, restore: (v: T) => void) {
  const ready = useRef<string | null>(null);
  const first = useRef(true);
  const latest = useRef({ value, blank, empty, restore });
  latest.current = { value, blank, empty, restore };
  useEffect(() => {
    let live = true;
    ready.current = null;
    const mount = first.current;
    first.current = false;
    void drafts.load<T>(key).then((saved) => {
      if (!live) return;
      ready.current = key;
      const l = latest.current;
      if (!mount) l.restore(saved ?? l.blank);
      else if (saved !== undefined && l.empty(l.value)) l.restore(saved);
    });
    return () => void (live = false);
  }, [key]);
  useEffect(() => {
    if (ready.current !== key) return;
    drafts.save(key, empty(value) ? null : value);
  }, [key, value, empty]);
}
