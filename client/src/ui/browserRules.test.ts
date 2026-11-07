import { describe, expect, it } from 'vitest';
import { addressBar, ago, clampPan, clampZoom, isBrowsing, previewTarget, shotCaption } from './browserRules';

describe('addressBar', () => {
  it('says "address unknown" instead of about:blank when none is known', () => {
    expect(addressBar(null)).toEqual({ text: 'address unknown', unknown: true, secure: false, previewPath: null });
  });

  it('links a floor app on this computer or through the office to the same path in the preview', () => {
    expect(addressBar('http://localhost:5200/settings?tab=agents#top')).toMatchObject({ text: 'localhost:5200/settings?tab=agents#top', previewPath: '/settings?tab=agents#top' });
    expect(addressBar('http://127.0.0.1:6301/')).toMatchObject({ previewPath: '/' });
    expect(addressBar('https://office.example/preview/6301/todos')).toMatchObject({ secure: true, previewPath: '/todos' });
  });

  it('leaves other addresses as plain text', () => {
    expect(addressBar('https://github.com/o/r/pull/3')).toMatchObject({ text: 'github.com/o/r/pull/3', secure: true, previewPath: null });
    expect(addressBar('about:blank')).toMatchObject({ text: 'about:blank', unknown: false, previewPath: null });
  });
});

describe('the caption', () => {
  const now = 1_000_000_000;
  it('names whose browser and how long ago', () => {
    expect(shotCaption('Grace', now - 2 * 60_000, now)).toBe("@Grace's browser · 2 min ago");
    expect(shotCaption('Grace', now - 5_000, now)).toBe("@Grace's browser · just now");
    expect(shotCaption('Grace', null, now)).toBe("@Grace's browser");
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago');
  });

  it('has a live dot only while their session is browsing', () => {
    expect(isBrowsing({ status: 'working', currentTool: 'mcp__playwright__browser_click', screenshotAt: null }, now)).toBe(true);
    expect(isBrowsing({ status: 'working', currentTool: 'Bash', screenshotAt: now - 10_000 }, now)).toBe(true);
    expect(isBrowsing({ status: 'working', currentTool: 'Bash', screenshotAt: now - 120_000 }, now)).toBe(false);
    expect(isBrowsing({ status: 'done', currentTool: 'mcp__playwright__browser_click', screenshotAt: now }, now)).toBe(false);
  });
});

describe('the viewer', () => {
  it('zooms between 1× and 5× and keeps the picture covering its box', () => {
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(9)).toBe(5);
    expect(clampPan({ x: 500, y: -500 }, 2, { w: 400, h: 300 })).toEqual({ x: 200, y: -150 });
    expect(clampPan({ x: 30, y: 30 }, 1, { w: 400, h: 300 })).toEqual({ x: 0, y: 0 });
  });
});

describe('previewTarget', () => {
  const pulls = [
    { number: 3, state: 'OPEN' as const, headSha: 'aaaaaaaaaa' },
    { number: 26, state: 'MERGED' as const, headSha: 'bbbbbbbbbb' },
    { number: 9, state: 'CLOSED' as const, headSha: 'cccccccccc' },
  ];

  it('opens the PR channel at the path while the PR is open', () => {
    expect(previewTarget(3, pulls, '/todos')).toEqual({ pr: 3, path: '/todos' });
  });

  it('opens main at the path once the PR merged, saying so', () => {
    expect(previewTarget(26, pulls, '/todos')).toEqual({ pr: null, path: '/todos', merged: { pr: 26, sha: 'bbbbbbb', path: '/todos' } });
  });

  it('opens main at the path for a closed, unknown or missing PR', () => {
    expect(previewTarget(9, pulls, '/a')).toEqual({ pr: null, path: '/a' });
    expect(previewTarget(77, pulls, '/a')).toEqual({ pr: null, path: '/a' });
    expect(previewTarget(null, pulls, '/a')).toEqual({ pr: null, path: '/a' });
  });
});
