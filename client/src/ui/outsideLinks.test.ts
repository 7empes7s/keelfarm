import { describe, expect, it } from 'vitest';
import { opensOutside } from './outsideLinks';

const office = 'http://office.local:4317';

describe('links in the home-screen app', () => {
  it('open other sites, previews and raw files in a new tab', () => {
    expect(opensOutside('https://github.com/acme/app/pull/4', office, '')).toBe(true);
    expect(opensOutside(`${office}/preview/6301/`, office, '_self')).toBe(true);
    expect(opensOutside('/api/repos/acme%2Fapp/pulls/4/qa-shots/0', office, '')).toBe(true);
  });
  it("leave the office's own pages and links that already open elsewhere alone", () => {
    expect(opensOutside('/#settings/floors', office, '')).toBe(false);
    expect(opensOutside('https://github.com/', office, '_blank')).toBe(false);
    expect(opensOutside('mailto:a@b.c', office, '')).toBe(false);
  });
});
