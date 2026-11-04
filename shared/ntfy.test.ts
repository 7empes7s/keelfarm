import { describe, expect, it } from 'vitest';
import { ntfyLinks, ntfyTopic } from './ntfy.ts';

describe('ntfy topics', () => {
  it('are long, random and URL-safe', () => {
    const topic = ntfyTopic(new Uint8Array(16).map((_, i) => i * 37));
    expect(topic).toMatch(/^cubefarm-[a-z2-9]{25}$/);
    expect(topic).not.toMatch(/[lo01]/);
    expect(ntfyTopic(new Uint8Array(16).fill(0))).toBe(`cubefarm-${'a'.repeat(25)}`);
    expect(ntfyTopic(new Uint8Array(16).fill(255))).toBe(`cubefarm-${'9'.repeat(25)}`);
    expect(ntfyTopic(new Uint8Array(16).fill(1))).not.toBe(ntfyTopic(new Uint8Array(16).fill(2)));
  });

  it('need enough randomness', () => {
    expect(() => ntfyTopic(new Uint8Array(8))).toThrow(/12 random bytes/);
  });

  it('open in the ntfy app and on the web', () => {
    expect(ntfyLinks('https://ntfy.sh/cubefarm-abc')).toEqual({ topic: 'cubefarm-abc', app: 'ntfy://ntfy.sh/cubefarm-abc', web: 'https://ntfy.sh/cubefarm-abc' });
    expect(ntfyLinks('https://ntfy.example.org:8443/office/')).toEqual({ topic: 'office', app: 'ntfy://ntfy.example.org:8443/office', web: 'https://ntfy.example.org:8443/office' });
  });
});
