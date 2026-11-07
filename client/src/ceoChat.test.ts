import { describe, expect, it } from 'vitest';
import { applyChat, EMPTY_CHAT } from './ceoChat';
import type { PhoneMessage } from '../../shared/types';

const m = (id: number, text: string): PhoneMessage => ({ id, from: 'manager', text, at: id });

describe('the store folding a ceoChat event', () => {
  const s = { chat: { ...EMPTY_CHAT, current: 'c1' }, messages: [m(1, 'Hi'), m(2, 'Plan it')] };

  it('takes the fields it carries, keeping the rest', () => {
    const live = { blocks: ['Let me look'], open: true, steps: [], stepCount: 0, since: 1 };
    expect(applyChat(s, { type: 'ceoChat', live })).toEqual({ chat: { ...s.chat, live } });
  });

  it('replaces the thread when another conversation opens, or one edited message', () => {
    expect(applyChat(s, { type: 'ceoChat', messages: [], current: 'c2' })).toEqual({ chat: { ...s.chat, current: 'c2' }, messages: [], chatOlder: false });
    // #145: its latest page, and whether it has older ones to load (never part of the chat view).
    expect(applyChat(s, { type: 'ceoChat', messages: [m(41, 'Hi')], messagesOlder: true })).toEqual({ chat: s.chat, messages: [m(41, 'Hi')], chatOlder: true });
    expect(applyChat(s, { type: 'ceoChat', message: { ...m(2, 'Plan it by Friday'), edited: 5 } }).messages).toEqual([m(1, 'Hi'), { ...m(2, 'Plan it by Friday'), edited: 5 }]);
    expect(applyChat(s, { type: 'ceoChat', removed: [1] })).toEqual({ chat: s.chat, messages: [m(2, 'Plan it')] }); // #145: deleted or hidden
  });
});
