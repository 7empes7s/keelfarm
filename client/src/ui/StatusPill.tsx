// An agent's status as a coloured pill, apart from TerminalView so 2D views (pocket mode) don't load the 3D camera.
import { STATUS_WORD } from './statusPhrase';

/** The pill's status: an agent waiting on an answer to their question (#36) shows who they wait for, not "done". */
export const badgeStatus = (a: { status: string; waiting?: 'ceo' | 'manager' | null }) => (a.waiting && a.status !== 'working' ? (a.waiting === 'ceo' ? 'waiting-ceo' : 'waiting-you') : a.status);

/** `phrase`: what they're doing and what happens next (statusPhrase.ts), as its tooltip. */
export function StatusPill({ status, phrase }: { status: string; phrase?: string }) {
  return (
    <span className={`status status-${status}`} title={phrase}>
      {STATUS_WORD[status] ?? status}
    </span>
  );
}
