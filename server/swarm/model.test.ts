import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECTS_DIR } from '../config.ts';
import { DEFAULT_MAX_AGENTS, FLOOR_SEATS } from '../../shared/types.ts';
import { cell, clampMaxAgents, oneLine, prepKey } from './model.ts';

describe('clampMaxAgents', () => {
  it('rounds to a seat count between 1 and a full floor', () => {
    expect(clampMaxAgents(3.4)).toBe(3);
    expect(clampMaxAgents('5')).toBe(5);
    expect(clampMaxAgents(-2)).toBe(1);
    expect(clampMaxAgents(FLOOR_SEATS + 10)).toBe(FLOOR_SEATS);
  });

  it('falls back to the default for anything that is not a number', () => {
    expect(clampMaxAgents('lots')).toBe(DEFAULT_MAX_AGENTS);
    expect(clampMaxAgents(undefined)).toBe(DEFAULT_MAX_AGENTS);
    expect(clampMaxAgents(0)).toBe(DEFAULT_MAX_AGENTS);
  });
});

describe('small helpers', () => {
  it('cell escapes pipes and line breaks for a markdown table', () => {
    expect(cell('a | b\nc\r\nd')).toBe('a \\| b<br>c<br>d');
  });

  it('oneLine keeps the first line of an error, at most 200 characters', () => {
    expect(oneLine(new Error('first\nsecond'))).toBe('first');
    expect(oneLine('x'.repeat(300))).toHaveLength(200);
  });

  it('prepKey tells a PR\'s QA and fix desks apart', () => {
    expect(prepKey('o/r', 7, 'qa')).toBe('o/r#7:qa');
    expect(prepKey('o/r', 7, 'qa')).not.toBe(prepKey('o/r', 7, 'fix'));
  });
});

describe('the default projects folder', () => {
  it('is the folder this checkout sits in, wherever the code that uses it lives', () => {
    expect(DEFAULT_PROJECTS_DIR).toBe(path.resolve(import.meta.dirname, '..', '..', '..'));
  });
});
