// The CEO chat's extra state (#51): a `ceoChat` event folded into the store (pure), and what a tab starts with.
import type { CeoChatView, PhoneMessage, ServerEvent } from '../../shared/types';

export const EMPTY_CHAT: CeoChatView = { live: null, current: '', conversations: [], memory: [] };

/** What a `ceoChat` event changes: the chat view's fields it carries, and the thread (another one, or one message edited). */
export function applyChat(s: { chat: CeoChatView; messages: PhoneMessage[] }, ev: Extract<ServerEvent, { type: 'ceoChat' }>): { chat: CeoChatView; messages?: PhoneMessage[]; chatOlder?: boolean } {
  const { type: _, messages, older, message, ...view } = ev;
  const chat = { ...s.chat, ...view };
  if (messages) return { chat, messages, chatOlder: older ?? false };
  if (message) return { chat, messages: s.messages.map((m) => (m.id === message.id ? message : m)) };
  return { chat };
}
