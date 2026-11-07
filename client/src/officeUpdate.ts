// The office's own update, in plain words for the console and the HUD, and when this page loads the new version (#216).
import type { OfficeUpdateView } from '../../shared/types';

/** The server stops the sessions still running this long after it started draining (#37). */
export const DRAIN_TIMEOUT_MS = 20 * 60_000;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
      return u.running > 0 ? `Waiting for ${plural(u.running, 'session')} to finish` : 'Updating shortly…';
    case 'updating':
      return u.holds ? 'Updating…' : 'Checking the update; agents keep working, then the office restarts for a few seconds';
    case 'failed':
      return `Last update failed: ${u.detail || 'unknown error'}`;
  }
}

/** The HUD chip while an update is on its way; null when there's nothing to show. */
export function officeUpdateChip(u: OfficeUpdateView | undefined, now = Date.now()): string | null {
  if (!u) return null;
  if (u.state === 'settling') return `⟳ ${settlingText(u, now)}`;
  if (u.state === 'updating') return '⟳ Updating the office…';
  if (u.state !== 'waiting' && u.state !== 'draining') return null;
  return u.running > 0 ? `⟳ Updating the office after ${plural(u.running, 'session')} finish${u.running === 1 ? 'es' : ''}` : '⟳ Updating the office shortly';
}

/** When a drain gives up on the sessions still running, or null when it isn't draining. */
export const drainDeadline = (u: OfficeUpdateView) => (u.state === 'draining' && u.drainingSince ? u.drainingSince + DRAIN_TIMEOUT_MS : null);

/** Update now: there's something to update, a launcher to do it, and it isn't already on its way. */
export const canUpdateNow = (u: OfficeUpdateView) => u.launcher && u.behind > 0 && (u.state === 'available' || u.state === 'waiting' || u.state === 'settling' || u.state === 'failed');

/** Later: postpone an update that is ready or about to start. */
export const canPostpone = (u: OfficeUpdateView) => u.launcher && (u.state === 'available' || u.state === 'waiting' || u.state === 'settling' || u.state === 'draining');

/** A dropped connection while the office is about to restart itself is expected, not an error. */
export const restartExpected = (u: OfficeUpdateView | undefined) => u?.state === 'draining' || u?.state === 'updating';

/** The office came back on another commit than the one this page loaded with: a new version is ready (#216). */
export const newVersion = (loaded: string | null | undefined, now: string | null | undefined) => !!loaded && !!now && loaded !== now;

/** When the new version may load: a tab or section change, back after a while in the background, or the pill's tap. */
export type UpdateMoment = 'navigate' | 'resume' | 'tap';

/** What holds a waiting version back: something being written, uploaded or sent, or a sheet or dialog open. */
export type UpdateHold = 'draft' | 'upload' | 'send' | 'sheet';

/** The background a phone must have been in before coming back loads the new version. */
export const RESUME_AFTER_MS = 30_000;

/** True when the waiting version loads now; never over the manager's work in progress, which waits for the next moment. */
export function loadsNow(ready: boolean, moment: UpdateMoment, holds: readonly UpdateHold[], hiddenMs = 0): boolean {
  if (!ready || holds.length) return false;
  return moment !== 'resume' || hiddenMs >= RESUME_AFTER_MS;
}

/** Why the pill's tap didn't update, in plain words. */
export function heldText(holds: readonly UpdateHold[]): string {
  const why = holds.includes('send') ? 'a message is still sending' : holds.includes('upload') ? 'a file is still uploading' : holds.includes('draft') ? 'you have an unsent message' : 'a sheet is open';
  return `Updating when it's safe: ${why}. Your work is kept.`;
}
