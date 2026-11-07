import { describe, expect, it } from 'vitest';
import { knownUrl } from './browserAddress';

describe('knownUrl', () => {
  it('takes the page a screenshot or navigation was of', () => {
    expect(knownUrl(null, 'http://localhost:5200/settings')).toBe('http://localhost:5200/settings');
    expect(knownUrl('http://localhost:5200/', 'http://localhost:5200/todos')).toBe('http://localhost:5200/todos');
  });

  it('keeps the last known address through screenshots that say nothing', () => {
    const shots = ['http://localhost:5200/', null, undefined, '  '];
    expect(shots.reduce<string | null>((last, page) => knownUrl(last, page), null)).toBe('http://localhost:5200/');
  });

  it('stays unknown (null) while no screenshot has said where it was', () => {
    expect(knownUrl(null, null)).toBeNull();
    expect([null, undefined].reduce<string | null>((last, page) => knownUrl(last, page), null)).toBeNull();
  });
});
