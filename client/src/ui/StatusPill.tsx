// An agent's status as a coloured pill, apart from TerminalView so 2D views (pocket mode) don't load the 3D camera.
import { shownState, type NeedsYouInput } from '../../../shared/needsYou';
import { STATUS_WORD } from './statusPhrase';

/** The pill's status (#36, #307): an agent waiting on the manager needs them, one on the CEO says so, a finished one is free. */
export const badgeStatus = (a: NeedsYouInput) => {
  const s = shownState(a);
  return s === 'free' ? 'idle' : s;
};

/** `phrase`: what they're doing and what happens next (statusPhrase.ts), as its tooltip. */
export function StatusPill({ status, phrase }: { status: string; phrase?: string }) {
  return (
    <span className={`status status-${status}`} title={phrase}>
      {STATUS_WORD[status] ?? status}
    </span>
  );
}
