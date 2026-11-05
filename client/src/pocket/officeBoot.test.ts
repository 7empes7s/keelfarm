import { describe, expect, it } from 'vitest';
import { crashReason } from './officeBoot';

describe("the 3D office's start-up breadcrumb", () => {
  it('means nothing when there is none, or it is unreadable', () => {
    expect(crashReason(null)).toBeNull();
    expect(crashReason('')).toBeNull();
    expect(crashReason('{not json')).toBeNull();
    expect(crashReason('{"at":1}')).toBeNull();
  });

  it('left behind, says how far the start got and the error it saw', () => {
    expect(crashReason(JSON.stringify({ step: 'entering the office' }))).toBe('the page reloaded while entering the office, likely out of memory');
    expect(crashReason(JSON.stringify({ step: 'starting the 3D view', error: 'WebGL context lost' }))).toBe('WebGL context lost (while starting the 3D view)');
  });
});
