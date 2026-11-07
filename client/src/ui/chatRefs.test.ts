import { describe, expect, it } from 'vitest';
import type { ChatRef, PullInfo } from '../../../shared/types';
import { chipInfo, codeTokens, fileWindow, jumpFor, mentionAt, mentionPicks, type RefWorld } from './chatRefs';

const pull = (number: number, state: PullInfo['state'], checks: PullInfo['checks'] = 'passing') => ({ number, state, checks, title: `PR ${number}` }) as PullInfo;
const world: RefWorld = {
  repos: [
    {
      id: 'o/web',
      floor: 2,
      fullName: 'o/web',
      pulls: [pull(13, 'OPEN'), pull(14, 'MERGED'), pull(15, 'CLOSED'), pull(16, 'OPEN', 'failing')],
      issues: [{ number: 3, title: 'Dark mode', body: '', url: '', labels: [], createdAt: '' }],
      preview: { status: 'running' } as RefWorld['repos'][number]['preview'],
    },
  ],
  agents: {
    ada: { id: 'ada', name: 'Ada', repoId: 'o/web', status: 'working', issueNumber: 3, prNumber: null },
    ceo: { id: 'ceo', name: 'Mo', repoId: '', status: 'idle', issueNumber: null, prNumber: null },
  },
  qa: { 'o/web#13': { status: 'passed', commentUrl: 'https://github.com/o/web/pull/13#c1' }, 'o/web#15': { status: 'failed', commentUrl: null } },
};
const at = { start: 0, end: 1 };
const ref = (r: Record<string, unknown>) => ({ ...at, ...r }) as ChatRef;

describe('jumpFor', () => {
  it('opens agents, cards and apps as panels, riding to their floor in 3D but not in pocket mode', () => {
    expect(jumpFor(ref({ kind: 'agent', agentId: 'ada' }), 'office', world)).toEqual({ kind: 'overlay', overlay: { kind: 'terminal', agentId: 'ada', view: 'chat' }, floor: 2 });
    expect(jumpFor(ref({ kind: 'agent', agentId: 'ada', terminal: true }), 'pocket', world)).toEqual({ kind: 'overlay', overlay: { kind: 'terminal', agentId: 'ada', view: 'terminal' } });
    expect(jumpFor(ref({ kind: 'issue', repoId: 'o/web', number: 3 }), 'office', world)).toEqual({ kind: 'overlay', overlay: { kind: 'card', repoId: 'o/web', key: 'i-3', number: 3, pr: false }, floor: 2 });
    expect(jumpFor(ref({ kind: 'issue', repoId: 'o/web', number: 13 }), 'pocket', world)).toEqual({ kind: 'overlay', overlay: { kind: 'card', repoId: 'o/web', key: 'pr-13', number: 13, pr: true } });
    expect(jumpFor(ref({ kind: 'issue', repoId: 'o/web', number: 14 }), 'pocket', world)).toMatchObject({ overlay: { key: 'm-14', pr: true } });
    expect(jumpFor(ref({ kind: 'qa', repoId: 'o/web', number: 13 }), 'office', world)).toEqual({ kind: 'overlay', overlay: { kind: 'app', repoId: 'o/web', pr: 13, qa: true }, floor: 2 });
    expect(jumpFor(ref({ kind: 'preview', repoId: 'o/web', number: 13 }), 'pocket', world)).toEqual({ kind: 'overlay', overlay: { kind: 'app', repoId: 'o/web', pr: 13 } });
    expect(jumpFor(ref({ kind: 'preview', repoId: 'o/web' }), 'office', world)).toEqual({ kind: 'overlay', overlay: { kind: 'app', repoId: 'o/web', pr: null }, floor: 2 });
  });

  it('goes to floors and the file viewer', () => {
    expect(jumpFor(ref({ kind: 'floor', repoId: 'o/web' }), 'office', world)).toEqual({ kind: 'floor', floor: 2, repoId: 'o/web' });
    expect(jumpFor(ref({ kind: 'file', repoId: 'o/web', path: 'a.ts' }), 'pocket', world)).toEqual({ kind: 'file' });
  });

  it("falls back to GitHub for what the office doesn't show", () => {
    expect(jumpFor(ref({ kind: 'issue', repoId: 'o/web', number: 99 }), 'office', world)).toEqual({ kind: 'url', url: 'https://github.com/o/web/issues/99' });
    expect(jumpFor(ref({ kind: 'issue', repoId: 'o/web', number: 15 }), 'office', world)).toEqual({ kind: 'url', url: 'https://github.com/o/web/pull/15' });
    expect(jumpFor(ref({ kind: 'qa', repoId: 'o/web', number: 14 }), 'office', world)).toEqual({ kind: 'url', url: 'https://github.com/o/web/pull/14' });
    expect(jumpFor(ref({ kind: 'preview', repoId: 'o/web', number: 14 }), 'pocket', world)).toEqual({ kind: 'url', url: 'https://github.com/o/web/pull/14' });
  });

  // #151: a ref with a section lands on it, in the console's section (pocket mode shows a team in its Team tab).
  it.each([
    [{ kind: 'floor', repoId: 'o/web', section: 'team' }, 'team'],
    [{ kind: 'agent', agentId: 'ada', section: 'team' }, 'team'],
    [{ kind: 'floor', repoId: 'o/web', section: 'charter' }, 'charter'],
    [{ kind: 'floor', repoId: 'o/web', section: 'brief' }, 'ceo'],
  ])('lands %o on its section', (r, tab) => {
    for (const mode of ['office', 'pocket'] as const) expect(jumpFor(ref(r), mode, world)).toEqual({ kind: 'overlay', overlay: { kind: 'manager', tab, repoId: 'o/web' } });
  });

  it('has nowhere to go once the agent or floor is gone', () => {
    expect(jumpFor(ref({ kind: 'agent', agentId: 'zed' }), 'office', world)).toBeNull();
    expect(jumpFor(ref({ kind: 'floor', repoId: 'o/gone' }), 'office', world)).toBeNull();
    expect(jumpFor(ref({ kind: 'agent', agentId: 'zed', section: 'team' }), 'pocket', world)).toBeNull();
    expect(jumpFor(ref({ kind: 'floor', repoId: 'o/gone', section: 'team' }), 'pocket', world)).toBeNull();
  });
});

