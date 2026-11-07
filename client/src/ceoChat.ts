// The CEO chat's extra state (#51): a `ceoChat` event folded into the store (pure), and what a tab starts with.
import type { CeoChatView, PhoneMessage, ServerEvent } from '../../shared/types';
import { withNewest } from '../../shared/chatPage';

export const EMPTY_CHAT: CeoChatView = { live: null, current: '', conversations: [], memory: [] };

/** What a `ceoChat` event changes: the chat view's fields it carries, and the thread (another one, one message edited, or some removed). */
export function applyChat(s: { chat: CeoChatView; messages: PhoneMessage[] }, ev: Extract<ServerEvent, { type: 'ceoChat' }>): { chat: CeoChatView; messages?: PhoneMessage[]; chatOlder?: boolean } {
  const { type: _, messages, messagesOlder, message, removed, ...view } = ev;
  const chat = { ...s.chat, ...view };
  if (removed) return { chat, messages: s.messages.filter((m) => !removed.includes(m.id)) };
  if (messages) return { chat, messages, chatOlder: messagesOlder ?? false };
  if (message) return { chat, messages: s.messages.map((m) => (m.id === message.id ? message : m)) };
  return { chat };
}

/** A new message at the end of the loaded pages (#145), and whether older ones are now out of the tab. */
export function applyNewest(s: { messages: PhoneMessage[]; chatOlder: boolean }, m: PhoneMessage): { messages: PhoneMessage[]; chatOlder: boolean } {
  const page = withNewest(s.messages, m, s.chatOlder);
  return { messages: page.messages, chatOlder: page.older };
}
