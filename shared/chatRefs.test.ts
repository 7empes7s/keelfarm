import { describe, expect, it } from 'vitest';
import { cleanRefPath, parseRefs, refParts, refsLine, refsMarkdown, soleRef, type RefContext } from './chatRefs.ts';

const files = new Set(['o/web:portal/lib/insights.ts', 'o/web:docs/my notes.md', 'o/api:README.md']);
const ctx: RefContext = {
  floors: [
    { floor: 1, repoId: 'o/web' },
    { floor: 3, repoId: 'o/api' },
  ],
  agents: [
    { id: 'a1', name: 'Ada' },
    { id: 'a2', name: 'Ada Lovelace' },
    { id: 'a3', name: 'Ken' },
    { id: 'a4', name: 'Bo' },
    { id: 'a5', name: 'bo' },
  ],
  hasFile: (repoId, path) => files.has(`${repoId}:${path}`),
};
const kinds = (text: string, c = ctx) => parseRefs(text, c).map((r) => ({ ...r, text: text.slice(r.start, r.end) }));

describe('parseRefs', () => {
  it('finds agents and their terminals by name, the longest name first', () => {
    expect(kinds('Ask @Ada, then @Ada Lovelace and @ken/terminal.')).toEqual([
      { start: 4, end: 8, kind: 'agent', agentId: 'a1', text: '@Ada' },
      { start: 15, end: 28, kind: 'agent', agentId: 'a2', text: '@Ada Lovelace' },
      { start: 33, end: 46, kind: 'agent', agentId: 'a3', terminal: true, text: '@ken/terminal' },
    ]);
  });

  it('leaves unknown, ambiguous and email names as text', () => {
    expect(kinds('@Zed and @Bo and mail ada@Ada.dev, @Adam')).toEqual([]);
  });

  it('finds floors, and #N on a floor named before it, else the first named, else the only floor', () => {
    expect(kinds('floor 3 #13 and #14, floor 9 #2').map((r) => [r.kind, r.text])).toEqual([
      ['issue', 'floor 3 #13'],
      ['issue', '#14'],
    ]);
    expect(kinds('#5 is on floor 1')).toEqual([
      { start: 0, end: 2, kind: 'issue', repoId: 'o/web', number: 5, text: '#5' },
      { start: 9, end: 16, kind: 'floor', repoId: 'o/web', text: 'floor 1' },
    ]);
    expect(kinds('#5 alone')).toEqual([]); // two floors, none named: no guess
    expect(kinds('#5 alone', { ...ctx, floors: [ctx.floors[0]] })[0]).toMatchObject({ kind: 'issue', repoId: 'o/web', number: 5 });
    expect(kinds('a&#39; b/#3 c#4 floor 1')).toHaveLength(1);
  });

  it('finds QA reports and previews', () => {
    expect(kinds('See qa: floor 3 #13. And preview: floor 1, preview: Floor 3 #7.').map((r) => [r.kind, r.text, 'number' in r ? r.number : undefined])).toEqual([
      ['qa', 'qa: floor 3 #13', 13],
      ['preview', 'preview: floor 1', undefined],
      ['preview', 'preview: Floor 3 #7', 7],
    ]);
    expect(kinds('qa: floor 2 #13')).toEqual([]); // no floor 2
  });

  it('finds files that exist, with lines, quoted paths with spaces, and trailing punctuation left out', () => {
    expect(kinds('Look at file: floor 1 portal/lib/insights.ts:42.')).toEqual([
      { start: 8, end: 47, kind: 'file', repoId: 'o/web', path: 'portal/lib/insights.ts', line: 42, text: 'file: floor 1 portal/lib/insights.ts:42' },
    ]);
    expect(kinds('file: floor 1 `docs/my notes.md:3` and file: floor 1 "docs/my notes.md"').map((r) => [r.text, 'line' in r ? r.line : 0])).toEqual([
      ['file: floor 1 `docs/my notes.md:3`', 3],
      ['file: floor 1 "docs/my notes.md"', 0],
    ]);
    expect(kinds('file: floor 3 ./README.md')[0]).toMatchObject({ path: 'README.md' });
    // Missing, outside the repo or secret: text.
    expect(kinds('file: floor 1 nope.ts file: floor 1 ../etc/passwd file: floor 1 /etc/passwd file: floor 3 .env').filter((r) => r.kind === 'file')).toEqual([]);
  });

  it('skips code, links and URLs', () => {
    expect(kinds('`@Ada` ```\nfloor 1 #3\n``` [floor 1](https://x.dev) https://github.com/o/web/issues/1#2')).toEqual([]);
  });
});

describe('cleanRefPath', () => {
  it('keeps plain repo paths and refuses the rest', () => {
    expect(cleanRefPath('src\\a.ts')).toBe('src/a.ts');
    expect(cleanRefPath('./src//a.ts')).toBe('src/a.ts');
    for (const bad of ['', '/abs', 'C:/x', 'a/../../b', 'a/../b', '.git/config', 'x/.env', 'a\0b']) expect(cleanRefPath(bad)).toBeNull();
    expect(cleanRefPath('.env.example')).toBe('.env.example');
  });
});

describe('rendering refs', () => {
  const text = 'Ask @Ada about floor 1 #3 in `x`.';
  const refs = parseRefs(text, ctx);

  it('turns them into chip links in Markdown, and into parts in plain text', () => {
    expect(refsMarkdown(text, refs)).toBe('Ask [@Ada](cubefarm:ref/0) about [floor 1 #3](cubefarm:ref/1) in `x`.');
    expect(refParts(text, refs)).toEqual([{ text: 'Ask ' }, { text: '@Ada', ref: 0 }, { text: ' about ' }, { text: 'floor 1 #3', ref: 1 }, { text: ' in `x`.' }]);
  });

  it('drops refs that no longer fit the text', () => {
    expect(refsMarkdown('short', refs)).toBe('short');
    expect(refParts('Ask @Ada', refs)).toEqual([{ text: 'Ask ' }, { text: '@Ada', ref: 0 }]);
  });

  it('spells them out for the CEO', () => {
    expect(refsLine(text, refs)).toBe('(Refs: @Ada = agent a1; floor 1 #3 = o/web#3)');
    expect(refsLine('hi', [])).toBe('');
  });
});

describe('soleRef', () => {
  it('reads a cell that is a ref', () => {
    expect(soleRef('floor 3', ctx)).toMatchObject({ kind: 'floor', repoId: 'o/api' });
    expect(soleRef(' #12 ', { ...ctx, floors: [ctx.floors[0]] })).toMatchObject({ kind: 'issue', repoId: 'o/web', number: 12 });
    expect(soleRef('floor 3 #12', ctx)).toMatchObject({ kind: 'issue', repoId: 'o/api', number: 12 });
  });

  it('keeps free text that only mentions a floor as text', () => {
    expect(soleRef('Slow builds on floor 3', ctx)).toBeNull();
    expect(soleRef('floor 3 and floor 1', ctx)).toBeNull();
    expect(soleRef('Retry #12 later', { ...ctx, floors: [ctx.floors[0]] })).toBeNull();
    expect(soleRef('floor 9', ctx)).toBeNull();
  });
});
