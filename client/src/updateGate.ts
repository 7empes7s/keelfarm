// What holds the office's new client back (#216), without the store so it's tested on its own: the message boxes and
// uploads that say they're busy, and the decision to load it now (officeUpdate.ts `loadNow`). updateLoad.ts runs it.
import { loadBlocker, loadNow, shouldReload, type LoadBlockers, type LoadMoment } from './officeUpdate';

const busy = new Map<string, 'draft' | 'uploading' | 'call'>();

/** A message box (draft), its uploads (uploading) or a voice call holds the new client back while `on`. */
export function markBusy(key: string, kind: 'draft' | 'uploading' | 'call', on: boolean) {
  if (on) busy.set(key, kind);
  else busy.delete(key);
}

/** The new client after a snapshot on `commit`: that commit when it's new and this tab hasn't loaded it, else as it was. */
export const readyAfter = (ready: string | null, before: string | null | undefined, commit: string, loadedFor: string | null) => (shouldReload(before, commit, loadedFor) ? commit : ready);

/** Loads the `ready` client now (`load`) if this moment is safe; else what it waits for, or null without one. */
export function tryLoad(ready: string | null, moment: LoadMoment, rest: Pick<LoadBlockers, 'sending' | 'sheet'>, load: (commit: string) => void): { loaded: boolean; waitsFor: string | null } {
  const kinds = [...busy.values()];
  const b: LoadBlockers = { draft: kinds.includes('draft'), uploading: kinds.includes('uploading'), call: kinds.includes('call'), ...rest };
  if (!ready) return { loaded: false, waitsFor: null };
  if (loadNow(true, moment, b)) {
    load(ready);
    return { loaded: true, waitsFor: null };
  }
  return { loaded: false, waitsFor: loadBlocker(b) };
}
