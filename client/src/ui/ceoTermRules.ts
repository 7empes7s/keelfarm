// Which overlay is the CEO's terminal (#596): the stuck card's Open terminal and #agent/ceo/terminal open it on phones
// and computers; the CEO's other windows (@CEO opens the chat, the console's CEO tab) stay as they were. Pure.
import { CEO_ID } from '../../../shared/types';
import type { Overlay } from '../store';

export const isCeoTerminal = (o: Overlay | null | undefined) => o?.kind === 'terminal' && o.agentId === CEO_ID && o.view === 'terminal';

/** The note over it: once the CLI has closed, the screen is its last session's, said plainly. */
export function ceoTermNote(name: string, terminal: boolean, live: boolean | null): string | null {
  if (!terminal) return `${name} runs without a terminal: this is their session's log.`;
  return live === false ? `${name}'s terminal has closed: this is the last screen of their session.` : null;
}
