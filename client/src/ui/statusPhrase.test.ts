import { describe, expect, it } from 'vitest';
import { agentPhrase, cardPhrase } from './statusPhrase';

const agent = { status: 'idle' as const, task: null, issueNumber: null, prNumber: null };
const pr = { isDraft: false, mergeable: 'MERGEABLE', checks: 'passing' as const };
const names = (id: string | null) => ({ m: 'Margaret', d: 'Dev' })[id ?? ''];

describe('status phrases', () => {
  it("say when the answer to their question reached them, until they ask again (#508)", () => {
    const at = new Date(2026, 10, 11, 17, 12).getTime();
    const working = { ...agent, status: 'working' as const, task: 'issue' as const, issueNumber: 12 };
    expect(agentPhrase({ ...working, answered: at })).toBe('Building #12 · opens a PR, then QA tests it · Answer delivered 17:12');
    expect(agentPhrase({ ...working, answered: at, waiting: 'manager' })).not.toContain('Answer delivered');
  });

  it('say what an agent does and what happens next', () => {
    expect(agentPhrase(agent, { autoAssign: true })).toBe('Free · gets the next ready issue by itself');
    expect(agentPhrase(agent)).toBe('Free · waiting for you to hand them work');
    expect(agentPhrase({ ...agent, status: 'working', task: 'issue', issueNumber: 12 })).toBe('Building #12 · opens a PR, then QA tests it');
    expect(agentPhrase({ ...agent, status: 'working', task: 'qa', prNumber: 3 })).toBe('Testing PR #3 · the verdict goes on the PR');
    expect(agentPhrase({ ...agent, status: 'working', task: 'fix', prNumber: 3 })).toBe('Fixing PR #3 · goes back to QA after');
    expect(agentPhrase({ ...agent, status: 'done', task: 'issue', prNumber: 5 })).toBe('Free · opened PR #5, QA tests it next');
    expect(agentPhrase({ ...agent, status: 'done' })).toBe('Free · finished, ready for the next task');
    expect(agentPhrase({ ...agent, status: 'error' })).toContain('Needs help');
    expect(agentPhrase({ ...agent, name: 'Ada', status: 'working', blocked: 'a prompt' })).toBe("Needs you: answer the prompt in Ada's terminal · the office tells you if it lasts 5 minutes");
    expect(agentPhrase({ ...agent, status: 'working', reviewedBy: 'Mimoun' })).toBe('Mimoun is reviewing your change · they decide if this work goes on'); // #207
    expect(agentPhrase({ ...agent, status: 'done', reviewedBy: 'Mimoun' })).not.toContain('reviewing');
    expect(agentPhrase({ ...agent, name: 'Ada', status: 'done', waiting: 'manager' })).toBe("Needs you: answer Ada's question · in the chat, then they carry on");
  });

  it('say where a card stands and what happens next', () => {
    const qa = (status: string, over = {}) => ({ status, qaAgentId: 'm', devAgentId: 'd', ceoLooking: false, ...over }) as never;
    expect(cardPhrase(qa('testing'), pr, true, names)).toBe('In QA with Margaret · merges by itself when green');
    expect(cardPhrase(qa('testing'), pr, false, names)).toBe('In QA with Margaret · then it waits for your merge');
    expect(cardPhrase(qa('failed'), pr, true, names)).toBe('QA found problems · back to Dev for a fix');
    expect(cardPhrase(qa('passed'), pr, false, names)).toBe('Passed QA · waiting for you to merge');
    expect(cardPhrase(qa('passed'), { ...pr, mergeable: 'CONFLICTING' }, true, names)).toContain('conflicts');
    expect(cardPhrase(qa('needs-human', { ceoLooking: true }), pr, true, names)).toBe('Stuck · the CEO looks first, then asks you');
    expect(cardPhrase(qa('needs-human'), pr, true, names)).toContain('Needs you');
    expect(cardPhrase(null, { ...pr, isDraft: true }, true)).toContain('Draft');
    expect(cardPhrase(null, pr, true)).toBe('Not tested yet · goes to QA next, merges by itself when green');
  });
});
