import { describe, expect, it } from 'vitest';
import { ChatLog, chatRows, commandLabel, groupLabel, mergeChat, outcomeOf, statusReaction, stepOf, transcriptEvents, type ChatItem } from './agentChat';
import { REACTION_PROMPT, reactionNote, sendsNote } from './reactions';

const at = '2026-11-07T10:00:00.000Z';
const line = (o: object) => JSON.stringify({ timestamp: at, ...o });
const cwd = '/work/desk';

describe('transcriptEvents', () => {
  it('reads the prompt, text, tool calls and results of the main thread', () => {
    const chunk = [
      line({ type: 'user', uuid: 'u1', message: { content: 'Build #12: dark mode' } }),
      line({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'On it.' }] } }),
      line({ type: 'assistant', uuid: 'a2', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${cwd}/src/App.tsx` } }] } }),
      line({ type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '184 lines' }] }] } }),
      line({ type: 'assistant', uuid: 's1', isSidechain: true, message: { content: [{ type: 'text', text: 'helper' }] } }),
      line({ type: 'user', uuid: 'm1', isMeta: true, message: { content: 'caveat' } }),
      line({ type: 'user', uuid: 'c1', message: { content: '<command-name>/clear</command-name>' } }),
      '{"broken',
    ].join('\n');
    const seen = new Set<string>();
    const ev = transcriptEvents(chunk, 0, seen);
    expect(ev.map((e) => e.kind)).toEqual(['prompt', 'text', 'tool', 'result']);
    expect(ev[3]).toMatchObject({ id: 't1', text: '184 lines', error: false });
    expect(transcriptEvents(chunk, 0, seen)).toEqual([]); // already read
  });

  it('skips what a resumed conversation wrote before the session started', () => {
    expect(transcriptEvents(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'old' }] } }), Date.parse(at) + 1, new Set())).toEqual([]);
  });
});

describe('steps', () => {
  it('labels tool calls in plain words', () => {
    expect(stepOf('Read', { file_path: `${cwd}/src/App.tsx` }, cwd)).toMatchObject({ group: 'explore', text: 'Read App.tsx', file: 'src/App.tsx' });
    expect(stepOf('Edit', { file_path: `${cwd}/a.ts`, old_string: 'x\ny', new_string: 'a\nb\nc' }, cwd)).toMatchObject({ group: 'edit', text: 'Edited a.ts (+3 −2)', plus: 3, minus: 2 });
    expect(stepOf('Bash', { command: `cd ${cwd} && npm test -- --run` }, cwd).text).toBe('Ran the tests');
    expect(stepOf('mcp__playwright__browser_navigate', { url: 'http://localhost:5200/' }, cwd).text).toBe('Opened localhost:5200/');
    expect(stepOf('mcp__office__lab_screenshot', {}, cwd).text).toBe('Used lab screenshot');
    expect(commandLabel('gh pr create --title x')).toBe('Opened a pull request');
    expect(commandLabel('ls -la')).toBe('Ran ls -la');
  });

  it('sums a run up', () => {
    expect(outcomeOf('Test Files 7 passed\n      Tests  312 passed (312)')).toBe('312 passed');
    expect(outcomeOf('Tests  3 failed | 309 passed (312)')).toBe('3 failed · 309 passed');
    expect(outcomeOf('Test Files  7 passed (7)')).toBe('7 passed');
    expect(outcomeOf('✓ built in 1.62s')).toBe('built');
    expect(outcomeOf('ok')).toBeUndefined();
  });
});

const ev = (events: Parameters<ChatLog['apply']>[0], log = new ChatLog()) => ({ log, changed: log.apply(events, cwd, (t) => t.replaceAll('ghp_secret', '•••')) });

describe('ChatLog', () => {
  it('folds a session into items, results into their steps, and adds milestones', () => {
    const { log } = ev([
      { kind: 'prompt', t: 1, text: 'Build #12' },
      { kind: 'text', t: 2, text: 'token ghp_secret here' },
      { kind: 'tool', t: 3, id: 'b1', name: 'Bash', input: { command: 'npm test' } },
      { kind: 'result', t: 4, id: 'b1', text: 'Tests  41 passed (41)', error: false },
      { kind: 'tool', t: 5, id: 'b2', name: 'Bash', input: { command: 'gh pr create --fill' } },
      { kind: 'result', t: 6, id: 'b2', text: 'https://github.com/o/r/pull/77', error: false },
      { kind: 'tool', t: 7, id: 'b3', name: 'Bash', input: { command: 'npm run build' } },
      { kind: 'result', t: 8, id: 'b3', text: 'Error: cannot find module\nstack', error: true },
      { kind: 'prompt', t: 9, text: 'a later prompt' },
    ]);
    const kinds = log.items.map((x) => x.kind);
    expect(kinds).toEqual(['prompt', 'text', 'step', 'step', 'milestone', 'step']);
    expect(log.items[1].text).toBe('token ••• here'); // masked
    expect(log.items[2]).toMatchObject({ done: true, outcome: '41 passed' });
    expect(log.items[4]).toMatchObject({ milestone: 'pr', pr: 77, text: 'Opened PR #77' });
    expect(log.items[5].error).toBe('Error: cannot find module');
  });

  it("leaves out a prompt the office already shows as the manager's message, and reaction notes", () => {
    const log = new ChatLog();
    log.add({ t: 0, kind: 'manager', text: 'Please add a test', who: 'Manager' });
    ev([{ kind: 'prompt', t: 1, text: 'Please add a test' }], log);
    log.session();
    ev([{ kind: 'prompt', t: 2, text: '[manager reacted 👎 to: "x"]' }], log);
    expect(log.items.map((x) => x.kind)).toEqual(['manager']);
  });

  it('toggles reactions and keeps the newest items', () => {
    const log = new ChatLog();
    const it = log.add({ t: 0, kind: 'text', text: 'hi' });
    expect(log.react(it.id, '👍')).toMatchObject({ added: true, item: { reactions: ['👍'] } });
    expect(log.react(it.id, '👍')?.added).toBe(false);
    expect(it.reactions).toBeUndefined();
    expect(log.react(999, '👍')).toBeNull();
    for (let i = 0; i < 250; i++) log.add({ t: i, kind: 'text', text: String(i) });
    expect(log.items).toHaveLength(200);
  });
});

const step = (id: number, group: ChatItem['group'], text: string, more: Partial<ChatItem> = {}): ChatItem => ({ id, t: id, kind: 'step', group, text, done: true, ...more });

describe('chatRows', () => {
  it('groups runs of reads and edits, never commands', () => {
    const rows = chatRows([
      step(1, 'explore', 'Read a.ts', { file: 'a.ts' }),
      step(2, 'explore', 'Read b.ts', { file: 'b.ts' }),
      step(3, 'explore', 'Searched for "x"'),
      step(4, 'edit', 'Edited a.ts (+2 −1)', { file: 'src/a.ts', plus: 2, minus: 1 }),
      step(5, 'edit', 'Edited a.ts (+3 −0)', { file: 'src/a.ts', plus: 3, minus: 0, done: false }),
      step(6, 'run', 'Ran the tests', { outcome: '312 passed' }),
      step(7, 'run', 'Built the project', { error: 'boom' }),
      { id: 8, t: 8, kind: 'text', text: 'done' },
    ]);
    expect(rows.map((r) => (r.kind === 'steps' ? r.label : r.item.text))).toEqual(['Explored 2 files and 1 search', 'Edited a.ts (+5 −1)', 'Ran the tests · 312 passed', 'Built the project', 'done']);
    expect(rows[1]).toMatchObject({ running: true });
    expect(rows[3]).toMatchObject({ failed: true });
    expect(groupLabel([step(1, 'edit', 'x', { file: 'a' }), step(2, 'edit', 'y', { file: 'b', plus: 4 })])).toBe('Edited 2 files (+4 −0)');
  });

  it('merges what the office sends by id', () => {
    const a = { id: 1, t: 1, kind: 'step' as const, text: 'Ran x' };
    expect(mergeChat([a], [{ ...a, done: true }, { id: 2, t: 2, kind: 'text', text: 'ok' }])).toEqual([{ ...a, done: true }, { id: 2, t: 2, kind: 'text', text: 'ok' }]);
  });
});

describe('reactions', () => {
  it('sends only the ones that ask for something, as a short note', () => {
    expect(reactionNote('👎', "I'll skip the UI test")).toBe(`[manager reacted 👎 to: "I'll skip the UI test"]`);
    expect(reactionNote('🤔', 'say "hi"\nthere')).toBe(`[manager reacted 🤔 to: "say 'hi' there"]`);
    expect(reactionNote('🎉', 'yay')).toBeNull();
    expect(['❤️', '👀', '🎉'].some((r) => sendsNote(r as '🎉'))).toBe(false);
    expect(reactionNote('⚠️', 'x'.repeat(300))!.length).toBeLessThan(120);
    expect(REACTION_PROMPT.length).toBeLessThan(200);
  });

  it("marks the manager's message seen, in hand, then answered", () => {
    const m: ChatItem = { id: 1, t: 1, kind: 'manager', text: 'add a test' };
    expect(statusReaction([m], 0, true)).toBe('👀');
    expect(statusReaction([m, step(2, 'run', 'Ran the tests')], 0, true)).toBe('⏳');
    expect(statusReaction([m, { id: 3, t: 3, kind: 'text', text: 'Added.' }], 0, true)).toBe('✅');
    expect(statusReaction([m, { id: 3, t: 3, kind: 'text', text: 'ok' }, step(4, 'run', 'x')], 0, false)).toBe('✅');
  });
});
