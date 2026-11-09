import { describe, expect, it } from 'vitest';
import type { VoiceOption } from '../../../shared/types';
import { introLine, introOver, mayWarm, WarmQueue, warmFirst, warmKey, warmRest } from './voiceWarm';

const v = (id: string, recommended = false, previewUrl: string | null = null): VoiceOption => ({ id, name: id, category: 'premade', labels: {} as VoiceOption['labels'], previewUrl, recommended });

/** A load per key that resolves when told to, recording every call. */
function loader() {
  const calls: string[] = [];
  const waiting = new Map<string, { ok: (v: string) => void; no: (e: Error) => void }>();
  const load = (key: string) =>
    new Promise<string>((ok, no) => {
      calls.push(key);
      waiting.set(key, { ok, no });
    });
  const settle = async (key: string, fail = false) => {
    const w = waiting.get(key)!;
    if (fail) w.no(new Error('nope'));
    else w.ok(`clip:${key}`);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { calls, load, settle };
}

describe('warmFirst', () => {
  const list = [v('a'), v('b'), v('r1', true), v('c'), v('r2', true), v('d'), v('e'), v('f')];

  it('takes the chosen voice, favourites, then the Recommended ones, then the list order', () => {
    expect(warmFirst(list, ['d'], 'f').map((x) => x.id)).toEqual(['f', 'd', 'r1', 'r2', 'a']);
  });

  it('always includes the chosen voice, however far down', () => {
    expect(warmFirst(list, [], 'f', 2).map((x) => x.id)).toEqual(['f', 'r1']);
  });

  it('is short when the list is', () => {
    expect(warmFirst([v('a')], [], 'x')).toHaveLength(1);
  });
});

describe('mayWarm and warmRest', () => {
  const list = [v('own', false, 'https://cdn/own.mp3'), v('lib'), v('rec', true), v('seen'), v('fav')];

  it('never synthesises a library voice that is not shortlisted or on screen', () => {
    expect(mayWarm(list[1], [], '', new Set())).toBe(false);
    expect(mayWarm(list[0], [], '', new Set())).toBe(true); // its own preview: a free CDN fetch
    expect(mayWarm(list[2], [], '', new Set())).toBe(true);
    expect(mayWarm(list[1], [], '', new Set(['lib']))).toBe(true);
    expect(mayWarm(list[1], ['lib'], '', new Set())).toBe(true);
    expect(mayWarm(list[1], [], 'lib', new Set())).toBe(true);
  });

  it('puts the rows on screen first, then the list order', () => {
    expect(warmRest(list, ['fav'], '', new Set(['seen'])).map((x) => x.id)).toEqual(['seen', 'own', 'rec', 'fav']);
  });
});

describe('warmKey', () => {
  it('keys a preview by its URL and a test line by voice, model and speed', () => {
    expect(warmKey(v('a', false, 'https://cdn/a.mp3'), 'm', 1)).toBe('url:https://cdn/a.mp3');
    expect(warmKey(v('a'), 'm', 1)).not.toBe(warmKey(v('a'), 'n', 1));
    expect(warmKey(v('a'), 'm', 1)).not.toBe(warmKey(v('a'), 'm', 1.1));
  });
});

describe('introOver', () => {
  it('waits for every voice, the cap, or a skip', () => {
    expect(introOver(3, 5, 1000, false)).toBe(false);
    expect(introOver(5, 5, 1000, false)).toBe(true);
    expect(introOver(0, 5, 8000, false)).toBe(true);
    expect(introOver(0, 5, 10, true)).toBe(true);
    expect(introOver(0, 0, 10, false)).toBe(false); // the list hasn't come yet
  });

  it('says how far along it is', () => {
    expect(introLine(3, 5)).toBe('Getting voices ready… 3 of 5');
    expect(introLine(0, 0)).toBe('Getting voices ready…');
  });
});

describe('WarmQueue', () => {
  it('loads at most `concurrency` at once, in the order asked', async () => {
    const l = loader();
    const q = new WarmQueue(l.load, 2);
    q.want(['a', 'b', 'c', 'd']);
    expect(l.calls).toEqual(['a', 'b']);
    await l.settle('a');
    expect(l.calls).toEqual(['a', 'b', 'c']);
    expect(q.state('a')).toBe('ready');
    expect(q.value('a')).toBe('clip:a');
    expect(q.state('c')).toBe('loading');
    expect(q.state('d')).toBeUndefined();
  });

  it('puts rows on screen ahead of the waiting ones', async () => {
    const l = loader();
    const q = new WarmQueue(l.load, 1);
    q.want(['a', 'b', 'c']);
    q.want(['c'], true);
    await l.settle('a');
    expect(l.calls).toEqual(['a', 'c']);
  });

  it('requests each clip at most once, however often it is asked for or tapped', async () => {
    const l = loader();
    const q = new WarmQueue(l.load, 2);
    q.want(['a', 'a', 'b']);
    q.want(['a', 'b'], true);
    const tap = q.now('a');
    await l.settle('a');
    expect(await tap).toBe('clip:a');
    expect(await q.now('a')).toBe('clip:a');
    q.want(['a']);
    expect(l.calls.filter((k) => k === 'a')).toHaveLength(1);
  });

  it('a tap loads a clip that is only waiting, without loading it twice', async () => {
    const l = loader();
    const q = new WarmQueue(l.load, 1);
    q.want(['a', 'b']);
    void q.now('b');
    await l.settle('a');
    await l.settle('b');
    expect(l.calls).toEqual(['a', 'b']);
  });

  it('stops handing out work when paused and goes on when asked again', async () => {
    const l = loader();
    const q = new WarmQueue(l.load, 1);
    q.want(['a', 'b']);
    q.pause();
    await l.settle('a');
    expect(l.calls).toEqual(['a']);
    q.want(['b']);
    expect(l.calls).toEqual(['a', 'b']);
  });

  it('marks a failed load and lets a tap try it again', async () => {
    const l = loader();
    const q = new WarmQueue(l.load, 1);
    q.want(['a']);
    await l.settle('a', true);
    expect(q.state('a')).toBe('failed');
    q.want(['a']);
    expect(l.calls).toEqual(['a']); // the background doesn't retry
    void q.now('a').catch(() => undefined);
    expect(l.calls).toEqual(['a', 'a']);
  });
});
