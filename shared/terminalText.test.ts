import { describe, expect, it } from 'vitest';
import { cleanTerminalText } from './terminalText.ts';

describe('cleanTerminalText', () => {
  it('strips colour and cursor codes', () => {
    expect(cleanTerminalText('\x1b[31mFAIL\x1b[39m \x1b[1mserver/a.test.ts\x1b[22m\x1b[2K')).toBe('FAIL server/a.test.ts');
    expect(cleanTerminalText('\x9b1mbold\x9b0m')).toBe('bold');
  });

  it('strips OSC links and titles, keeping the link text', () => {
    expect(cleanTerminalText('see \x1b]8;;https://x.test/a\x1b\\the docs\x1b]8;;\x1b\\ now')).toBe('see the docs now');
    expect(cleanTerminalText('\x1b]0;my title\x07done')).toBe('done');
  });

  it('strips codes shown as ␛ and ones that lost their ESC', () => {
    expect(cleanTerminalText('npm test failed (exit 1): ␛[2m[1/1]␛[22m␛[39m')).toBe('npm test failed (exit 1): [1/1]');
    expect(cleanTerminalText('tests [2m[1/1][22m[39m')).toBe('tests [1/1]');
  });

  it('collapses box-drawing runs to one dash', () => {
    expect(cleanTerminalText(`before ${'─'.repeat(400)} after ████▌`)).toBe('before — after —');
    expect(cleanTerminalText('a ─ b')).toBe('a ─ b');
  });

  it('drops control characters, keeping lines', () => {
    expect(cleanTerminalText('one\r\ntwo\x07\x00\n\n\n\nthree  \n')).toBe('one\ntwo\n\nthree');
  });

  it('caps the length with an ellipsis', () => {
    const out = cleanTerminalText('x'.repeat(5000), 100);
    expect(out).toHaveLength(100);
    expect(out.endsWith('…')).toBe(true);
    expect(cleanTerminalText('short', 100)).toBe('short');
  });
});
