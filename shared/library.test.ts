import { describe, expect, it } from 'vitest';
import { filterLibrary, libraryCounts, libraryItems, libraryQuery, pageLibrary } from './library.ts';
import type { FileRef } from './files.ts';
import type { PhoneMessage } from './types.ts';

const file = (id: string, name: string, type: string, at: number): FileRef => ({ id, name, type, size: 100 * at, from: 'manager', at, keep: false });
const shot = file('f1', 'shot.png', 'image/png', 1);
const clip = file('f2', 'clip.mp4', 'video/mp4', 2);
const doc = file('f3', 'notes.pdf', 'application/pdf', 3);
const orphan = file('f4', 'old.csv', 'text/csv', 0);
const a: PhoneMessage[] = [
  { id: 1, from: 'manager', text: '', at: 10, attachments: [shot, clip] },
  { id: 2, from: 'ceo', text: 'Plan', at: 20, artifacts: [{ id: '2-0', title: 'Plan', lead: 'Steps', markdown: '# Plan é' }] },
  { id: 3, from: 'manager', text: 'again', at: 30, attachments: [shot] },
];
// another thread, whose message ids repeat a's (ids can repeat across threads)
const b: PhoneMessage[] = [{ id: 2, from: 'ceo', text: 'Report', at: 25, artifacts: [{ id: '2-0', title: 'Report', lead: '' }], attachments: [doc] }];

describe('Files & artifacts (#132)', () => {
  it('lists every artifact and file of the threads, newest first, each file once, by kind', () => {
    const items = libraryItems([{ id: 'ca', messages: a }, { id: 'cb', messages: b }]);
    expect(items.map((i) => [i.title, i.kind, i.conversationId, i.messageId])).toEqual([
      ['shot.png', 'image', 'ca', 3], // sent twice: its latest message
      ['notes.pdf', 'document', 'cb', 2],
      ['Report', 'artifact', 'cb', 2],
      ['Plan', 'artifact', 'ca', 2],
      ['clip.mp4', 'image', 'ca', 1],
    ]);
    expect(items.find((i) => i.title === 'Plan')).toMatchObject({ size: 9, lead: 'Steps', artifact: { id: '2-0', title: 'Plan', lead: 'Steps' } }); // bytes, not characters
    expect(items.find((i) => i.title === 'Plan')?.artifact).not.toHaveProperty('markdown');
    expect(items.find((i) => i.title === 'Report')?.size).toBeNull(); // its text wasn't sent
    expect(libraryItems([{ id: 'ca', messages: a }], [], true).find((i) => i.kind === 'artifact')?.artifact?.markdown).toBe('# Plan é');
  });

  it('adds the stored files no message carries, for the whole office', () => {
    const items = libraryItems([{ id: 'ca', messages: a }], [shot, orphan]);
    expect(items.map((i) => i.title)).toEqual(['shot.png', 'Plan', 'clip.mp4', 'old.csv']);
    expect(items.at(-1)).toMatchObject({ messageId: null, conversationId: null, kind: 'document' });
  });

  it('filters and counts by kind', () => {
    const items = libraryItems([{ id: 'ca', messages: a }, { id: 'cb', messages: b }]);
    expect(libraryCounts(items)).toEqual({ all: 5, artifact: 2, image: 2, document: 1 });
    expect(filterLibrary(items, 'image').map((i) => i.title)).toEqual(['shot.png', 'clip.mp4']);
    expect(filterLibrary(items, 'all')).toHaveLength(5);
  });

  it('pages after a card', () => {
    const items = libraryItems([{ id: 'ca', messages: a }, { id: 'cb', messages: b }]);
    const first = pageLibrary(items, undefined, 2);
    expect(first.items.map((i) => i.title)).toEqual(['shot.png', 'notes.pdf']);
    const second = pageLibrary(items, first.next!, 2);
    expect(second.items.map((i) => i.title)).toEqual(['Report', 'Plan']);
    expect(pageLibrary(items, second.next!, 2)).toEqual({ items: [items[4]], next: null });
  });

  it('reads the query, with defaults', () => {
    expect(libraryQuery({})).toEqual({ scope: 'all', filter: 'all' });
    expect(libraryQuery({ scope: 'r1', filter: 'image', after: 'f:f1' })).toEqual({ scope: 'r1', filter: 'image', after: 'f:f1' });
    expect(libraryQuery({ scope: ['x'], filter: 'nope', after: 'x'.repeat(300) })).toEqual({ scope: 'all', filter: 'all' });
  });
});
