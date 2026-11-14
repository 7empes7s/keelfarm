// The office's own update, in plain words for the console and the HUD, and when the new client may load (#216).
import type { OfficeUpdateView } from '../../shared/types';

/** The server stops the sessions still running this long after it started draining (#37). */
export const DRAIN_TIMEOUT_MS = 20 * 60_000;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What a draining update waits for, e.g. "2 sessions and 1 lab check" (#333); '' for nothing. */
const waitsFor = (u: OfficeUpdateView) => [u.running > 0 ? plural(u.running, 'session') : '', u.lab ? plural(u.lab, 'lab check') : ''].filter(Boolean).join(' and ');

/** "Updating in 2 min, 3 commits": a run of merges settling into one update (#74). */
const settlingText = (u: OfficeUpdateView, now: number) => `Updating in ${Math.max(1, Math.ceil(((u.updateAt ?? now) - now) / 60_000))} min, ${plural(u.behind, 'commit')}`;

/** One line for the console's Office row, e.g. "3 updates ready" or "Waiting for 2 sessions to finish". */
export function officeUpdateText(u: OfficeUpdateView, now = Date.now()): string {
  switch (u.state) {
    case 'none':
      return 'Up to date';
    case 'available':
      return u.behind > 0 ? `${plural(u.behind, 'update')} ready` : 'An update is ready';
    case 'settling':
      return `${settlingText(u, now)}; agents keep working`;
    case 'waiting':
    case 'draining':
      return waitsFor(u) ? `Waiting for ${waitsFor(u)} to finish` : 'Updating shortly…';
    case 'updating':
      return u.holds ? 'Updating…' : 'Checking the update; agents keep working, then the office restarts for a few seconds';
    case 'failed':
      return `Last update failed: ${u.detail || 'unknown error'}`;
  }
}

/** The header's few words for why a ready update waits (#600); null when it says nothing beyond the state. */
function waitChip(u: OfficeUpdateView): string | null {
  switch (u.wait?.kind) {
    case 'manual':
      return 'Update ready · automatic updates off';
    case 'postponed':
      return 'Update ready · postponed';
    case 'preflight':
      return 'Update held back · preflight failed';
    case 'failed':
      return 'Update held back · the last one failed';
    case 'probation':
      return 'Update waits for the last one’s probation';
    case 'lock':
      return 'Update stuck in the launcher';
    default:
      return null;
  }
}

/** The HUD chip while an update is ready or on its way, saying why it waits; null when there's nothing to show. */
export function officeUpdateChip(u: OfficeUpdateView | undefined, now = Date.now()): string | null {
  if (!u) return null;
  const why = waitChip(u);
  if (why) return why;
  if (u.state === 'settling') return settlingText(u, now);
  if (u.state === 'updating') return 'Updating the office…';
  if (u.state !== 'waiting' && u.state !== 'draining') return null;
  return waitsFor(u) ? `Updating the office after ${waitsFor(u)} finish${u.running + (u.lab ?? 0) === 1 ? 'es' : ''}` : 'Updating the office shortly';
}

/** When a drain gives up on the sessions still running, or null when it isn't draining. */
export const drainDeadline = (u: OfficeUpdateView) => (u.state === 'draining' && u.drainingSince ? u.drainingSince + DRAIN_TIMEOUT_MS : null);

/** Update now: there's something to update, a launcher to do it, and it isn't already on its way. */
export const canUpdateNow = (u: OfficeUpdateView) => u.launcher && u.behind > 0 && (u.state === 'available' || u.state === 'waiting' || u.state === 'settling' || u.state === 'failed');

/**
 * The header's one Update control (#673): "office" when the office has commits to install (its page reloads once the
 * office is back), else "reload" when only this tab's client is behind, else none.
 */
export const updateControl = (u: OfficeUpdateView | undefined, clientReady: boolean): 'office' | 'reload' | null =>
  u && canUpdateNow(u) ? 'office' : clientReady ? 'reload' : null;

/** Later: postpone an update that is ready or about to start. */
export const canPostpone = (u: OfficeUpdateView) => u.launcher && (u.state === 'available' || u.state === 'waiting' || u.state === 'settling' || u.state === 'draining');

/** A dropped connection while the office is about to restart itself is expected, not an error. */
export const restartExpected = (u: OfficeUpdateView | undefined) => u?.state === 'draining' || u?.state === 'updating';

/**
 * The server came back on a different commit: its client is ready to load (at a safe moment, `loadNow`). At most
 * once per commit (remembered in sessionStorage), so a server that keeps reporting a new commit can't loop the page.
 */
export function shouldReload(before: string | null | undefined, after: string | null | undefined, reloadedFor: string | null): boolean {
  return !!before && !!after && before !== after && reloadedFor !== after;
}

// ---------- loading the new client at a safe moment (#216) ----------

/** What the manager is in the middle of: any of it holds the new client back, so nothing they're doing is lost. */
export interface LoadBlockers {
  draft: boolean; // a message box with text or files in it
  uploading: boolean;
  sending: boolean; // a message on its way to the office
  sheet: boolean; // a sheet, menu or confirmation open
  call?: boolean; // a voice call: a reload would hang up on the CEO
}

/** Back from the background after this long, the app may load the new client. */
export const HIDDEN_LOAD_MS = 30_000;

/** A moment the new client may load at: a tab or section change, coming back to the app, or the pill's tap. */
export type LoadMoment = { kind: 'nav' } | { kind: 'visible'; hiddenMs: number } | { kind: 'tap' };

/** What the new client waits for, in a few words ("the upload finishes"); null when nothing holds it. */
export function loadBlocker(b: LoadBlockers): string | null {
  if (b.call) return 'the call ends';
  if (b.uploading) return 'the upload finishes';
  if (b.sending) return 'your message is sent';
  if (b.draft) return 'you send or clear your message';
  if (b.sheet) return 'the sheet closes';
  return null;
}

/**
 * Whether a panel changing (its kind `was` → `now`, null: none) is a moment to load the new client: in pocket mode,
 * never in the 3D office. There a reload rebuilds the scene, closes the phone just opened and drops the mouse grab
 * closing a panel takes (#644), so the new client waits for the pill or a return to the app.
 */
export const panelChangeLoads = (mode: 'pocket' | 'office', was: string | null, now: string | null) => mode === 'pocket' && was !== now;

/** Loads the new client now: there is one, this moment counts, and nothing holds it back. */
export function loadNow(ready: boolean, moment: LoadMoment, b: LoadBlockers): boolean {
  if (!ready || (moment.kind === 'visible' && moment.hiddenMs < HIDDEN_LOAD_MS)) return false;
  return loadBlocker(b) === null;
}