describe('chipInfo', () => {
  it('shows status from the office', () => {
    expect(chipInfo(ref({ kind: 'agent', agentId: 'ada' }), world)).toEqual({ icon: 'user', status: 'working · #3', tone: 'good' });
    expect(chipInfo(ref({ kind: 'issue', repoId: 'o/web', number: 13 }), world)).toEqual({ icon: 'git-merge', status: 'QA passed', tone: 'good' });
    expect(chipInfo(ref({ kind: 'issue', repoId: 'o/web', number: 16 }), world)).toEqual({ icon: 'git-merge', status: 'checks failing', tone: 'bad' });
    expect(chipInfo(ref({ kind: 'issue', repoId: 'o/web', number: 3 }), world)).toEqual({ icon: 'clipboard-list', status: 'open' });
    expect(chipInfo(ref({ kind: 'qa', repoId: 'o/web', number: 15 }), world)).toEqual({ icon: 'search', status: 'failed', tone: 'bad' });
    expect(chipInfo(ref({ kind: 'preview', repoId: 'o/web' }), world)).toEqual({ icon: 'play', status: 'running' });
    expect(chipInfo(ref({ kind: 'agent', agentId: 'zed' }), world)).toBeNull();
  });
});

describe('mentions', () => {
  it('finds the "@" or "#" being typed at the end', () => {
    expect(mentionAt('ask @Ad')).toEqual({ kind: '@', query: 'Ad', start: 4 });
    expect(mentionAt('#')).toEqual({ kind: '#', query: '', start: 0 });
    expect(mentionAt('mail a@b')).toBeNull();
    expect(mentionAt('@Ada ')).toBeNull();
  });

  it('offers agents (never the CEO) and the floor\'s open issues and PRs', () => {
    expect(mentionPicks({ kind: '@', query: '' }, world, 2)).toEqual([{ label: '@Ada', hint: 'floor 2 · working', insert: '@Ada ' }]);
    expect(mentionPicks({ kind: '#', query: '1' }, world, 0).map((p) => p.insert)).toEqual(['floor 2 #13 ', 'floor 2 #16 ']);
    expect(mentionPicks({ kind: '#', query: 'dark' }, world, 2)).toEqual([{ label: '#3 Dark mode', hint: 'issue · floor 2', insert: 'floor 2 #3 ' }]);
  });
});

describe('file previews', () => {
  const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
  it('shows the lines around the line, else the first ones', () => {
    expect(fileWindow(text, 10, 4)).toEqual({ from: 8, lines: ['line 8', 'line 9', 'line 10', 'line 11'] });
    expect(fileWindow(text, null, 2)).toEqual({ from: 1, lines: ['line 1', 'line 2'] });
    expect(fileWindow(text, 20, 4).from).toBe(17);
  });

  it('colours keywords, strings, numbers and comments', () => {
    expect(codeTokens("const a = 'x'; // hi", 'a.ts')).toEqual([{ text: 'const', kind: 'kw' }, { text: ' a = ' }, { text: "'x'", kind: 'str' }, { text: '; ' }, { text: '// hi', kind: 'com' }]);
    expect(codeTokens('# title 2', 'README.md')).toEqual([{ text: '# title ' }, { text: '2', kind: 'num' }]);
    expect(codeTokens('x = 1 # note', 'a.py')).toEqual([{ text: 'x = ' }, { text: '1', kind: 'num' }, { text: ' ' }, { text: '# note', kind: 'com' }]);
  });
});
