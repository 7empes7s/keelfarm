// A new office version without a forced reload (#216). The office updates itself many times a day: when it comes
// back on another commit this page keeps running with `updateReady` set, and loads the new version at a safe
// moment (a tab or section change, back from the background, the header's pill), never over a draft, an upload, a
// send or an open sheet. The service worker's waiting version takes over then, so the assets swap cleanly.
import { useEffect } from 'react';
import { drafts } from './drafts';
import { heldText, loadsNow, newVersion, type UpdateHold, type UpdateMoment } from './officeUpdate';
import { useStore, type Overlay } from './store';

let loaded: string | null | undefined; // the commit this page loaded with: the first live snapshot's

/** A live snapshot's commit: the first is this page's; a different one later means a new version is ready. */
export function noteCommit(commit: string | null | undefined) {
  if (loaded === undefined) loaded = commit ?? null;
  else if (newVersion(loaded, commit) && !useStore.getState().updateReady) useStore.setState({ updateReady: true });
}

// ---------- what holds it back ----------

const holders = new Map<string, UpdateHold>();

/** A composer's work in progress (`null`: none) under its own key, holding a waiting version back. */
export function useUpdateHold(key: string, hold: UpdateHold | null) {
  useEffect(() => {
    if (!hold) return;
    holders.set(key, hold);
    return () => void holders.delete(key);
  }, [key, hold]);
}

/** Sheets, menus and dialogs over the page; a panel (a terminal, the console) is a page of its own, not one of them. */
const SHEETS = '.sheet, .confirm, .hold-sheet, [role="dialog"][aria-modal="true"]:not(.panel):not(.phone)';

function holds(): UpdateHold[] {
  const all = new Set(holders.values());
  if (useStore.getState().chatOutbox.some((o) => o.delivery === 'sending')) all.add('send');
  if (document.querySelector(SHEETS)) all.add('sheet');
  return [...all];
}

// ---------- loading it ----------

/** Where the manager was, put back after the new version loads: the pocket tab and the open panel. */
interface Resume {
  tab?: string;
  overlay?: Overlay | null;
}
const RESUME_KEY = 'cubefarm:resume';

function takeResume(): Resume {
  try {
    const r = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? 'null') as Resume | null;
    sessionStorage.removeItem(RESUME_KEY);
    return r ?? {};
  } catch {
    return {};
  }
}
const resumed = typeof sessionStorage === 'undefined' ? {} : takeResume();

/** The pocket tab the manager was on before the new version loaded, if it just did. */
export const resumedTab = () => resumed.tab;

let tabNow: string | undefined;

/** Pocket mode's tab: the new version opens on it; a change is a navigation, so a safe moment. */
export function tabShown(tab: string, changed: boolean) {
  tabNow = tab;
  if (changed) void loadUpdate('navigate');
}

/** The service worker's waiting version takes over (3 s at most), so the reload gets its assets. */
async function takeOverWorker() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return;
    await reg.update();
    const w = reg.waiting ?? reg.installing;
    if (!w) return;
    await new Promise<void>((done) => {
      const timer = setTimeout(done, 3000);
      navigator.serviceWorker.addEventListener('controllerchange', () => (clearTimeout(timer), done()), { once: true });
      const go = () => w.state === 'installed' && w.postMessage({ type: 'skipWaiting' });
      w.addEventListener('statechange', go);
      go();
    });
  } catch {
    // no worker, or it can't update: the reload still gets the new page
  }
}

let loading = false;

/** Loads the waiting version if this is a safe moment; a tap that's held back says why. True when it reloads. */
export async function loadUpdate(moment: UpdateMoment, hiddenMs = 0): Promise<boolean> {
  const s = useStore.getState();
  const h = holds();
  if (loading || !loadsNow(s.updateReady, moment, h, hiddenMs)) {
    if (moment === 'tap' && h.length) s.pushToast('info', heldText(h));
    return false;
  }
  loading = true;
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ overlay: s.overlay, tab: tabNow } satisfies Resume));
  } catch {
    // private mode: the new version opens where it starts
  }
  await drafts.flush();
  await takeOverWorker();
  location.reload();
  return true;
}

/** The safe moments the page watches by itself: back from the background, a panel opened or closed; and the resume. */
export function watchUpdates() {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt) void loadUpdate('resume', Date.now() - hiddenAt);
  });
  useStore.subscribe((s, prev) => {
    if (s.overlay !== prev.overlay) setTimeout(() => void loadUpdate('navigate'), 0); // after the change is on screen
  });
  if (!resumed.overlay) return;
  const off = useStore.subscribe((s) => {
    if (!s.loaded) return;
    off();
    if (!s.overlay) s.openOverlay(resumed.overlay!);
  });
}
