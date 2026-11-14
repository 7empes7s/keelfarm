import { describe, expect, it } from 'vitest';
import { BargeMeter, deafNow, rms, TAIL_MS } from './callDuplex';

/** Feeds `ms` of 3 ms blocks at a mic and output level; the time the meter said "barge", or -1. */
function feed(m: BargeMeter, mic: number, out: number, ms: number, from = 0): number {
  for (let t = from; t < from + ms; t += 3) if (m.push(mic, out, 3, t)) return t - from + 3;
  return -1;
}

describe('half duplex (#694)', () => {
  it('is deaf while the voice plays and a moment after, never longer', () => {
    expect(deafNow(true, 0, 10_000)).toBe(true);
    expect(deafNow(false, 10_000, 10_000 + TAIL_MS - 1)).toBe(true);
    expect(deafNow(false, 10_000, 10_000 + TAIL_MS)).toBe(false);
  });

  it("never barges on the voice's own echo, however loud", () => {
    expect(feed(new BargeMeter(), 0.2, 0.2, 3000)).toBe(-1);
    expect(feed(new BargeMeter(), 0.25, 0.2, 3000)).toBe(-1);
    expect(feed(new BargeMeter(), 0.01, 0, 3000)).toBe(-1); // a quiet room
  });

  it("barges on the manager's voice over the voice within 300 ms", () => {
    const at = feed(new BargeMeter(), 0.3, 0.05, 1000);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThanOrEqual(300);
  });

  it('counts the echo the voice played lately, not only now', () => {
    const m = new BargeMeter();
    feed(m, 0.2, 0.2, 100); // a loud syllable
    expect(feed(m, 0.2, 0.01, 200, 100)).toBe(-1); // its echo arrives as the voice goes quiet
  });

  it('measures a block', () => {
    expect(rms([0.5, -0.5])).toBe(0.5);
    expect(rms([])).toBe(0);
  });
});
