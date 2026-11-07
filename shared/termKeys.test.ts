import { describe, expect, it } from 'vitest';
import { activeMods, barKeys, clipboardPaste, consumeMods, DOUBLE_TAP_MS, keyboardInset, keyName, keySequence, MORE_KEYS, NO_MODS, pasteText, tapMod, textSequence, type BarKey, type Mod } from './termKeys';

const mods = (...m: Mod[]) => new Set(m);

describe('keySequence', () => {
  it('sends the plain keys', () => {
    expect(keySequence('esc')).toBe('\x1b');
    expect(keySequence('tab')).toBe('\t');
    expect(keySequence('enter')).toBe('\r');
    expect(keySequence('backspace')).toBe('\x7f');
    expect(keySequence('up')).toBe('\x1b[A');
    expect(keySequence('down')).toBe('\x1b[B');
    expect(keySequence('right')).toBe('\x1b[C');
    expect(keySequence('left')).toBe('\x1b[D');
    expect(keySequence('home')).toBe('\x1b[H');
    expect(keySequence('end')).toBe('\x1b[F');
    expect(keySequence('pgup')).toBe('\x1b[5~');
    expect(keySequence('pgdn')).toBe('\x1b[6~');
    expect(keySequence('del')).toBe('\x1b[3~');
  });

  it('uses SS3 for arrows in application cursor mode, CSI once modified', () => {
    expect(keySequence('up', mods(), true)).toBe('\x1bOA');
    expect(keySequence('home', mods(), true)).toBe('\x1bOH');
    expect(keySequence('up', mods('ctrl'), true)).toBe('\x1b[1;5A');
  });

  it('encodes modifiers the xterm way', () => {
    expect(keySequence('left', mods('ctrl'))).toBe('\x1b[1;5D');
    expect(keySequence('right', mods('shift'))).toBe('\x1b[1;2C');
    expect(keySequence('up', mods('alt'))).toBe('\x1b[1;3A');
    expect(keySequence('down', mods('ctrl', 'shift'))).toBe('\x1b[1;6B');
    expect(keySequence('left', mods('ctrl', 'alt', 'shift'))).toBe('\x1b[1;8D');
    expect(keySequence('pgup', mods('ctrl'))).toBe('\x1b[5;5~');
    expect(keySequence('del', mods('shift'))).toBe('\x1b[3;2~');
  });

  it('sends Shift+Tab as CSI Z and prefixes Alt with ESC', () => {
    expect(keySequence('tab', mods('shift'))).toBe('\x1b[Z');
    expect(keySequence('tab', mods('alt'))).toBe('\x1b\t');
    expect(keySequence('esc', mods('alt'))).toBe('\x1b\x1b');
    expect(keySequence('enter', mods('alt'))).toBe('\x1b\r');
    expect(keySequence('backspace', mods('alt'))).toBe('\x1b\x7f');
    expect(keySequence('backspace', mods('ctrl'))).toBe('\b');
  });

  it('sends the function keys', () => {
    expect(keySequence('f1')).toBe('\x1bOP');
    expect(keySequence('f4')).toBe('\x1bOS');
    expect(keySequence('f5')).toBe('\x1b[15~');
    expect(keySequence('f12')).toBe('\x1b[24~');
    expect(keySequence('f1', mods('shift'))).toBe('\x1b[1;2P');
    expect(keySequence('f5', mods('ctrl'))).toBe('\x1b[15;5~');
  });
});

describe('textSequence', () => {
  it('passes text through with nothing armed', () => {
    expect(textSequence('hello', mods())).toBe('hello');
  });

  it('turns Ctrl+letter into a control character, either case', () => {
    expect(textSequence('c', mods('ctrl'))).toBe('\x03');
    expect(textSequence('C', mods('ctrl'))).toBe('\x03');
    expect(textSequence('a', mods('ctrl'))).toBe('\x01');
    expect(textSequence('z', mods('ctrl'))).toBe('\x1a');
    expect(textSequence('[', mods('ctrl'))).toBe('\x1b');
    expect(textSequence(' ', mods('ctrl'))).toBe('\0');
    expect(textSequence('1', mods('ctrl'))).toBe('1');
  });

  it('prefixes Alt with ESC and upper-cases with Shift', () => {
    expect(textSequence('b', mods('alt'))).toBe('\x1bb');
    expect(textSequence('p', mods('shift'))).toBe('P');
    expect(textSequence('x', mods('ctrl', 'alt'))).toBe('\x1b\x18');
  });

  it('applies to the first character only and leaves sequences alone', () => {
    expect(textSequence('cat', mods('ctrl'))).toBe('\x03at');
    expect(textSequence('\x1b[A', mods('ctrl'))).toBe('\x1b[A');
  });

  it('maps the keyboard return, tab and backspace to their keys', () => {
    expect(textSequence('\t', mods('shift'))).toBe('\x1b[Z');
    expect(textSequence('\r', mods('alt'))).toBe('\x1b\r');
    expect(textSequence('\x7f', mods('alt'))).toBe('\x1b\x7f');
  });
});

