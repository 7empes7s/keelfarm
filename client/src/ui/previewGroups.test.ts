import { describe, expect, it } from 'vitest';
import type { PreviewView, PrPreviewView, PullInfo, QaView, RepoView } from '../../../shared/types';
import type { Agent } from '../store';
import { ago, parsePreviewsHash, plainTitle, previewLists, previewsHash, previewsStats, rowMatches, statusWord, type ListInputs } from './previewGroups';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const pull = (number: number, title: string, extra: Partial<PullInfo> = {}) => ({ number, title, state: 'OPEN', createdAt: hoursAgo(1), ...extra }) as PullInfo;
const preview = (status: PreviewView['status'] = 'stopped', startedAt: number | null = null) => ({ status, startedAt, stopsAt: null }) as PreviewView;
const repo = (id: string, floor: number, pulls: PullInfo[], extra: Partial<RepoView> = {}) =>
  ({ id, floor, fullName: `acme/${id}`, defaultBranch: 'main', autoMerge: true, preview: preview(), pulls, ...extra }) as RepoView;
const agent = (id: string, name: string, repoId: string, prNumber: number | null, task: Agent['task'], status: Agent['status'] = 'working') => ({ id, name, repoId, prNumber, task, status }) as Agent;
const qa = (repoId: string, prNumber: number, status: QaView['status'], ceoLooking = false) => ({ repoId, prNumber, status, ceoLooking }) as QaView;
const prPreview = (repoId: string, pr: number, status: PrPreviewView['status'], startedAt = NOW - 5 * 60_000) => ({ repoId, pr, status, startedAt, stopsAt: null }) as PrPreviewView;

describe('statusWord', () => {
  it('says where a PR stands in plain words', () => {
    const open = { state: 'OPEN' } as const;
    expect(statusWord({ state: 'MERGED' }, undefined)).toBe('Merged');
    expect(statusWord({ state: 'CLOSED' }, undefined)).toBe('Closed');
    expect(statusWord(open, undefined)).toBe('Building');
    expect(statusWord(open, { status: 'queued', ceoLooking: false })).toBe('Testing');
    expect(statusWord(open, { status: 'testing', ceoLooking: false })).toBe('Testing');
    expect(statusWord(open, { status: 'failed', ceoLooking: false })).toBe('Being fixed');
    expect(statusWord(open, { status: 'fixing', ceoLooking: false })).toBe('Being fixed');
    expect(statusWord(open, { status: 'passed', ceoLooking: false })).toBe('Ready');
    expect(statusWord(open, { status: 'needs-human', ceoLooking: false })).toBe('Waiting for you');
    expect(statusWord(open, { status: 'needs-human', ceoLooking: true })).toBe('Testing'); // the CEO looks first
  });

  it('goes by the agent on it now before the last QA record', () => {
    expect(statusWord({ state: 'OPEN' }, { status: 'passed', ceoLooking: false }, 'qa')).toBe('Testing');
    expect(statusWord({ state: 'OPEN' }, { status: 'failed', ceoLooking: false }, 'fix')).toBe('Being fixed');
  });
});

describe('plainTitle', () => {
  it('drops commit prefixes and issue suffixes, keeping the words', () => {
    expect(plainTitle('feat(ui): Why rounds fail (#202)')).toBe('Why rounds fail');
    expect(plainTitle('fix: Esc closes the sheet')).toBe('Esc closes the sheet');
    expect(plainTitle('Previews page in the menu')).toBe('Previews page in the menu');
  });
});

