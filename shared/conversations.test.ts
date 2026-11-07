import { describe, expect, it } from 'vitest';
import {
  conversationPatch,
  conversationsView,
  currentConversation,
  editConversation,
  groupThreads,
  inScope,
  loadChats,
  MAX_CONVERSATIONS,
  openConversation,
  pinConversation,
  projectLine,
  searchConversations,
  startConversation,
  threadStats,
  titleFrom,
  touchConversation,
  unfilled,
  unreadThread,
  UNTITLED,
  type Conversation,
} from './conversations.ts';
import { libraryItems } from './library.ts';
import type { FileRef } from './files.ts';
import type { PhoneMessage } from './types.ts';

const msg = (id: number, from: PhoneMessage['from'], text: string, at = id): PhoneMessage => ({ id, from, text, at });

describe('the conversation store', () => {
  it('gives an office from before conversations one, holding its thread', () => {
    const s = loadChats(undefined, [msg(1, 'office', 'Floor 1 opened'), msg(2, 'manager', 'How is the shop doing?\nAnd the API?'), msg(3, 'ceo', 'Fine.')], 10);
    expect(s.list).toHaveLength(1);
    expect(currentConversation(s)).toMatchObject({ title: 'How is the shop doing?', count: 3, startedAt: 1, updatedAt: 3, pinned: false, sessionId: null });
    expect(loadChats(JSON.parse(JSON.stringify(s)), [], 20)).toEqual(s);
  });

  it('creates a new one, keeping the CEO session the old one resumes, and continues the old one', () => {
    const s = loadChats(undefined, [], 1);
    const first = s.current;
    touchConversation(s, { from: 'manager', text: 'Plan the bakery', at: 5 });
    expect(startConversation(s, 'sess-1', 6)).toEqual([]);
    expect(s.current).not.toBe(first);
    expect(currentConversation(s)).toMatchObject({ title: UNTITLED, count: 0, sessionId: null });
    touchConversation(s, { from: 'office', text: 'A merge', at: 7 });
    expect(currentConversation(s).title).toBe(UNTITLED); // only the manager's words name it
    touchConversation(s, { from: 'manager', text: 'Research: dark mode', at: 8 });
    expect(currentConversation(s).title).toBe('🔎 dark mode');
    expect(openConversation(s, first, 'sess-2')).toBe('sess-1');
    expect(s.current).toBe(first);
    expect(s.list.find((c) => c.id !== first)?.sessionId).toBe('sess-2');
    expect(() => openConversation(s, 'cgone', null)).toThrow(/no longer saved/);
    startConversation(s, null, 9);
    const empty = s.current;
    openConversation(s, first, null);
    expect(s.list.some((c) => c.id === empty)).toBe(false); // a new one left empty goes
  });

  it('lists pinned ones first, then the latest, without sessions', () => {
    const s = loadChats(undefined, [], 1);
    const a = s.current;
    startConversation(s, null, 2);
    const b = s.current;
    touchConversation(s, { from: 'manager', text: 'B', at: 9 });
    startConversation(s, null, 3);
    pinConversation(s, a, true);
    const view = conversationsView(s);
    expect(view.map((c) => c.id)).toEqual([a, b, s.current]);
    expect(view[0]).not.toHaveProperty('sessionId');
    expect(() => pinConversation(s, 'cgone', true)).toThrow();
  });

  it('drops the oldest unpinned conversations past the cap, never a pinned or the current one', () => {
    const s = loadChats(undefined, [], 0);
    const pinned = s.current;
    pinConversation(s, pinned, true);
    const dropped: string[] = [];
    for (let i = 1; i <= MAX_CONVERSATIONS + 2; i++) dropped.push(...startConversation(s, null, i));
    expect(s.list).toHaveLength(MAX_CONVERSATIONS);
    expect(dropped).toHaveLength(3);
    expect(s.list.some((c) => c.id === pinned)).toBe(true);
    expect(dropped).not.toContain(s.current);
  });

  it('searches titles and messages for every word, with a snippet', () => {
    const list = [
      { id: 'c1', title: 'Bakery plan', startedAt: 0, updatedAt: 0, pinned: false, count: 2 },
      { id: 'c2', title: 'Dark mode', startedAt: 0, updatedAt: 0, pinned: false, count: 1 },
    ];
    const threads = new Map([
      ['c1', [msg(1, 'manager', 'Ship the croissant page on Friday after QA signs off, and tell the team.'), msg(2, 'office', 'dark mode merged')]],
      ['c2', [msg(3, 'ceo', 'The DARK theme is ready.')]],
    ]);
    expect(searchConversations(list, threads, 'croissant friday')).toEqual([{ id: 'c1', snippet: 'Ship the croissant page on Friday after QA signs off, and…' }]);
    expect(searchConversations(list, threads, 'dark').map((h) => h.id)).toEqual(['c2']); // office notes aren't searched
    expect(searchConversations(list, threads, 'bakery')[0]).toEqual({ id: 'c1', snippet: 'Bakery plan' });
    expect(searchConversations(list, threads, '  ')).toEqual([]);
  });

  it("starts a new office's first conversation on first use, and says when a message names it", () => {
    const s = { current: '', list: [] };
    expect(touchConversation(s, { from: 'office', text: 'Floor 1 opened', at: 1 })).toBe(false);
    expect(s.list).toHaveLength(1);
    expect(touchConversation(s, { from: 'manager', text: 'Plan the bakery', at: 2 })).toBe(true);
    expect(touchConversation(s, { from: 'manager', text: 'And the cake shop', at: 3 })).toBe(false);
    expect(currentConversation(s)).toMatchObject({ title: 'Plan the bakery', count: 3 });
  });

  it('titles a conversation from its first line, shortened', () => {
    expect(titleFrom('\n  Hello there  \nmore')).toBe('Hello there');
    expect(titleFrom('x'.repeat(100))).toHaveLength(60);
    expect(titleFrom('')).toBe(UNTITLED);
  });
});

