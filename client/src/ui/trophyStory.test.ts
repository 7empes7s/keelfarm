import { describe, expect, it } from 'vitest';
import { trophyStory } from './trophyStory';

const repos = [
  { fullName: 'demo-co/pixel', url: 'https://github.com/demo-co/pixel', floor: 1 },
  { fullName: 'demo-co/pixel-todo', url: 'https://github.com/demo-co/pixel-todo', floor: 2 },
];
const at = Date.UTC(2026, 10, 7, 12);

describe('trophyStory', () => {
  it('links the PR its detail names and finds its floor, the longest repo name first', () => {
    const t = trophyStory('hat-trick', [{ id: 'hat-trick', at, detail: 'PR #12 on demo-co/pixel-todo: 3 merges within an hour' }], repos)!;
    expect(t.locked).toBe(false);
    expect(t.name).toBe('Hat trick');
    expect(t.blurb).toBe('Three merges on one floor within an hour');
    expect(t.pr).toEqual({ n: 12, url: 'https://github.com/demo-co/pixel-todo/pull/12' });
    expect(t.floor).toEqual({ n: 2, name: 'demo-co/pixel-todo' });
    expect(t.detail).toContain('3 merges within an hour');
    expect(t.when).toBeTruthy();
  });

  it('links to GitHub for a repo no longer connected, and has no PR when the detail names none', () => {
    expect(trophyStory('first-merge', [{ id: 'first-merge', at, detail: 'PR #3 on gone/repo' }], repos)!.pr).toEqual({ n: 3, url: 'https://github.com/gone/repo/pull/3' });
    const t = trophyStory('coffee-addict', [{ id: 'coffee-addict', at, detail: '10 coffees' }], repos)!;
    expect(t.pr).toBeNull();
    expect(t.floor).toBeNull();
  });

  it('says only how to win a locked one, and nothing for an unknown id', () => {
    const t = trophyStory('century', [], repos)!;
    expect(t).toMatchObject({ locked: true, blurb: '100 PRs merged', when: null, pr: null, floor: null });
    expect(t.name).not.toBe('Century');
    expect(trophyStory('nope', [], repos)).toBeNull();
  });
});
