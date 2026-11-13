// The office's new client after a self-update (#216): never a reload on its own. net.ts marks it ready
// (store.updateReady) and it loads at a safe moment (officeUpdate.ts `loadNow`): the next tab or section change, back
// in the app after a while away, or the header's "New version" pill, and never while a message is being written,
// uploaded or sent, or a sheet is open. Drafts and the outbox are saved anyway (drafts.ts, chatSend.ts).
import { useStore } from './store';
import { useMode } from './pocket/mode';
import { panelChangeLoads, type LoadMoment } from './officeUpdate';
import { readyAfter, tryLoad } from './updateGate';
import { callOn } from './ui/voiceCallStore';

// The commit this tab last loaded the client for, so a new office commit loads it at most once.
const LOADED_KEY = 'office-swarm:reloaded-for';
// What's open over the page: a sheet, a menu or a confirmation (panels and the phone are pages, not sheets).
const SHEETS = '.sheet, [role="alertdialog"], [role="menu"]';

function loadedFor(): string | null {
  try {
    return sessionStorage.getItem(LOADED_KEY);
  } catch {
    return null;
  }
}

/** The office came back on `commit`: its client is ready when it's a new one this tab hasn't loaded yet. */
export function noteCommit(commit: string) {
  const s = useStore.getState();
  const ready = readyAfter(s.updateReady, s.officeCommit, commit, loadedFor());
  if (ready !== s.updateReady) useStore.setState({ updateReady: ready });
}

function load(commit: string) {
  try {
    sessionStorage.setItem(LOADED_KEY, commit);
  } catch {
    // without storage the once-per-commit guard is gone, but this tab's next snapshot is on the new commit anyway
  }
  window.dispatchEvent(new Event('cubefarm:unload')); // drafts.ts saves what's still waiting
  location.reload();
}

/** Loads the new client if one is ready and this moment is safe (`before` runs first); the pill's tap says what holds it back. */
export function loadUpdate(moment: LoadMoment, before?: () => void): boolean {
  const s = useStore.getState();
  const rest = { sending: s.chatOutbox.some((o) => o.delivery === 'sending'), sheet: !!document.querySelector(SHEETS) };
  const { loaded, waitsFor } = tryLoad(s.updateReady, moment, rest, (commit) => (before?.(), load(commit)));
  if (moment.kind === 'tap' && waitsFor) s.pushToast('info', `The new version loads once ${waitsFor}.`);
  return loaded;
}

const CHUNK_RELOAD_KEY = 'office-swarm:chunk-reload';

/** A reload for a missing bundle is due (and noted) unless one happened in the last minute: a bundle missing for good never loops. */
function chunkReloadDue(now: number): boolean {
  try {
    if (now - Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0) < 60_000) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
    return true;
  } catch {
    return false; // no storage, no guard: no reload
  }
}

let installed = false;

/** Watches for the safe moments: overlays opening and closing, and the app coming back from the background. */
export function installUpdateLoader() {
  if (installed) return;
  installed = true;
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt) loadUpdate({ kind: 'visible', hiddenMs: Date.now() - hiddenAt });
  });
  // a page change in pocket mode, never the 3D office's panels (officeUpdate.ts panelChangeLoads): once React has drawn it, so the sheet check sees the new page
  useStore.subscribe((s, prev) => panelChangeLoads(useMode.getState().mode, prev.overlay?.kind ?? null, s.overlay?.kind ?? null) && setTimeout(() => loadUpdate({ kind: 'nav' }), 50));
  // a lazy chunk of the old client is gone from the office: load the new one now (drafts are saved) rather than break
  window.addEventListener('vite:preloadError', (e) => {
    const ready = useStore.getState().updateReady;
    if (ready) {
      e.preventDefault();
      return load(ready);
    }
    // Gone with no update seen (an update while this page slept, #650): the page loads again, once a minute at most.
    if (callOn() || !chunkReloadDue(Date.now())) return; // never drops a call
    e.preventDefault();
    window.dispatchEvent(new Event('cubefarm:unload'));
    location.reload();
  });
}
