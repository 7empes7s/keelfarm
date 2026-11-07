import { describe, expect, it } from 'vitest';
import { mountOf, socketUrl } from './socketUrl';

describe('socket addresses', () => {
  it("open on the office's own address at the root", () => {
    expect(socketUrl('/ws', { protocol: 'http:', host: 'localhost:4317', pathname: '/' })).toBe('ws://localhost:4317/ws');
    expect(socketUrl('/ws/term?agent=a', { protocol: 'https:', host: 'office.ts.net', pathname: '/' })).toBe('wss://office.ts.net/ws/term?agent=a');
  });

  it("keep a preview gateway's mount, never the other office's /ws (#192)", () => {
    const at = { protocol: 'https:', host: 'office.ts.net', pathname: '/preview/6401/' };
    expect(socketUrl('/ws', at)).toBe('wss://office.ts.net/preview/6401/ws');
    expect(socketUrl('/ws/term?agent=a', at)).toBe('wss://office.ts.net/preview/6401/ws/term?agent=a');
  });

  it('only reads a whole mount', () => {
    expect(mountOf('/preview/6401/')).toBe('/preview/6401');
    expect(mountOf('/preview/6401')).toBe('');
    expect(mountOf('/preview/sw.js')).toBe('');
    expect(mountOf('/about')).toBe('');
  });
});