describe('sticky modifiers', () => {
  it('arms on a tap and clears after one key', () => {
    const armed = tapMod(NO_MODS, 'ctrl', Infinity);
    expect(armed.ctrl).toBe('once');
    expect([...activeMods(armed)]).toEqual(['ctrl']);
    expect(consumeMods(armed)).toEqual(NO_MODS);
  });

  it('locks on a double tap and stays through keys until tapped again', () => {
    const locked = tapMod(tapMod(NO_MODS, 'alt', Infinity), 'alt', DOUBLE_TAP_MS - 1);
    expect(locked.alt).toBe('locked');
    expect(consumeMods(locked)).toBe(locked);
    expect(tapMod(locked, 'alt', 5).alt).toBe('off');
  });

  it('a slow second tap disarms instead of locking', () => {
    expect(tapMod(tapMod(NO_MODS, 'shift', Infinity), 'shift', DOUBLE_TAP_MS + 1).shift).toBe('off');
  });

  it('clears one-shot modifiers but keeps locked ones together', () => {
    const state = { ctrl: 'once', alt: 'locked', shift: 'off' } as const;
    expect([...activeMods(state)].sort()).toEqual(['alt', 'ctrl']);
    expect(consumeMods(state)).toEqual({ ctrl: 'off', alt: 'locked', shift: 'off' });
  });
});

describe('the bar', () => {
  const labels = (keys: BarKey[]) => keys.map((key) => key.label);

  it('shows Esc, Tab, the arrows, Enter and Ctrl for every coding agent', () => {
    for (const cli of ['claude', 'codex', 'opencode'] as const) expect(labels(barKeys(cli))).toEqual(expect.arrayContaining(['Esc', 'Tab', '↑', '↓', '←', '→', '⏎', 'Ctrl', '/', '@', '!', '^C']));
  });

  it("shows Claude Code's own shortcuts only for Claude Code", () => {
    expect(labels(barKeys('claude'))).toEqual(expect.arrayContaining(['⇧Tab', 'Esc Esc', '^R', '^O', '^T']));
    expect(labels(barKeys('codex'))).not.toContain('⇧Tab');
    expect(labels(barKeys('codex'))).toContain('Esc Esc');
  });

  it('every key sends something', () => {
    for (const key of [...barKeys('claude'), ...barKeys('codex'), ...MORE_KEYS]) {
      if ('key' in key) expect(keySequence(key.key, new Set(key.mods))).not.toBe('');
      else if ('text' in key) expect(key.text).not.toBe('');
    }
    expect(MORE_KEYS.some((key) => 'paste' in key)).toBe(true);
    expect(labels(MORE_KEYS)).toEqual(expect.arrayContaining(['Alt', 'Shift', 'Home', 'End', 'PgUp', 'PgDn', 'Del', '^A', '^E', '^U', '^K', '^L', '^D', '^Z', 'F1', 'F12', '|', '~', '`']));
  });
});

describe('Paste (#278)', () => {
  it('is in the first row, right after Esc, for every coding agent', () => {
    for (const cli of ['claude', 'codex', 'opencode'] as const) {
      const row = barKeys(cli);
      expect(row[0].label).toBe('Esc');
      expect(row[1]).toMatchObject({ label: 'Paste', paste: true });
      expect(row[1]).not.toHaveProperty('primary');
    }
  });

  it('is the highlighted key on a sign-in terminal', () => {
    expect(barKeys('claude', { signIn: true })[1]).toMatchObject({ label: 'Paste code', paste: true, primary: true });
  });

  it('pastes what the clipboard has, trimmed', async () => {
    expect(await clipboardPaste({ readText: async () => '  code-123#abc\n' })).toEqual({ text: 'code-123#abc' });
    expect(pasteText(' a\nb \r\n')).toBe('a\nb');
  });

  it('opens the paste sheet when the clipboard is missing, refused or empty', async () => {
    expect(await clipboardPaste(undefined)).toEqual({ sheet: true });
    expect(await clipboardPaste({ readText: () => Promise.reject(new DOMException('Read permission denied.', 'NotAllowedError')) })).toEqual({ sheet: true });
    expect(await clipboardPaste({ readText: async () => ' \n ' })).toEqual({ sheet: true });
  });
});

describe('keyName', () => {
  it('names what the bar sends', () => {
    expect(keyName('\x1b')).toBe('Esc');
    expect(keyName('\x1b\x1b')).toBe('Esc Esc');
    expect(keyName('\x1b[Z')).toBe('Shift+Tab');
    expect(keyName('\x1b[A')).toBe('↑');
    expect(keyName('\x1bOA')).toBe('↑');
    expect(keyName('\x1b[1;5D')).toBe('Ctrl+←');
    expect(keyName('\x1b[5;2~')).toBe('Shift+PgUp');
    expect(keyName('\x1b[24~')).toBe('F12');
    expect(keyName('\x03')).toBe('Ctrl+C');
    expect(keyName('\x1bb')).toBe('Alt+b');
  });

  it('leaves text, Enter and Backspace to the terminal', () => {
    expect(keyName('hi')).toBeNull();
    expect(keyName('\r')).toBeNull();
    expect(keyName('a')).toBeNull();
    expect(keyName('\x7f')).toBeNull();
  });
});

describe('keyboardInset', () => {
  it('measures the keyboard from the visual viewport', () => {
    expect(keyboardInset(844, { height: 500, offsetTop: 0 })).toBe(344);
    expect(keyboardInset(844, { height: 500, offsetTop: 40 })).toBe(304);
  });

  it('ignores browser bars, and no visual viewport means no keyboard', () => {
    expect(keyboardInset(844, { height: 800, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(844, null)).toBe(0);
  });
});
