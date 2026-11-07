import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PhoneMessage } from '../shared/types.ts';

// A fresh demo office's chat (#118, #125, #114): it opens on the edited messages and the reactions sample, with the
// decisions still waiting on the manager after them, and every id unique and below the next message's.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-chat-seed-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');

afterAll(() => {
  vi.useRealTimers();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
});

describe("a fresh demo office's chat", () => {
  it('has the reactions sample and the edits next to the open decisions', { timeout: 60_000 }, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    const swarm = new Swarm(createDemoBackend());
    const init = swarm.init();
    await vi.advanceTimersByTimeAsync(5_000);
    await init;
    const messages = (swarm as unknown as { state: { messages: PhoneMessage[] } }).state.messages;
    const byText = (t: string) => messages.find((m) => m.text === t);

    expect(new Set(messages.map((m) => m.status).filter(Boolean))).toEqual(new Set(['done', 'failed', 'working', 'seen', 'queued']));
    expect(byText('ok thanks')?.reactions).toEqual([{ by: 'ceo', emoji: '👍' }]);
    const quoted = messages.filter((m) => m.from === 'ceo' && m.replyTo !== undefined).map((m) => messages.find((x) => x.id === m.replyTo)?.text);
    expect(quoted).toEqual(['Plan the checkout fix for floor 1', 'And can QA check the phone layout first?']);
    expect(messages.some((m) => m.versions?.length)).toBe(true); // #125's edits
    expect(swarm.snapshot().decisions?.length).toBeGreaterThan(0); // #114's, posted after them
    const payment = (swarm.snapshot().decisions ?? []).filter((d) => /payment|limit/i.test(d.question));
    expect(payment.map((d) => [d.question, d.status])).toEqual([
      ['Did you raise the limit, or shall I drop the Windows CI job?', 'open'],
      ['Raised the limit or drop the Windows CI job?', 'superseded'],
    ]); // #183's phone, the older one replaced
    expect(payment.map((d) => d.repoIds)).toEqual([['demo-co/recipe-box'], ['demo-co/recipe-box']]); // both on floor 3
    const reAsk = (swarm.snapshot().decisions ?? []).filter((d) => /file (all three|C)/.test(d.question));
    expect(reAsk.map((d) => [d.status, d.closedBy?.kind])).toEqual([
      ['resolved', 'reply'],
      ['resolved', 'reask'],
    ]); // #208's phone: the answer to the first closed the re-ask too

    const ids = messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const next = (swarm as unknown as { postMessage(from: 'office', text: string): PhoneMessage }).postMessage('office', 'hello');
    expect(next.id).toBeGreaterThan(Math.max(...ids));
  });
});
