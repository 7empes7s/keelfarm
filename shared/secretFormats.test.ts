import { describe, expect, it } from 'vitest';
import { detectSecret, secretMismatch, type SecretKind } from './secretFormats.ts';

const SAMPLES: Record<Exclude<SecretKind, 'upstash'>, string> = {
  anthropic: 'sk-ant-api03-abcdefghijklmnop',
  openai: 'sk-proj-abcdefghijklmnop',
  github: 'github_pat_11ABCDEFG0123456789',
  elevenlabs: 'sk_0123456789abcdef0123456789abcdef0123456789abcdef',
  telegram: '123456789:AAEexampleSECRETtokenSECRETtoken4242',
};
const FIELDS: SecretKind[] = ['anthropic', 'openai', 'github', 'upstash', 'elevenlabs', 'telegram'];

describe('secret formats (#264)', () => {
  it('recognises each kind, Anthropic before OpenAI', () => {
    for (const [kind, value] of Object.entries(SAMPLES)) expect(detectSecret(value)).toBe(kind);
    expect(detectSecret('  ghp_abc  ')).toBe('github');
    expect(detectSecret('gho_login')).toBe('github');
    expect(detectSecret('upstash-box-key-123')).toBeNull();
  });

  it('accepts each kind in its own field and refuses it in every other', () => {
    for (const [kind, value] of Object.entries(SAMPLES) as [SecretKind, string][]) {
      for (const field of FIELDS) {
        if (field === kind) expect(secretMismatch(field, value)).toBeNull();
        else expect(secretMismatch(field, value)).toMatch(/^This looks like your /);
      }
    }
  });

  it('names both the key and the field', () => {
    expect(secretMismatch('github', SAMPLES.anthropic)).toBe('This looks like your Anthropic key, not a GitHub token.');
    expect(secretMismatch('openai', SAMPLES.anthropic)).toBe('This looks like your Anthropic key, not an OpenAI API key.');
    expect(secretMismatch('upstash', SAMPLES.github)).toBe('This looks like your GitHub token, not an Upstash Box API key.');
  });

  it('wants its own prefix where a field has one, and lets an empty value remove the saved one', () => {
    expect(secretMismatch('anthropic', 'nope')).toBe('Anthropic API keys start with sk-ant-.');
    expect(secretMismatch('openai', 'nope')).toBe('OpenAI API keys start with sk-.');
    expect(secretMismatch('github', 'nope')).toMatch(/github_pat_/);
    expect(secretMismatch('upstash', 'any-box-key')).toBeNull();
    expect(secretMismatch('elevenlabs', '0123456789abcdef0123456789abcdef')).toBeNull();
    for (const field of FIELDS) expect(secretMismatch(field, '  ')).toBeNull();
  });
});
