import { describe, expect, it, vi } from 'vitest';
import type { PhoneMessage } from '../../../shared/types';
import { itChatActions, itMoreActions, itQuoted } from './itChat';

// #589: IT's chat's Reply, React / More (the actions sheet) and quotes call their handlers, and a reply goes with its quote.
const msg = (id: number, from: PhoneMessage['from'] = 'ceo'): PhoneMessage => ({ id, from, text: `message ${id}`, at: id });

function chat() {
  let replyTo: number | null = null;
  const w = { replyTo: () => replyTo, setReplyTo: vi.fn((id: number | null) => void (replyTo = id)), setMenu: vi.fn(), jump: vi.fn(), post: vi.fn() };
  return { w, on: itChatActions(w) };
}

describe("IT chat's message actions", () => {
  it('Reply starts a reply that the next send carries to IT, then ends it', () => {
    const { w, on } = chat();
    on.onReply(7);
    expect(w.setReplyTo).toHaveBeenLastCalledWith(7);
    expect(on.send('  Yes, clean it up  ')).toBe(true);
    expect(w.post).toHaveBeenCalledWith('Yes, clean it up', 7);
    expect(w.setReplyTo).toHaveBeenLastCalledWith(null);
    on.send('And the logs?');
    expect(w.post).toHaveBeenLastCalledWith('And the logs?', undefined);
  });

  it('React and More open the actions sheet for that message; a quote jumps to its original', () => {
    const { w, on } = chat();
    const item = { m: msg(3) };
    on.onActions(item);
    expect(w.setMenu).toHaveBeenCalledWith(item);
    on.onQuote(2);
    expect(w.jump).toHaveBeenCalledWith(2);
  });

  it("a suggestion names its own message, and an empty box sends nothing", () => {
    const { w, on } = chat();
    on.onReply(4);
    on.send('Run it', 9);
    expect(w.post).toHaveBeenCalledWith('Run it', 9);
    expect(on.send('   ')).toBe(false);
    expect(w.post).toHaveBeenCalledTimes(1);
  });

  it('shows what a bubble quotes, or that the original is gone', () => {
    const byId = new Map([[1, msg(1, 'manager')]]);
    expect(itQuoted(byId, undefined)).toBeUndefined();
    expect(itQuoted(byId, 1)).toMatchObject({ id: 1 });
    expect(itQuoted(byId, 99)).toBeNull();
  });

  it('offers Copy all commands in More when an answer has several', () => {
    const copy = vi.fn();
    expect(itMoreActions(['df -h'], copy)).toEqual([]);
    const [all] = itMoreActions(['df -h', 'du -sh /var/log'], copy);
    all.run();
    expect(copy).toHaveBeenCalledWith('df -h\ndu -sh /var/log');
  });
});
