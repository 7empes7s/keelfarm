import { describe, expect, it } from 'vitest';
import { FLOOR_COLORS, lookFor, NAMES, pick, slugify } from './flavour.ts';

describe('lookFor', () => {
  it('gives the feminine look to names in the list, by first name and ignoring case and spaces', () => {
    expect(lookFor('Ada')).toBe('feminine');
    expect(lookFor('  grace hopper ')).toBe('feminine');
    expect(lookFor('MARPLE')).toBe('feminine');
  });

  it('gives everyone else the masculine look', () => {
    expect(lookFor('Linus')).toBe('masculine');
    expect(lookFor('Hopper Grace')).toBe('masculine');
    expect(lookFor('')).toBe('masculine');
  });
});

describe('slugify', () => {
  it('makes a lowercase, dash-separated slug without dashes at the ends', () => {
    expect(slugify('Ada Lovelace')).toBe('ada-lovelace');
    expect(slugify('  --Fix: the QA loop!-- ')).toBe('fix-the-qa-loop');
  });

  it('caps it at 40 characters', () => {
    expect(slugify('a'.repeat(60))).toHaveLength(40);
  });

  it('falls back to "agent" when nothing is left', () => {
    expect(slugify('')).toBe('agent');
    expect(slugify('!!! ???')).toBe('agent');
  });
});

describe('the name pool', () => {
  it('has no duplicates', () => {
    expect(new Set(NAMES).size).toBe(NAMES.length);
  });

  it('pick returns one of the choices', () => {
    for (let i = 0; i < 20; i++) expect(FLOOR_COLORS).toContain(pick(FLOOR_COLORS));
  });
});
