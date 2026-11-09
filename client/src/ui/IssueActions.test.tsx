import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoView } from '../../../shared/types';
import type { Agent } from '../store';

const state = vi.hoisted(() => ({ agents: {} as Record<string, Agent> }));
vi.mock('../store', () => ({
  useStore: (select: (s: typeof state) => unknown) => select(state),
  agentsOnRepo: (all: Record<string, Agent>, repoId: string) => Object.values(all).filter((a) => a.repoId === repoId),
  isBusy: (a: Agent) => a.status === 'working' || a.status === 'preparing',
}));
import { IssueActions } from './IssueActions';

const repo = { id: 'floor', issues: [{ number: 12, title: 'Fix the phone', body: '', labels: [] }], pulls: [] } as unknown as RepoView;
afterEach(() => { state.agents = {}; });
const render = () => renderToStaticMarkup(<IssueActions repo={repo} number={12} />);

describe('issue controls rendered by CardView and the console', () => {
  it('makes Assign primary and keeps Close behind More', () => {
    state.agents = {};
    const html = render();
    expect(html).toMatch(/class="btn btn-good"[^>]*aria-label="Assign issue #12"/);
    expect(html).toContain('Assign to an agent');
    expect(html).toContain('More for issue #12');
    expect(html).not.toContain('>Close as not planned');
  });
  it('opens the current builder instead of assigning a second one', () => {
    state.agents = { dev: { id: 'dev', repoId: 'floor', role: 'dev', name: 'Ada', task: 'issue', issueNumber: 12, prNumber: null, status: 'working' } as unknown as Agent };
    const html = render();
    expect(html).toContain('>Open Ada</button>');
    expect(html).not.toContain('Assign issue');
    expect(html).toContain('More for issue #12');
  });
  it('does not offer mutations after closing', () => {
    expect(renderToStaticMarkup(<IssueActions repo={{ ...repo, issues: [] }} number={12} />)).toBe('');
  });
});
