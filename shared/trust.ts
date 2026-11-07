// Who the office works for (#185): agents build only issues and PRs from the floor's owner, the office's own gh user,
// collaborators with write access and the floor's allow-list. Anyone else's issue waits for a trusted user's
// office-trusted label; anyone else's PR (or any fork's) is never QA'd, fixed, previewed or merged by the office.
// Pure, for the server's sync and gates and the client's Kanban.

import type { IssueInfo, PullInfo } from './types.ts';

/** The label that lets an outsider's issue in, when a trusted user added it. */
export const TRUST_LABEL = 'office-trusted';
/** GitHub's author associations that are trusted as they are. */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
export const UNTRUSTED_ISSUE = 'Untrusted: not built';
export const OUTSIDE_PR = 'From outside: review on GitHub';
export const TRUSTED_AUTHORS_MAX = 50;

export interface TrustContext {
  /** The repo's owner (a user or an organisation). */
  owner: string;
  /** The office's own gh user. */
  officeUser: string | null;
  /** Collaborators with write access. */
  writers: string[];
  /** The floor's allow-list. */
  allow: string[];
}

export function trustContext(fullName: string, officeUser: string | null, writers: string[], allow: string[] = []): TrustContext {
  return { owner: fullName.split('/')[0], officeUser, writers, allow };
}

export function trustedLogin(login: string | null | undefined, ctx: TrustContext): boolean {
  if (!login) return false;
  const l = login.toLowerCase();
  return [ctx.owner, ctx.officeUser, ...ctx.writers, ...ctx.allow].some((x) => !!x && x.toLowerCase() === l);
}

/** A trusted author's issue, or one a trusted user labelled office-trusted (anyone with triage rights can add labels). */
export function issueTrusted(i: Pick<IssueInfo, 'author' | 'authorAssociation' | 'labels' | 'trustedBy'>, ctx: TrustContext): boolean {
  if (trustedLogin(i.author, ctx) || TRUSTED_ASSOCIATIONS.has(i.authorAssociation ?? '')) return true;
  return i.labels.includes(TRUST_LABEL) && trustedLogin(i.trustedBy, ctx);
}

/** A trusted author's PR from a branch of the repo itself; a fork's never is (its code runs in QA and previews). */
export function pullTrusted(p: Pick<PullInfo, 'author' | 'isCrossRepository'>, ctx: TrustContext): boolean {
  return p.isCrossRepository === false && trustedLogin(p.author, ctx);
}

/** A sync's fresh lists with `untrusted` set on what the office must leave alone. */
export function markTrust(issues: IssueInfo[], pulls: PullInfo[], ctx: TrustContext): { issues: IssueInfo[]; pulls: PullInfo[] } {
  return {
    issues: issues.map((i) => (issueTrusted(i, ctx) ? i : { ...i, untrusted: true })),
    pulls: pulls.map((p) => (pullTrusted(p, ctx) ? p : { ...p, untrusted: true })),
  };
}

/** The floor's allow-list from the settings: GitHub logins, comma- or space-separated or a list. Throws on a bad one. */
export function cleanTrustedAuthors(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : null;
  if (!parts) throw new Error('trustedAuthors must be a list of GitHub logins');
  const out: string[] = [];
  for (const p of parts) {
    const login = String(p).trim().replace(/^@/, '');
    if (!login) continue;
    if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(login)) throw new Error(`"${clipLogin(login)}" is not a GitHub login`);
    if (!out.some((x) => x.toLowerCase() === login.toLowerCase())) out.push(login);
  }
  if (out.length > TRUSTED_AUTHORS_MAX) throw new Error(`At most ${TRUSTED_AUTHORS_MAX} trusted authors`);
  return out;
}

const clipLogin = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
