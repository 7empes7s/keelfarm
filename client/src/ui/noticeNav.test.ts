import { describe, expect, it } from 'vitest';
import { noticeJump, noticeStep } from './noticeNav';
import type { RefWorld } from './chatRefs';

const world: RefWorld = {
  repos: [{ id: 'r1', floor: 2, fullName: 'acme/shop', pulls: [{ number: 7, state: 'OPEN' } as never], issues: [], preview: { status: 'stopped' } as never }],
  agents: { a1: { id: 'a1', name: 'Ada', repoId: 'r1', status: 'error', issueNumber: 3, prNumber: null }, ceo: { id: 'ceo', name: 'Mo', repoId: '', status: 'idle', issueNumber: null, prNumber: null } },
  qa: {},
};

describe('noticeJump', () => {
  it('jumps to its target like a chat ref', () => {
    expect(noticeJump({ kind: 'stuck', target: { kind: 'agent', agentId: 'a1', terminal: true } }, 'pocket', world)).toEqual({ kind: 'overlay', overlay: { kind: 'terminal', agentId: 'a1', view: 'terminal' } });
  });
  it("opens a PR notice's PR page, not the preview (#407)", () => {
    const page = { kind: 'overlay', overlay: { kind: 'card', repoId: 'r1', key: 'pr-7', number: 7, pr: true }, floor: 2 };
    expect(noticeJump({ kind: 'qaFail', target: { kind: 'qa', repoId: 'r1', number: 7 } }, 'office', world)).toEqual(page);
    expect(noticeJump({ kind: 'merge', target: { kind: 'issue', repoId: 'r1', number: 7 } }, 'office', world)).toEqual(page);
    expect(noticeStep('openPr', { target: { kind: 'qa', repoId: 'r1', number: 7 } }, 'pocket', world)).toEqual({ kind: 'overlay', overlay: page.overlay });
    // a PR the board doesn't have any more is on GitHub
    expect(noticeJump({ kind: 'qaFail', target: { kind: 'qa', repoId: 'r1', number: 8 } }, 'office', world)).toEqual({ kind: 'url', url: 'https://github.com/acme/shop/pull/8' });
  });
  it("opens the chat for the CEO's and the approvals for a team change", () => {
    expect(noticeJump({ kind: 'ceo' }, 'pocket', world)).toEqual({ kind: 'chat' });
    expect(noticeJump({ kind: 'approval', target: { kind: 'floor', repoId: 'r1' }, requestId: 'q1' }, 'office', world)).toEqual({ kind: 'approvals', requestId: 'q1' });
    expect(noticeJump({ kind: 'usage' }, 'office', world)).toBeNull();
  });
  it("opens a setup gap's floor card in Floors & repos, not the 3D floor (#366)", () => {
    const setup = { kind: 'setup' as const, target: { kind: 'floor' as const, repoId: 'r1' } };
    const card = { kind: 'overlay', overlay: { kind: 'manager', tab: 'floors', repoId: 'r1' } };
    expect(noticeJump(setup, 'office', world)).toEqual(card);
    expect(noticeStep('setup', setup, 'pocket', world)).toEqual(card);
    expect(noticeStep('setup', { target: { kind: 'floor', repoId: 'gone' } }, 'office', world)).toBeNull();
  });
  it("opens the found keys' review, from the notice and its Review button (#367)", () => {
    expect(noticeJump({ kind: 'keys' }, 'pocket', world)).toEqual({ kind: 'keys' });
    expect(noticeStep('reviewKeys', {}, 'office', world)).toEqual({ kind: 'keys' });
  });
});

describe('noticeStep', () => {
  const pr = { target: { kind: 'issue' as const, repoId: 'r1', number: 7 } };
  it("maps actions to the office's own panels and calls, never a URL from the server", () => {
    expect(noticeStep('openPr', { target: { kind: 'issue', repoId: 'r1', number: 6 } }, 'office', world)).toEqual({ kind: 'url', url: 'https://github.com/acme/shop/pull/6' });
    expect(noticeStep('openQa', pr, 'pocket', world)).toEqual({ kind: 'overlay', overlay: { kind: 'app', repoId: 'r1', pr: 7, qa: true } });
    expect(noticeStep('approve', { requestId: 'q1' }, 'office', world)).toEqual({ kind: 'call', call: 'approve', requestId: 'q1' });
    expect(noticeStep('retry', { target: { kind: 'agent', agentId: 'a1' } }, 'office', world)).toEqual({ kind: 'call', call: 'reset', agentId: 'a1' });
    expect(noticeStep('retry', { target: { kind: 'agent', agentId: 'ceo' } }, 'office', world)).toEqual({ kind: 'call', call: 'ceoRetry', agentId: 'ceo' });
    expect(noticeStep('reply', {}, 'office', world)).toEqual({ kind: 'chat' });
  });
  it("is null when what it needs is gone", () => {
    expect(noticeStep('openPr', { target: { kind: 'issue', repoId: 'gone', number: 1 } }, 'office', world)).toBeNull();
    expect(noticeStep('retry', { target: { kind: 'agent', agentId: 'left' } }, 'office', world)).toBeNull();
    expect(noticeStep('approve', {}, 'office', world)).toBeNull();
  });
});
