import { describe, expect, it } from 'vitest';
import { cleanTrustedAuthors, issueTrusted, markTrust, pullTrusted, trustContext, trustedLogin, TRUST_LABEL } from './trust.ts';
import type { IssueInfo, PullInfo } from './types.ts';

const ctx = trustContext('acme/app', 'office-bot', ['writer'], ['friend']);
const issue = (over: Partial<IssueInfo> = {}): IssueInfo => ({ number: 1, title: 't', body: '', url: '', labels: [], createdAt: '', author: 'stranger', authorAssociation: 'NONE', trustedBy: null, ...over });
const pull = (over: Partial<PullInfo> = {}) => ({ author: 'writer', isCrossRepository: false, ...over });

describe('trustedLogin', () => {
  it('trusts the owner, the office, write collaborators and the allow-list, whatever the case', () => {
    for (const l of ['acme', 'Office-Bot', 'writer', 'FRIEND']) expect(trustedLogin(l, ctx)).toBe(true);
    for (const l of ['stranger', '', null, undefined]) expect(trustedLogin(l, ctx)).toBe(false);
  });
});

describe('issueTrusted', () => {
  it('takes trusted authors and GitHub associations', () => {
    expect(issueTrusted(issue({ author: 'writer' }), ctx)).toBe(true);
    for (const a of ['OWNER', 'MEMBER', 'COLLABORATOR']) expect(issueTrusted(issue({ authorAssociation: a }), ctx)).toBe(true);
    for (const a of ['NONE', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', undefined]) expect(issueTrusted(issue({ authorAssociation: a }), ctx)).toBe(false);
    expect(issueTrusted(issue({ author: undefined, authorAssociation: undefined }), ctx)).toBe(false); // unknown: not trusted
  });

  it('counts the office-trusted label only when a trusted user added it', () => {
    expect(issueTrusted(issue({ labels: [TRUST_LABEL], trustedBy: 'office-bot' }), ctx)).toBe(true);
    expect(issueTrusted(issue({ labels: [TRUST_LABEL], trustedBy: 'stranger' }), ctx)).toBe(false);
    expect(issueTrusted(issue({ labels: [TRUST_LABEL], trustedBy: null }), ctx)).toBe(false);
    expect(issueTrusted(issue({ labels: [], trustedBy: 'office-bot' }), ctx)).toBe(false); // taken off since
  });
});

describe('pullTrusted', () => {
  it("never trusts a fork's PR or an untrusted author's", () => {
    expect(pullTrusted(pull(), ctx)).toBe(true);
    expect(pullTrusted(pull({ isCrossRepository: true }), ctx)).toBe(false);
    expect(pullTrusted(pull({ isCrossRepository: true, author: 'acme' }), ctx)).toBe(false);
    expect(pullTrusted(pull({ author: 'stranger' }), ctx)).toBe(false);
    expect(pullTrusted(pull({ author: null }), ctx)).toBe(false);
    expect(pullTrusted({ author: 'writer' }, ctx)).toBe(false); // fork unknown
  });
});

describe('markTrust', () => {
  it('marks only what the office must leave alone', () => {
    const { issues, pulls } = markTrust([issue({ number: 1, author: 'acme' }), issue({ number: 2 })], [pull({ isCrossRepository: true }) as PullInfo, pull() as PullInfo], ctx);
    expect(issues.map((i) => !!i.untrusted)).toEqual([false, true]);
    expect(pulls.map((p) => !!p.untrusted)).toEqual([true, false]);
  });
});

describe('cleanTrustedAuthors', () => {
  it('reads logins from a list or text, once each, and refuses bad ones', () => {
    expect(cleanTrustedAuthors('alice, @bob  Alice\ncarol-x')).toEqual(['alice', 'bob', 'carol-x']);
    expect(cleanTrustedAuthors(['dave', ''])).toEqual(['dave']);
    expect(() => cleanTrustedAuthors(['not a login!'])).toThrow(/not a GitHub login/);
    expect(() => cleanTrustedAuthors(42)).toThrow(/list of GitHub logins/);
  });
});
