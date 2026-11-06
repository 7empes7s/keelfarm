import { describe, expect, it } from 'vitest';
import { CONNECTING_MS, DEAD_MS, onResume, onTick, RESUME_STALE_MS, socketStale } from './heartbeat.ts';

const open = (heardAt: number) => ({ readyState: 1, startedAt: 0, heardAt });

describe('socketStale', () => {
  it('trusts an open socket heard from recently, not one gone quiet', () => {
    expect(socketStale(open(100_000), 100_000 + RESUME_STALE_MS, RESUME_STALE_MS)).toBe(false);
    expect(socketStale(open(100_000), 100_001 + RESUME_STALE_MS, RESUME_STALE_MS)).toBe(true);
  });

  it('gives a connect a moment, then calls it stuck', () => {
    const s = { readyState: 0, startedAt: 50_000, heardAt: 0 };
    expect(socketStale(s, 50_000 + CONNECTING_MS, RESUME_STALE_MS)).toBe(false);
    expect(socketStale(s, 50_001 + CONNECTING_MS, RESUME_STALE_MS)).toBe(true);
  });

  it('never trusts a closing or closed socket', () => {
    expect(socketStale({ readyState: 2, startedAt: 0, heardAt: 10 }, 10, RESUME_STALE_MS)).toBe(true);
    expect(socketStale({ readyState: 3, startedAt: 0, heardAt: 10 }, 10, RESUME_STALE_MS)).toBe(true);
  });
});

describe('onResume', () => {
  it('reconnects a socket the background left silent (iOS: half-open, no close)', () => {
    expect(onResume(open(0), 5 * 60_000)).toBe('reconnect');
  });

  it('reconnects at once while a retry is still waiting out its backoff', () => {
    expect(onResume({ readyState: 3, startedAt: 0, heardAt: 0 }, 1_000)).toBe('reconnect');
  });

  it('leaves a live socket and a fresh connect alone, so several resume events make one reconnect', () => {
    expect(onResume(open(90_000), 100_000)).toBe('none');
    expect(onResume({ readyState: 0, startedAt: 100_000, heardAt: 0 }, 100_050)).toBe('none');
  });
});

describe('onTick', () => {
  it('lets an idle foreground tab hearing beats be', () => {
    expect(onTick(open(100_000), 100_000 + DEAD_MS)).toBe('none');
  });

  it('replaces an open socket after two missed beats', () => {
    expect(onTick(open(100_000), 100_001 + DEAD_MS)).toBe('reconnect');
  });

  it('leaves a closed socket to its pending retry', () => {
    expect(onTick({ readyState: 3, startedAt: 0, heardAt: 0 }, 10 * DEAD_MS)).toBe('none');
  });
});
