import { describe, expect, it } from 'vitest';
import { codeTitle } from './codeBlock';
import { foldText, isLong } from './longText';

describe('long chat messages', () => {
  it('fold behind Show more when they are long in characters or lines', () => {
    expect(isLong('A short status.')).toBe(false);
    expect(isLong('word '.repeat(300))).toBe(true);
    expect(isLong(Array.from({ length: 30 }, (_, i) => `- item ${i}`).join('\n'))).toBe(true);
  });
});

const fence = (cmds: string[]) => ['```bash', ...cmds, '```'].join('\n');
const prose = (n: number) => Array.from({ length: n }, (_, i) => `Paragraph ${i}: ${'some words that explain the step '.repeat(3)}`).join('\n\n');
// the manager's screenshot (#339): an intro, then A, B and C, each a heading, a line and commands
const instructions = [
  prose(2),
  ...['A. Quick wins', 'B. Old previews', 'C. The disk'].flatMap((h) => [`## ${h}`, 'Paste this:', fence(['free -h', 'ps -eo pid,rss,cmd --sort=-rss | head -15', 'swapon --show'])]),
  prose(4),
].join('\n\n');

const fences = (md: string) => md.split('\n').filter((l) => l.startsWith('```')).length;

describe('where a long message folds (#339)', () => {
  it('never splits a code block', () => {
    for (const text of [instructions, `${prose(5)}\n\n${fence(Array.from({ length: 30 }, (_, i) => `echo ${i}`))}\n\n${prose(5)}`]) {
      const fold = foldText(text)!;
      expect(fold.shown).not.toBeNull();
      expect(fences(fold.shown!) % 2).toBe(0);
      expect(text.startsWith(fold.shown!)).toBe(true);
    }
  });

  it('keeps an instruction message’s first code block in view, its commands whole', () => {
    const fold = foldText(instructions)!;
    expect(fold.shown).toContain('ps -eo pid,rss,cmd --sort=-rss | head -15\nswapon --show\n```');
    // even when the commands come after a long introduction
    const late = foldText(`${prose(8)}\n\n${fence(['df -h /'])}\n\n${prose(4)}`)!;
    expect(late.shown).toContain('df -h /\n```');
    expect(late.more).toBe('Show more');
  });

  it('says what the fold hides', () => {
    expect(foldText(instructions)!.more).toMatch(/^Show more · [12] more code blocks?$/);
    const table = ['| a | b |', '| - | - |', ...Array.from({ length: 4 }, (_, i) => `| ${i} | x |`)].join('\n');
    expect(foldText(`${prose(6)}\n\n${table}\n\n${prose(2)}\n\n${table}`)!.more).toBe('Show more · 2 more tables');
    expect(foldText(`${prose(6)}\n\n${fence(['ls'])}\n\n${prose(6)}\n\n${fence(['pwd'])}\n\n${fence(['id'])}`)!.more).toBe('Show more · 2 more code blocks');
  });

  it('leaves short messages whole and cuts one long run of prose by height', () => {
    expect(foldText('A short status.')).toBeNull();
    expect(foldText(`Run this:\n\n${fence(Array.from({ length: 20 }, (_, i) => `echo ${i}`))}`)).toBeNull();
    expect(foldText('word '.repeat(400))).toEqual({ shown: null, more: 'Show more' });
    expect(foldText(`${prose(14)}\n\n${fence(['ls'])}\n\nThat's all.`)).toBeNull();
  });

  it('measures what shows, not the link targets the chat adds', () => {
    const linked = Array.from({ length: 6 }, (_, i) => `[#${i}](https://github.com/o/r/pull/${i}${'x'.repeat(200)})`).join(' ');
    expect(foldText(linked)).toBeNull();
  });
});

describe('a code block’s header', () => {
  it('shows its language and line count', () => {
    expect(codeTitle('bash', 3)).toBe('Terminal · 3 lines');
    expect(codeTitle('', 1)).toBe('Code · 1 line');
  });
});
