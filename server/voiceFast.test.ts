import { describe, expect, it } from 'vitest';
import { fastModel, fastSentences, sseDeltas } from './voiceFast.ts';

/** Tokens the test hands over one at a time, so it can see what came out before the model finished. */
function gate() {
  const queue: (string | null)[] = [];
  let wake: (() => void) | null = null;
  return {
    push(t: string | null) {
      queue.push(t);
      wake?.();
    },
    async *tokens() {
      for (;;) {
        while (!queue.length) await new Promise<void>((r) => (wake = r));
        const t = queue.shift()!;
        if (t === null) return;
        yield t;
      }
    },
  };
}

describe('the Jarvis voice: fast answers (#665)', () => {
  it('streams the first sentence before the model has finished', async () => {
    const g = gate();
    const out = fastSentences(g.tokens());
    for (const t of ['Floor one', ' merged three', ' PRs today.', ' Grace']) g.push(t);
    const first = await out.next();
    expect(first).toEqual({ done: false, value: 'Floor one merged three PRs today. ' });
    g.push(' is on issue 3.5 now');
    g.push(null); // the model finishes only now
    expect(await out.next()).toEqual({ done: false, value: 'Grace is on issue 3.5 now' }); // "3." isn't a sentence end
    expect(await out.next()).toEqual({ done: true, value: 'done' });
  });

  it('hands the question to the CEO when the model says HANDOFF, saying nothing', async () => {
    const said: string[] = [];
    const g = gate();
    for (const t of ['HAND', 'OFF']) g.push(t);
    g.push(null);
    const out = fastSentences(g.tokens());
    let r = await out.next();
    for (; !r.done; r = await out.next()) said.push(r.value);
    expect(said).toEqual([]);
    expect(r.value).toBe('handoff');
  });

  it('reads an OpenAI-style stream and picks the fastest provider with a key', () => {
    const d = sseDeltas('data: {"choices":[{"delta":{"role":"assistant","content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\ndata: [DO');
    expect(d).toEqual({ pieces: ['Hi', ' there'], rest: 'data: [DO', done: false });
    expect(sseDeltas(`${d.rest}NE]\n`).done).toBe(true);
    expect(fastModel((p) => ({ openai: 'sk-1', cerebras: 'csk-1' })[p])?.provider).toBe('cerebras');
    expect(fastModel(() => undefined)).toBeNull();
  });
});
