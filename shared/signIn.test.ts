import { describe, expect, it } from 'vitest';
import { inputShape, signInCode, signInEnd } from './signIn.ts';

describe('signInCode', () => {
  it('sends exactly the code, its #state kept', () => {
    expect(signInCode('abc123#state456')).toBe('abc123#state456');
    expect(signInCode('  abc123#state456\r\n')).toBe('abc123#state456');
  });

  it('strips bracketed paste markers, other escapes and line breaks inside it', () => {
    expect(signInCode('\x1b[200~abc123#state456\x1b[201~')).toBe('abc123#state456');
    expect(signInCode('abc123\n#state\t456\x1b]8;;x\x07')).toBe('abc123#state456');
  });

  it('turns a copied callback address into code#state', () => {
    expect(signInCode('https://platform.claude.com/oauth/code/callback?code=abc123&state=state456')).toBe('abc123#state456');
    expect(signInCode('https://example.com/no-code')).toBe('https://example.com/no-code');
  });
});

describe('inputShape', () => {
  it('describes what was sent without the value', () => {
    expect(inputShape('abc123#state456')).toBe('15 characters, with #state');
    expect(inputShape(' \x1b[200~a')).toBe('8 characters, no #state, escape bytes, spaces around it');
  });
});

describe('signInEnd', () => {
  it('names the CLI’s HTTP status when it says one', () => {
    const end = signInEnd('login', 1, ['Paste code here if prompted > ', 'Login failed: Request failed with status code 400', '']);
    expect(end.ok).toBe(false);
    expect(end.note).toMatch(/^Sign-in failed \(400\)\. Try again/);
  });

  it('a clean exit is a success; other failures say the exit code', () => {
    expect(signInEnd('login', 0, [])).toEqual({ ok: true, note: 'Signed in.' });
    expect(signInEnd('setup-token', 0, []).note).toMatch(/copy it/);
    expect(signInEnd('login', 2, ['bye']).note).toBe('Sign-in failed (exit 2). Try again.');
    expect(signInEnd('login', -1, []).note).toMatch(/could not start/);
  });
});
