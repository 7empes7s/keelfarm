import { describe, expect, it, vi } from 'vitest';
import type { OutgoingMessage } from '../../../shared/chat';
import type { PhoneMessage } from '../../../shared/types';

// #216: after a reload or a crash, the outbox's interrupted sends go again once, unless the office already has them.
vi.mock('./sfx', () => ({ alarm: vi.fn(), audioUnlocked: () => false, chirp: vi.fn(), cue: vi.fn() }));
const posts: { clientId?: string; text: string }[] = [];
vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
  posts.push(JSON.parse(init.body));
  return { ok: true, json: async () => ({ id: 9 }) };
});

const { drafts } = await import('../drafts');
const { resumeOutbox } = await import('./chatSend');
const { useStore } = await import('../store');

const out = (clientId: string, text: string, delivery: OutgoingMessage['delivery'] = 'sending'): OutgoingMessage => ({ key: 1, clientId, text, at: 1, delivery });

describe('resumeOutbox', () => {
  it('resends each interrupted message once, drops what the office has, keeps failed ones for their retry', async () => {
    await drafts.put('outbox', [out('got-it', 'already saved'), out('lost', 'never arrived'), out('failed', 'try later', 'failed')]);
    useStore.setState({ messages: [{ id: 3, from: 'manager', text: 'already saved', at: 1, clientId: 'got-it' } as PhoneMessage], chatOutbox: [] });
    await resumeOutbox();
    await resumeOutbox(); // a reconnect's snapshot: nothing goes twice
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ clientId: 'lost', text: 'never arrived' });
    await vi.waitFor(() => expect(useStore.getState().chatOutbox.map((o) => o.clientId)).toEqual(['failed']));
  });
});
