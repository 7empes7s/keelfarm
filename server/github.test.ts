import { describe, expect, it } from 'vitest';
import { checkRunOf, issueOf, neverStartedCheck, readTwice } from './github.ts';

describe('readTwice', () => {
  it('tries a failed read once more', async () => {
    let calls = 0;
    const read = async () => {
      calls++;
      if (calls === 1) throw new Error('gh pr list -R failed: timed out after 60 s');
      return [1, 2];
    };
    await expect(readTwice(read, 0)).resolves.toEqual([1, 2]);
    expect(calls).toBe(2);
  });

  it('gives up with the second error', async () => {
    let calls = 0;
    const read = async () => {
      calls++;
      throw new Error(`failure ${calls}`);
    };
    await expect(readTwice(read, 0)).rejects.toThrow('failure 2');
    expect(calls).toBe(2);
  });
});

describe('checkRunOf', () => {
  const run = (startedAt: string, completedAt: string | undefined, status = 'COMPLETED') => ({ name: 'build', status, conclusion: completedAt ? 'SUCCESS' : '', startedAt, completedAt });

  it('times the check runs from the first start to the last finish', () => {
    expect(checkRunOf([run('2026-10-04T17:38:00Z', '2026-10-04T17:38:42Z'), run('2026-10-04T17:38:08Z', '2026-10-04T17:41:01Z')])).toEqual({
      ms: (3 * 60 + 1) * 1000,
      doneAt: Date.parse('2026-10-04T17:41:01Z'),
    });
  });

  it('has nothing while a check still runs, without times, or without checks', () => {
    expect(checkRunOf([run('2026-10-04T17:38:00Z', '2026-10-04T17:38:42Z'), run('2026-10-04T17:38:08Z', undefined, 'IN_PROGRESS')])).toBeNull();
    expect(checkRunOf([{ context: 'Vercel', state: 'SUCCESS' }])).toBeNull();
    expect(checkRunOf([])).toBeNull();
    expect(checkRunOf(null)).toBeNull();
  });
});

describe('neverStartedCheck (#191)', () => {
  const run = (startedAt: string, completedAt: string, conclusion = 'FAILURE') => ({ name: 'build', status: 'COMPLETED', conclusion, startedAt, completedAt });

  it('a run GitHub ended within seconds, or failed to start, never started', () => {
    expect(neverStartedCheck(run('2026-11-01T10:00:00Z', '2026-11-01T10:00:02Z'))).toBe(true);
    expect(neverStartedCheck({ name: 'build', status: 'COMPLETED', conclusion: 'STARTUP_FAILURE' })).toBe(true);
  });

  it('a run that ran, or a commit status without times, did', () => {
    expect(neverStartedCheck(run('2026-11-01T10:00:00Z', '2026-11-01T10:00:40Z'))).toBe(false);
    expect(neverStartedCheck({ context: 'Vercel', state: 'FAILURE' })).toBe(false);
  });
});

describe('issueOf', () => {
  it('reads the author and who last added the office-trusted label (#185)', () => {
    const labelled = (label: string, actor: string | null) => ({ label: { name: label }, actor: actor ? { login: actor } : null });
    const i = issueOf({
      number: 7,
      title: 'Hi',
      body: null,
      url: 'u',
      createdAt: 'c',
      author: { login: 'stranger' },
      authorAssociation: 'NONE',
      labels: { nodes: [{ name: 'office-trusted' }] },
      timelineItems: { nodes: [labelled('office-trusted', 'owner'), labelled('bug', 'x'), null, labelled('office-trusted', 'stranger')] },
    });
    expect(i).toMatchObject({ number: 7, body: '', labels: ['office-trusted'], author: 'stranger', authorAssociation: 'NONE', trustedBy: 'stranger' });
    expect(issueOf({ ...i, body: '', author: null, labels: null, timelineItems: null } as never)).toMatchObject({ author: null, labels: [], trustedBy: null });
  });
});
