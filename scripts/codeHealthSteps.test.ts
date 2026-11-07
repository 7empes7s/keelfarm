import { describe, expect, it } from 'vitest';
import {
  NEW_FILE_MAX_LINES,
  compare,
  describeRegression,
  isSourceFile,
  knipFindings,
  lineCount,
  lintCounts,
  lowered,
  makeBaseline,
  normalizePath,
  parseBaseline,
  serializeBaseline,
  sizeLimit,
} from './codeHealthSteps.mjs';

const diag = (filename: string, code: string) => ({ filename, code });

describe('lineCount', () => {
  it('counts like wc -l for LF and CRLF alike', () => {
    expect(lineCount('')).toBe(0);
    expect(lineCount('a\nb\n')).toBe(2);
    expect(lineCount('a\r\nb\r\n')).toBe(2);
    expect(lineCount('a\nb')).toBe(2);
  });
});

describe('paths', () => {
  it('normalizes Windows separators and a leading ./', () => {
    expect(normalizePath('server\\swarm.ts')).toBe('server/swarm.ts');
    expect(normalizePath('./client/src/a.tsx')).toBe('client/src/a.tsx');
  });

  it('counts only source files under the source folders', () => {
    expect(isSourceFile('server/swarm.ts')).toBe(true);
    expect(isSourceFile('client\\src\\styles.css')).toBe(true);
    expect(isSourceFile('docs/how-it-works.md')).toBe(false);
    expect(isSourceFile('vite.config.ts')).toBe(false);
    expect(isSourceFile('client/public/icons/icon-192.png')).toBe(false);
  });
});

describe('sizeLimit', () => {
  it('gives a recorded file 5% over its size and a new file the cap', () => {
    expect(sizeLimit('server/swarm.ts', { 'server/swarm.ts': 5534 })).toBe(5810);
    expect(sizeLimit('server/new.ts', { 'server/swarm.ts': 5534 })).toBe(NEW_FILE_MAX_LINES);
  });

  it('holds the split folders to their own caps (#187)', () => {
    expect(sizeLimit('e2e/layout/chat.spec.ts', {})).toBe(300);
    expect(sizeLimit('e2e\\layout\\chat.spec.ts', {})).toBe(300);
    expect(sizeLimit('shared/types/agents.ts', {})).toBe(400);
    expect(compare({ lint: {}, knip: [], sizes: {} }, { lint: {}, knip: [], sizes: { 'e2e/layout/chat.spec.ts': 301 } }).regressions).toHaveLength(1);
  });
});

describe('lintCounts', () => {
  it('counts per file and rule', () => {
    const report = {
      diagnostics: [
        diag('server\\a.ts', 'typescript(no-floating-promises)'),
        diag('server/a.ts', 'typescript(no-floating-promises)'),
        diag('server/a.ts', 'eqeqeq'),
        diag('client/b.tsx', 'eqeqeq'),
      ],
    };
    expect(lintCounts(report)).toEqual({
      'server/a.ts': { 'typescript(no-floating-promises)': 2, eqeqeq: 1 },
      'client/b.tsx': { eqeqeq: 1 },
    });
  });
});

describe('knipFindings', () => {
  it('turns every kind of finding into a sorted id without line numbers', () => {
    const report = {
      issues: [
        {
          file: 'server/voice.ts',
          exports: [{ name: 'B', line: 3 }, { name: 'A', line: 9 }],
          types: [{ name: 'T', line: 1 }],
          files: [],
          duplicates: [[{ name: 'x' }, { name: 'y' }]],
        },
        { file: 'client/dead.ts', files: [{ name: 'client/dead.ts' }], exports: [] },
        { file: 'package.json', devDependencies: [{ name: 'left-pad', line: 70 }] },
      ],
    };
    expect(knipFindings(report)).toEqual([
      'devDependencies:package.json:left-pad',
      'duplicates:server/voice.ts:x|y',
      'exports:server/voice.ts:A',
      'exports:server/voice.ts:B',
      'files:client/dead.ts',
      'types:server/voice.ts:T',
    ]);
  });
});