// ---------- threads (#132) ----------

const shot: FileRef = { id: 'f1', name: 'shot.png', type: 'image/png', size: 2048, from: 'manager', at: 4, keep: false };
const brief: FileRef = { id: 'f2', name: 'brief.pdf', type: 'application/pdf', size: 9000, from: 'ceo', at: 6, keep: false };
const oldThread: PhoneMessage[] = [
  { id: 1, from: 'manager', text: 'Look at floor 2', at: 4, attachments: [shot], refs: [{ kind: 'floor', repoId: 'r2', start: 8, end: 15 }] },
  { id: 2, from: 'ceo', text: 'Here is the plan', at: 5, artifacts: [{ id: '2-0', title: 'Plan', lead: 'Three steps', markdown: '# Plan' }] },
  { id: 3, from: 'ceo', text: 'And the brief', at: 6, attachments: [brief], refs: [{ kind: 'issue', repoId: 'r1', number: 3, start: 0, end: 3 }] },
];

describe('threads (#132)', () => {
  it('migrates the conversation from before threads into the first thread, with nothing lost', () => {
    // an office from before conversations: its thread becomes the first one
    const s = loadChats(undefined, oldThread, 10);
    expect(s.list).toHaveLength(1);
    expect(currentConversation(s)).toMatchObject({ title: 'Look at floor 2', count: 3, repoId: null, floors: ['r2', 'r1'], files: 3, ceoAt: 6, archived: false });
    // every artifact and attachment is in that thread's Files
    const items = libraryItems([{ id: s.current, messages: oldThread }]);
    expect(items.map((i) => i.title).sort()).toEqual(['Plan', 'brief.pdf', 'shot.png']);
    // a conversation saved before #132: the open one is filled from its messages, the others are listed to fill from disk
    const saved = { current: 'cnow', list: [{ id: 'cnow', title: 'Now', startedAt: 1, updatedAt: 6, pinned: false, count: 3, sessionId: 's1' }, { id: 'cold', title: 'Old', startedAt: 0, updatedAt: 1, pinned: true, count: 9, sessionId: null }] };
    const loaded = loadChats(saved, oldThread, 10);
    expect(loaded.list.find((c) => c.id === 'cnow')).toMatchObject({ title: 'Now', sessionId: 's1', floors: ['r2', 'r1'], files: 3, ceoAt: 6 });
    expect(loaded.list.find((c) => c.id === 'cold')).toMatchObject({ title: 'Old', pinned: true, count: 9, floors: [], files: 0 });
    expect(unfilled(saved)).toEqual(['cnow', 'cold']);
    expect(unfilled(JSON.parse(JSON.stringify(loaded)))).toEqual([]);
    expect(threadStats(oldThread)).toEqual({ floors: ['r2', 'r1'], files: 3, ceoAt: 6 });
  });

  it('keeps a new thread in its project, and tells the list about new floors, files and replies', () => {
    const s = loadChats(undefined, [], 1);
    startConversation(s, null, 2, 'r1');
    expect(currentConversation(s).repoId).toBe('r1');
    expect(touchConversation(s, oldThread[0])).toBe(true); // the title
    expect(touchConversation(s, { from: 'manager', text: 'thanks', at: 7 })).toBe(false);
    expect(touchConversation(s, oldThread[1])).toBe(true); // an artifact and a reply
    expect(currentConversation(s)).toMatchObject({ floors: ['r2'], files: 2, ceoAt: 5 });
    expect(unreadThread(currentConversation(s), 4)).toBe(true);
    expect(unreadThread(currentConversation(s), 5)).toBe(false);
  });

  it('renames, archives, pins and moves a thread, refusing what it cannot be', () => {
    const s = loadChats(undefined, [], 1);
    const id = s.current;
    editConversation(s, id, conversationPatch({ title: '  Bakery launch\nmore  ', archived: true, repoId: 'r1' }, ['r1']));
    expect(currentConversation(s)).toMatchObject({ title: 'Bakery launch', archived: true, repoId: 'r1' });
    editConversation(s, id, conversationPatch({ repoId: null, archived: false, pinned: true }, ['r1']));
    expect(currentConversation(s)).toMatchObject({ repoId: null, archived: false, pinned: true });
    expect(() => conversationPatch({ title: ' ' }, [])).toThrow(/title/);
    expect(() => conversationPatch({ repoId: 'gone' }, ['r1'])).toThrow(/no longer/);
    expect(() => editConversation(s, 'cgone', {})).toThrow(/no longer saved/);
    touchConversation(s, { from: 'manager', text: 'Something else', at: 3 });
    expect(currentConversation(s).title).toBe('Bakery launch'); // a renamed thread keeps its name
  });

  it('groups the list into Pinned, Today, This week and Older, by project, archived apart', () => {
    const now = new Date(2026, 10, 7, 15, 0).getTime();
    const day = 24 * 3600_000;
    const midnight = new Date(2026, 10, 7).getTime();
    const t = (id: string, updatedAt: number, more: Partial<Conversation> = {}): Conversation => ({ id, title: id, startedAt: 0, updatedAt, pinned: false, count: 1, ...more });
    const list = [
      t('today', midnight + 60_000),
      t('late', midnight - 60_000), // yesterday
      t('week', midnight - 6 * day + 1),
      t('old', midnight - 6 * day - 1),
      t('pin', 0, { pinned: true, repoId: 'r1' }),
      t('arch', now, { archived: true }),
      t('named', now - 1, { floors: ['r1'] }),
    ];
    expect(groupThreads(list, now).map((g) => [g.group, g.threads.map((c) => c.id)])).toEqual([
      ['Pinned', ['pin']],
      ['Today', ['named', 'today']],
      ['This week', ['late', 'week']],
      ['Older', ['old']],
    ]);
    expect(groupThreads(list, now, { archived: true })).toEqual([{ group: 'Today', threads: [list[5]] }]);
    expect(groupThreads(list, now, { scope: 'r1' }).flatMap((g) => g.threads.map((c) => c.id))).toEqual(['pin', 'named']);
    expect(groupThreads(list, now, { scope: 'company', ids: ['today', 'pin'] }).flatMap((g) => g.threads.map((c) => c.id))).toEqual(['today']);
    expect(inScope({ repoId: 'r2', floors: ['r1'] }, 'r1')).toBe(false); // another project's thread stays there
  });

  it("says a project thread's floor once, with its first message", () => {
    const s = loadChats(undefined, [], 1);
    startConversation(s, null, 2, 'r1');
    const repos = [{ id: 'r1', floor: 1, fullName: 'acme/shop' }];
    const thread = [msg(1, 'manager', 'Hi'), msg(2, 'ceo', 'Hello'), msg(3, 'manager', 'More')];
    expect(projectLine(s, thread, thread[0], repos)).toBe('(This thread is in the project of floor 1, acme/shop.)');
    expect(projectLine(s, thread, thread[2], repos)).toBe('');
    startConversation(s, null, 3);
    expect(projectLine(s, thread, thread[0], repos)).toBe('');
  });
});

