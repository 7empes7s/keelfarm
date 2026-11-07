import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { pastChat } from './chatSample.ts';
import { CHAT_KEEP, CHAT_PAGE } from '../shared/chatPage.ts';
import type { PhoneMessage, ServerEvent } from '../shared/types.ts';

// The CEO chat in pages (#145), in a demo office: the snapshot carries only the latest page, older ones come a page at a
// time, and the manager's removals delete their own and the office's messages and hide the CEO's.
type Internals = { broadcast(ev: ServerEvent): void; state: { messages: PhoneMessage[] } };

afterEach(() => vi.restoreAllMocks());

function office(messages: PhoneMessage[]) {
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  const swarm = new Swarm(createDemoBackend());
  const i = swarm as unknown as Internals;
  i.state.messages = messages;
  const sent: ServerEvent[] = [];
  i.broadcast = (ev) => void sent.push(ev);
  return { swarm, sent, state: i.state };
}

describe('the CEO chat in pages', () => {
  it('sends only the latest page in the snapshot, and the rest a page at a time', () => {
    const { swarm } = office(pastChat(Date.now(), CHAT_KEEP));
    const snap = swarm.snapshot();
    expect(snap.messages).toHaveLength(CHAT_PAGE);
    expect(snap.messages.at(-1)?.id).toBe(CHAT_KEEP);
    expect(snap.messagesOlder).toBe(true);
    let first = snap.messages[0].id;
    let loaded = snap.messages.length;
    for (let older = true; older; ) {
      const page = swarm.chatMessages(first, Number.NaN);
      expect(page.messages.at(-1)!.id).toBe(first - 1);
      [first, older, loaded] = [page.messages[0].id, page.older, loaded + page.messages.length];
    }
    expect([first, loaded]).toEqual([1, CHAT_KEEP]);
  });

  it("deletes the manager's message and an office notice, and hides the CEO's from every page", () => {
    const { swarm, sent, state } = office(pastChat(Date.now(), 8)); // manager, ceo, manager, ceo, office, …
    swarm.removeChatMessage(1);
    swarm.removeChatMessage(5);
    swarm.removeChatMessage(2);
    expect(sent.filter((e) => e.type === 'ceoChat' && e.removed)).toEqual([1, 5, 2].map((id) => ({ type: 'ceoChat', removed: [id] })));
    expect(state.messages.map((m) => m.id)).toEqual([2, 3, 4, 6, 7, 8]); // the CEO's stays, for the CEO
    expect(state.messages[0].hidden).toBe(true);
    expect(swarm.snapshot().messages.map((m) => m.id)).toEqual([3, 4, 6, 7, 8]);
    expect(swarm.chatMessages(4, CHAT_PAGE).messages.map((m) => m.id)).toEqual([3]);
    expect(() => swarm.removeChatMessage(2)).toThrow(/no longer in this conversation/);
  });
});
