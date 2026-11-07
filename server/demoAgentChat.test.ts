import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatLog } from '../shared/agentChat.ts';
import type { SessionCallbacks, SessionOptions } from './agentRunner.ts';
import { demoEvents, withDemoChat } from './demoAgentChat.ts';

const cwd = path.join('work', 'desk');

describe("the demo's agent chats (#120)", () => {
  it('reads scripted lines back as reads, edits, a test run and a PR, across batches', () => {
    const open = { id: null as string | null, n: 0 };
    const log = new ChatLog();
    const feed = (entries: Parameters<typeof demoEvents>[1]) => log.apply(demoEvents(cwd, entries, open, 1), cwd);
    feed([{ kind: 'tool', tool: 'Read', text: '⏺ Read src/App.tsx' }, { kind: 'result', text: '  ⎿ Read 184 lines' }]);
    feed([{ kind: 'tool', tool: 'Edit', text: '⏺ Edit src/App.tsx' }, { kind: 'result', text: '  ⎿ Updated' }]);
    feed([{ kind: 'text', text: "● The state lives in a single hook. I'll extend it." }]);
    feed([{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test -- --run' }]);
    feed([{ kind: 'result', text: '  ⎿ ✓ feature.test.ts (4 tests)' }, { kind: 'result', text: '    Tests  41 passed (41)' }]);
    feed([{ kind: 'tool', tool: 'Bash', text: '⏺ $ gh pr create --title "x"' }]);
    feed([{ kind: 'result', text: '  ⎿ https://github.com/o/r/pull/9' }]);
    expect(log.items.map((x) => x.text)).toEqual(['Read App.tsx', 'Edited App.tsx (+8 −3)', "The state lives in a single hook. I'll extend it.", 'Ran the tests', 'Opened a pull request', 'Opened PR #9']);
    expect(log.items[3].outcome).toBe('41 passed');
    expect(log.items[2].reactions).toEqual(['👍']);
    expect(log.items.every((x) => x.kind !== 'step' || x.done)).toBe(true);
  });

  it('feeds only Claude Code agents on this computer, and closes the last step when the session ends', () => {
    const got: string[] = [];
    const cb = { log: () => undefined, finished: () => undefined, chat: (ev: { kind: string }[]) => got.push(...ev.map((e) => e.kind)) } as unknown as SessionCallbacks;
    const opts = { cwd, prompt: 'Build #3', role: 'agent' } as SessionOptions;
    expect(withDemoChat({ ...opts, cli: 'codex' }, cb)).toBe(cb);
    const c = withDemoChat(opts, cb);
    c.log([{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run build' }]);
    c.finished({ ok: true, text: '', costUsd: 0, turns: 1, errors: [] });
    expect(got).toEqual(['prompt', 'tool', 'result']);
  });

  it("finishes a later session's own steps, not the earlier session's (ids don't repeat)", () => {
    const log = new ChatLog();
    const cb = { log: () => undefined, finished: () => undefined, chat: (ev: Parameters<ChatLog['apply']>[0]) => log.apply(ev, cwd) } as unknown as SessionCallbacks;
    const opts = { cwd, prompt: 'Build #3', role: 'agent' } as SessionOptions;
    for (const file of ['a.ts', 'b.ts']) {
      log.session();
      const c = withDemoChat(opts, cb);
      c.log([{ kind: 'tool', tool: 'Read', text: `⏺ Read ${file}` }, { kind: 'result', text: '  ⎿ Read 9 lines' }]);
      c.log([{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test' }, { kind: 'result', text: '  ⎿ Tests  4 passed (4)' }]);
    }
    const steps = log.items.filter((x) => x.kind === 'step');
    expect(steps).toHaveLength(4);
    expect(steps.every((x) => x.done)).toBe(true);
  });
});
