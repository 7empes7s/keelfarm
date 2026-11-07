import { describe, expect, it } from 'vitest';
import { floorAt, githubUrl, linkCeoText, urlParts, type FloorRef } from './chatLinks';

const floors: FloorRef[] = [
  { floor: 3, fullName: 'acme/web', prs: [5] },
  { floor: 1, fullName: 'acme/api' },
];

describe('#N links', () => {
  it('links to the floor named before it', () => {
    expect(linkCeoText('On floor 3 #5 is ready.', floors)).toBe('On [floor 3](cubefarm:floor/3) [#5](https://github.com/acme/web/pull/5) is ready.');
    expect(linkCeoText('floor 1: #7, floor 3: #8', floors)).toBe(
      '[floor 1](cubefarm:floor/1): [#7](https://github.com/acme/api/issues/7), [floor 3](cubefarm:floor/3): [#8](https://github.com/acme/web/issues/8)',
    );
  });

  it('else the first floor the message names, else the lowest floor', () => {
    expect(floorAt('#2 is blocked on floor 3', 0, floors)?.floor).toBe(3);
    expect(linkCeoText('#2 is blocked', floors)).toBe('[#2](https://github.com/acme/api/issues/2) is blocked');
    expect(floorAt('#2 on floor 9', 0, floors)?.floor).toBe(1); // no floor 9
  });

  it('leaves code, links, URLs and words alone', () => {
    const md = 'Run `git log #4` and\n```\n#5\n```\nsee [#6](https://x.io) or https://x.io/a#7 or abc#8 &#9; #10';
    expect(linkCeoText(md, floors)).toBe(md.replace(' #10', ' [#10](https://github.com/acme/api/issues/10)'));
  });

  it('links nothing without floors', () => {
    expect(linkCeoText('floor 1 #2', [])).toBe('floor 1 #2');
    expect(linkCeoText('floor 9', floors)).toBe('floor 9');
  });

  it('pull requests go to /pull, the rest to /issues (GitHub redirects either way)', () => {
    expect(githubUrl(floors[0], 5)).toBe('https://github.com/acme/web/pull/5');
    expect(githubUrl(floors[0], 6)).toBe('https://github.com/acme/web/issues/6');
  });
});

describe('urlParts', () => {
  it('splits out URLs, without trailing punctuation', () => {
    expect(urlParts('see https://a.io/x?y=1. then http://b.io')).toEqual([
      { text: 'see ' },
      { text: 'https://a.io/x?y=1', url: 'https://a.io/x?y=1' },
      { text: '. then ' },
      { text: 'http://b.io', url: 'http://b.io' },
    ]);
    expect(urlParts('no links')).toEqual([{ text: 'no links' }]);
    expect(urlParts('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }]);
  });
});