const baseline = {
  lint: { 'server/a.ts': { 'typescript(no-floating-promises)': 2, eqeqeq: 1 } },
  knip: ['exports:server/a.ts:A', 'exports:server/a.ts:B'],
  sizes: { 'server/swarm.ts': 1000 },
};

describe('compare', () => {
  it('passes the baseline itself', () => {
    const run = { ...baseline, sizes: { 'server/swarm.ts': 1000, 'server/a.ts': 50 } };
    expect(compare(baseline, run)).toEqual({ regressions: [], improvements: [] });
  });

  it('fails a new floating promise, a new unused export and a file past its budget', () => {
    const run = {
      lint: { 'server/a.ts': { 'typescript(no-floating-promises)': 3, eqeqeq: 1 } },
      knip: ['exports:server/a.ts:A', 'exports:server/a.ts:B', 'exports:server/a.ts:C'],
      sizes: { 'server/swarm.ts': 1051, 'server/new.ts': NEW_FILE_MAX_LINES + 1 },
    };
    const { regressions } = compare(baseline, run);
    expect(regressions.map(describeRegression)).toEqual([
      'knip exports: server/a.ts:C',
      'server/a.ts: typescript(no-floating-promises) 2 → 3',
      'server/new.ts: 801 lines, new files may have at most 800',
      'server/swarm.ts: 1051 lines, over its budget of 1050 (1000 + 5%)',
    ]);
  });

  it('lets a file grow within its 5% and reports what got better', () => {
    const run = { lint: {}, knip: ['exports:server/a.ts:A'], sizes: { 'server/swarm.ts': 1050 } };
    const { regressions, improvements } = compare(baseline, run);
    expect(regressions).toEqual([]);
    expect(improvements.map((i) => i.kind)).toEqual(['knip', 'lint', 'lint']);
  });
});

describe('lowered', () => {
  it('only lowers: fixed findings go, new ones stay out, sizes shrink', () => {
    const run = {
      lint: { 'server/a.ts': { 'typescript(no-floating-promises)': 1, eqeqeq: 4 }, 'server/b.ts': { eqeqeq: 1 } },
      knip: ['exports:server/a.ts:A', 'exports:server/a.ts:Z'],
      sizes: { 'server/swarm.ts': 900, 'server/big.ts': 2000 },
    };
    expect(lowered(baseline, run)).toEqual({
      lint: { 'server/a.ts': { 'typescript(no-floating-promises)': 1, eqeqeq: 1 } },
      knip: ['exports:server/a.ts:A'],
      sizes: { 'server/swarm.ts': 900 },
    });
  });

  it('drops a big file once it is under the cap', () => {
    expect(lowered(baseline, { lint: {}, knip: [], sizes: { 'server/swarm.ts': 700 } }).sizes).toEqual({});
  });
});

describe('serializeBaseline', () => {
  it('writes the same bytes for the same findings, whatever order they came in', () => {
    const a = makeBaseline({
      lint: { 'z.ts': { b: 1, a: 2 }, 'a.ts': { c: 1 } },
      knip: ['exports:z.ts:Q', 'exports:a.ts:P', 'exports:z.ts:Q'],
      sizes: { 'server/swarm.ts': 5534, 'client/small.ts': 10, 'server/demo.ts': 1645 },
    });
    const b = makeBaseline({
      lint: { 'a.ts': { c: 1 }, 'z.ts': { a: 2, b: 1 } },
      knip: ['exports:a.ts:P', 'exports:z.ts:Q'],
      sizes: { 'server/demo.ts': 1645, 'client/small.ts': 10, 'server/swarm.ts': 5534 },
    });
    const text = serializeBaseline(a);
    expect(serializeBaseline(b)).toBe(text);
    expect(serializeBaseline(parseBaseline(text))).toBe(text);
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(parseBaseline(text).sizes)).toEqual(['server/demo.ts', 'server/swarm.ts']);
    expect(Object.keys(parseBaseline(text).lint)).toEqual(['a.ts', 'z.ts']);
  });
});