describe('previewLists', () => {
  const web = repo('web', 1, [pull(202, 'Why rounds fail'), pull(203, 'Old idea', { createdAt: hoursAgo(200) }), pull(150, 'Shipped', { state: 'MERGED' })], {
    preview: preview('running', NOW - 30 * 60_000),
  });
  const api = repo('api', 2, [pull(7, 'feat: Rate limits'), pull(8, 'Retry jobs')], { autoMerge: false });
  const input: ListInputs = {
    repos: [web, api],
    agents: [agent('g', 'Grace', 'web', 202, 'qa'), agent('l', 'Linus', 'api', 8, 'issue', 'idle')],
    prPreviews: { 'api#7': prPreview('api', 7, 'running') },
    qa: { 'api#7': qa('api', 7, 'passed'), 'api#8': qa('api', 8, 'needs-human') },
    now: NOW,
    recentHours: 24,
    current: null,
  };

  it('groups by project: the live app first, then its live PRs', () => {
    const l = previewLists(input, false);
    expect(l.projects.map((p) => [p.repo.id, p.rows.map((r) => r.title)])).toEqual([
      ['web', ['Live app (main)', 'Why rounds fail']],
      ['api', ['Live app (main)', 'Rate limits', 'Retry jobs']],
    ]);
  });

  it('folds old and merged PRs under Show older, and shows them when asked', () => {
    expect(previewLists(input, false).older).toBe(2);
    const all = previewLists(input, true);
    expect(all.projects[0].rows.map((r) => r.pr)).toEqual([null, 202, 203, 150]);
    expect(all.projects[0].rows.find((r) => r.pr === 150)?.word).toBe('Merged');
    expect(all.projects[0].rows.find((r) => r.pr === 203)?.live).toBe(false);
  });

  it('keeps the selected PR in the live set', () => {
    expect(previewLists({ ...input, current: 'web:pr-203' }, false).projects[0].rows.map((r) => r.pr)).toEqual([null, 202, 203]);
  });

  it('lists running previews: main apps and PRs that are up, with when they started', () => {
    const running = previewLists(input, false).running;
    expect(running.map((r) => r.key)).toEqual(['web:main', 'api:pr-7']);
    expect(running[0].startedAt).toBe(NOW - 30 * 60_000);
  });

  it('lists agents on a PR with what they do, never idle ones', () => {
    expect(previewLists(input, false).agents.map((a) => [a.name, a.doing, a.row.title, a.row.word])).toEqual([['Grace', 'testing PR #202', 'Why rounds fail', 'Testing']]);
  });

  it('lists PRs newest first with their status words and who must act', () => {
    const prs = previewLists(input, false).prs;
    expect(prs.map((r) => [r.pr, r.word, r.needsYou, r.mine])).toEqual([
      [202, 'Testing', false, false],
      [8, 'Waiting for you', true, false],
      [7, 'Ready', false, true], // passed on a floor that doesn't merge by itself
    ]);
  });

  it('filters by the chips and the words typed', () => {
    const rows = previewLists(input, false).projects.flatMap((p) => p.rows);
    const keys = (f: Parameters<typeof rowMatches>[1], q = '') => rows.filter((r) => rowMatches(r, f, q)).map((r) => r.key);
    expect(keys(new Set(['running']))).toEqual(['web:main', 'api:pr-7']);
    expect(keys(new Set(['needs']))).toEqual(['api:pr-8']);
    expect(keys(new Set(['mine']))).toEqual(['api:pr-7']);
    expect(keys(new Set(), 'rounds')).toEqual(['web:pr-202']);
    expect(keys(new Set(), 'api #8')).toEqual(['api:pr-8']);
    expect(keys(new Set(['running']), 'web live')).toEqual(['web:main']);
  });
});

describe('the stats bar', () => {
  it('counts PR slots, live apps and the last start', () => {
    const s = previewsStats([{ preview: preview('running', 100) }, { preview: preview('stopped') }], { a: { status: 'starting', startedAt: 300 }, b: { status: 'error', startedAt: 500 } });
    expect(s).toEqual({ used: 1, slots: 2, mainUp: 1, lastStarted: 300 });
    expect(previewsStats([], {}).lastStarted).toBeNull();
  });

  it('says how long ago in minutes and hours', () => {
    expect(ago(NOW - 20_000, NOW)).toBe('just now');
    expect(ago(NOW - 12 * 60_000, NOW)).toBe('12 min');
    expect(ago(NOW - 125 * 60_000, NOW)).toBe('2 h 5 min');
    expect(ago(NOW - 120 * 60_000, NOW)).toBe('2 h');
  });
});

describe('the deep link', () => {
  it('reads #previews/<floor>/<main|pr-N>', () => {
    expect(parsePreviewsHash('#previews/3/pr-12')).toEqual({ floor: 3, pr: 12 });
    expect(parsePreviewsHash('#previews/3/main')).toEqual({ floor: 3, pr: null });
    expect(parsePreviewsHash('#previews')).toEqual({ floor: null, pr: null });
    expect(parsePreviewsHash('#settings/voice')).toBeNull();
    expect(parsePreviewsHash('')).toBeNull();
  });

  it('writes the same links back', () => {
    expect(previewsHash(3, 12)).toBe('#previews/3/pr-12');
    expect(previewsHash(3, null)).toBe('#previews/3/main');
    expect(previewsHash(null, null)).toBe('#previews');
    expect(parsePreviewsHash(previewsHash(4, 9))).toEqual({ floor: 4, pr: 9 });
  });
});
