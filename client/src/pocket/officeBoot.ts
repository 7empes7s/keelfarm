// The 3D office's start-up breadcrumb (#79). While it starts, this device remembers how far it got and the first error
// it saw; a normal unload (pagehide) or a settled start clears it. Found on the next load, it means the browser killed
// the tab (iOS WebKit reloads a tab that ran out of GPU memory, firing nothing first), so mode.ts opens pocket mode
// with the reason instead of starting the 3D office into the same crash again.

const KEY = 'cubefarm:office-boot';

interface Crumb {
  step: string;
  error?: string;
}

/** Why the 3D office closed last time, from the breadcrumb a previous load left; null when it closed normally. */
export function crashReason(raw: string | null): string | null {
  if (!raw) return null;
  let crumb: Partial<Crumb>;
  try {
    crumb = JSON.parse(raw) as Partial<Crumb>;
  } catch {
    return null;
  }
  if (typeof crumb?.step !== 'string') return null;
  return crumb.error ? `${crumb.error} (while ${crumb.step})` : `the page reloaded while ${crumb.step}, likely out of memory`;
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(crumb: Crumb | null) {
  try {
    if (crumb) localStorage.setItem(KEY, JSON.stringify(crumb));
    else localStorage.removeItem(KEY);
  } catch {
    // no storage: no breadcrumb, the next load decides as usual
  }
}

let current: Crumb | null = null;

/** Takes the last load's breadcrumb: the reason it crashed, or null. */
export function takeCrash(): string | null {
  const reason = crashReason(read());
  write(null);
  return reason;
}

/** The 3D office's start reached `step`. */
export function bootStep(step: string) {
  current = { step, ...(current?.error ? { error: current.error } : {}) };
  write(current);
}

/** It started (or failed on screen): nothing to warn about next time. */
export function bootDone() {
  if (!current) return;
  current = null;
  write(null);
}

function noteError(message: string) {
  if (!current || current.error) return;
  current = { ...current, error: message.slice(0, 200) };
  write(current);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', bootDone);
  window.addEventListener('error', (e) => noteError(e.message || 'an error'));
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => noteError(e.reason instanceof Error ? e.reason.message : String(e.reason)));
}
