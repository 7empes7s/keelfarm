// IT's chat (#589): the CEO chat's bubble actions wired to IT's own chat (ItDept.tsx), pure so a test can press each one.
import type { PhoneMessage } from '../../../shared/types';
import type { Item } from './ChatActions';
import type { MessageAction } from './chatMessageActions';

type Wiring = {
  /** The message being replied to now, or null. */
  replyTo: () => number | null;
  setReplyTo: (id: number | null) => void;
  setMenu: (item: Item | null) => void;
  /** Scroll to and flash a quoted message. */
  jump: (id: number) => void;
  /** Sends to IT (api.messageIt). */
  post: (text: string, replyTo?: number) => void;
};

/** Reply, the actions sheet (React and More), a quote's tap and the composer's send, for IT's bubbles. */
export function itChatActions(w: Wiring) {
  return {
    onReply: (id: number) => w.setReplyTo(id),
    onActions: (item: Item) => w.setMenu(item),
    onQuote: (id: number) => w.jump(id),
    /** Sends `text`, quoting `to` (the reply being written, unless a suggestion names its own). */
    send: (text: string, to: number | null = w.replyTo()) => {
      const body = text.trim();
      if (!body) return false;
      w.setReplyTo(null);
      w.post(body, to ?? undefined);
      return true;
    },
  };
}

/** What a bubble quotes: not a reply, its original, or null when it's no longer kept. */
export const itQuoted = (byId: ReadonlyMap<number, PhoneMessage>, to: number | undefined) => (to === undefined ? undefined : (byId.get(to) ?? null));

/** IT's own entries in a message's ⋯ (beside Reply and Copy text): Copy all commands, as IT's answers carry them. */
export function itMoreActions(commands: string[], copy: (text: string) => void): MessageAction[] {
  return commands.length > 1 ? [{ label: 'Copy all commands', icon: 'clipboard-list', run: () => copy(commands.join('\n')) }] : [];
}
