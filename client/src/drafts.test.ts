import { describe, expect, it } from 'vitest';
import { readDraft, writeDraft, type DraftStore } from './drafts';

// Drafts kept through a reload or a crash (#216), per conversation.
function store(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('drafts', () => {
  it('saves and restores each conversation apart', () => {
    const s = store();
    writeDraft('ceo:1', 'Plan the bakery', s);
    writeDraft('agent:ada', 'Add a test', s);
    expect(readDraft<string>('ceo:1', s)).toBe('Plan the bakery');
    expect(readDraft<string>('agent:ada', s)).toBe('Add a test');
    expect(readDraft<string>('ceo:2', s)).toBeNull();
  });
  it('drops a draft once it is empty, and survives storage that throws or holds junk', () => {
    const s = store();
    writeDraft('ceo:1', 'hi', s);
    writeDraft('ceo:1', '', s);
    writeDraft('files:ceo:1', [], s);
    expect(s.data.size).toBe(0);
    s.data.set('cubefarm:draft:ceo:1', '{nope');
    expect(readDraft('ceo:1', s)).toBeNull();
    const full: DraftStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => undefined };
    expect(() => writeDraft('ceo:1', 'hi', full)).not.toThrow();
    expect(readDraft('ceo:1', full)).toBeNull();
  });
});
