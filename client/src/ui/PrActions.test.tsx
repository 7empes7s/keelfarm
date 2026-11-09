import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PullInfo, QaView, RepoView } from '../../../shared/types';
import { PrActions } from './PrActions';

// Rendering the controls needs no browser store; actions are exercised in the demo browser.
vi.mock('../store', () => ({ useStore: () => () => {} }));

const repo = { id: 'demo/repo', autoMerge: false } as RepoView;
const pr = { number: 12, title: 'Fix the phone', state: 'OPEN', checks: 'passing', failedChecks: [] } as unknown as PullInfo;
const qa: QaView = { repoId: repo.id, prNumber: pr.number, summary: null, commentUrl: null, mergeNote: null, ceoLooking: false, updatedAt: 0, status: 'needs-human', checks: [], round: 1, devAgentId: 'dev', qaAgentId: 'tester' };

describe('PR controls shared by both detail pages', () => {
  it('shows the recommended override as primary, keeps Close behind More and disables draft merging', () => {
    const html = renderToStaticMarkup(<PrActions repo={repo} qa={qa} pr={{ ...pr, isDraft: true }} />);
    expect(html).toMatch(/class="btn btn-good"[^>]*>Retry QA/);
    expect(html).toContain('Send back');
    expect(html).toMatch(/disabled=""[^>]*>Merge anyway/);
    expect(html).toContain('More for PR #12');
    expect(html).not.toContain('>Close PR');
  });
  it.each(['testing', 'fixing'] as const)('only links to the working agent while %s', (status) => {
    const html = renderToStaticMarkup(<PrActions repo={repo} qa={{ ...qa, status }} pr={pr} />);
    expect(html).toContain('>Terminal</button>');
    expect(html).not.toContain('Retry QA');
    expect(html).not.toContain('More for PR');
  });
  it('has no controls for a merged PR', () => {
    expect(renderToStaticMarkup(<PrActions repo={repo} qa={qa} pr={{ ...pr, state: 'MERGED' }} />)).toBe('');
  });
});
