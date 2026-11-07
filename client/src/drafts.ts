// Drafts that survive a reload or a crash (#216): each message box's text, and the CEO chat's uploaded files, per
// conversation in localStorage, saved 300 ms after the last change and at once before the page goes. A box with text
// holds the office's new client back (updateLoad.ts). Without storage (private mode) they live in memory only.
import { useCallback, useEffect, useRef, useState } from 'react';
import { markBusy } from './updateGate';

const PREFIX = 'cubefarm:draft:';
const DRAFT_SAVE_MS = 300;

/** Where drafts are kept: localStorage, or this page's memory when it can't be written. */
export type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const memory = new Map<string, string>();
const inMemory: DraftStore = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v), removeItem: (k) => void memory.delete(k) };
let chosen: DraftStore | null = null;

function storage(): DraftStore {
  if (chosen) return chosen;
  try {
    localStorage.setItem(`${PREFIX}?`, '1');
    localStorage.removeItem(`${PREFIX}?`);
    chosen = localStorage;
  } catch {
    chosen = inMemory;
  }
  return chosen;
}

/** A draft saved under `key` (e.g. "ceo:3", "agent:ada"), or null. */
export function readDraft<T>(key: string, s: DraftStore = storage()): T | null {
  try {
    const raw = s.getItem(PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

/** Saves a draft; an empty one (null, '' or []) is removed. */
export function writeDraft(key: string, value: unknown, s: DraftStore = storage()) {
  try {
    if (value === null || value === '' || (Array.isArray(value) && !value.length)) s.removeItem(PREFIX + key);
    else s.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // full or blocked: this draft stays on screen only
  }
}

/** A message box's text, kept under `key` while `keep` (not while it holds a message being edited). */
export function useDraft(key: string, keep = true): [string, (text: string | ((was: string) => string)) => void] {
  const [state, setState] = useState(() => ({ key, text: readDraft<string>(key) ?? '' }));
  const current = state.key === key ? state : { key, text: readDraft<string>(key) ?? '' };
  if (current !== state) setState(current);
  const { text } = current;
  const latest = useRef({ key, text, keep });
  latest.current = { key, text, keep };
  useEffect(() => {
    markBusy(`draft:${key}`, 'draft', !!text.trim());
    const t = keep ? setTimeout(() => writeDraft(key, text), DRAFT_SAVE_MS) : undefined;
    return () => {
      clearTimeout(t);
      markBusy(`draft:${key}`, 'draft', false);
    };
  }, [key, text, keep]);
  useEffect(() => {
    const flush = () => latest.current.keep && writeDraft(latest.current.key, latest.current.text);
    for (const ev of ['pagehide', 'cubefarm:unload']) window.addEventListener(ev, flush);
    return () => {
      flush();
      for (const ev of ['pagehide', 'cubefarm:unload']) window.removeEventListener(ev, flush);
    };
  }, []);
  const set = useCallback((t: string | ((was: string) => string)) => {
    const k = latest.current.key;
    setState((was) => ({ key: k, text: typeof t === 'function' ? t(was.key === k ? was.text : '') : t }));
  }, []);
  return [text, set];
}
