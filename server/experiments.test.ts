import { describe, expect, it } from 'vitest';
import { Lab, loadLab, type LabState } from './experiments.ts';
import { experimentInput } from './ceo.ts';
import { sampleLab } from './experimentSample.ts';
import type { CostSession } from '../shared/costs.ts';
import type { PullInfo } from '../shared/types.ts';

const lab = () => {
  const st: LabState = loadLab(undefined, Date.now());
  let saves = 0;
  const l = new Lab(() => st, { save: () => saves++, emit: () => undefined, floorOk: (id) => id === 'o/one' || id === 'o/two' });
  return { l, st, saves: () => saves };
};

const line = (over: Partial<CostSession>): CostSession => ({
  type: 'session', at: Date.now(), ms: 1, repoId: 'o/one', agentId: 'a1', agent: 'Ada', kind: 'issue', issue: 5, pr: null, round: null, model: 'm', effort: 'medium', usd: 1, tokens: null, outcome: 'pr', ...over,
});

const pull = (over: Partial<PullInfo>): PullInfo =>
  ({ number: 40, title: 't', url: '', headRefName: 'b', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: null, closesIssues: [5], createdAt: '', mergedAt: null, additions: 30, deletions: 10, checks: 'passing', headSha: 's', mergeState: 'CLEAN', failedChecks: [], pendingChecks: [], ...over }) as PullInfo;

describe('the lab', () => {
  it('starts with the starter experiments as drafts, and gives no issue a variant until one runs', () => {
    const { l, st } = lab();
    expect(st.experiments).toHaveLength(5);
    expect(l.assign('o/one', { number: 5, body: '', labels: [] })).toBeNull();
    expect(l.practice('o/one', 5, null, 'issue').tag).toBeNull();
  });

  it('runs an issue on its variant, follows it to its PR, and stopping returns new issues to the defaults', () => {
    const { l, st } = lab();
    l.act('test-first', 'start');
    const a = l.assign('o/one', { number: 5, body: '', labels: [] })!;
    expect(l.assign('o/one', { number: 5, body: '', labels: [] })).toBe(a); // an issue keeps its variant
    const p = l.practice('o/one', 5, null, 'issue');
    expect(p.tag).toBe(`test-first/${a.variantId}`);
    expect(p.prompt !== '').toBe(a.variantId === 'b');

    l.pulls('o/one', [pull({})]);
    expect(a.pr).toBe(40);
    expect(l.practice('o/one', null, 40, 'qa').tag).toBe(p.tag); // QA and fixes of its PR stay on it
    l.session(line({ exp: p.tag! }));
    l.session(line({ kind: 'qa', pr: 40, round: 1, outcome: 'qa-pass', usd: 0.5, exp: p.tag! }));
    l.session(line({ issue: 6, usd: 9, exp: p.tag! })); // another issue's session
    expect(a.outcome).toMatchObject({ usd: 1.5, sessions: 2, qaRounds: 1, firstPass: true });
    l.pulls('o/one', [pull({ state: 'MERGED', mergedAt: new Date().toISOString() })]);
    expect(a.outcome.diff).toBe(40);
    expect(l.survivalDue(Date.now())).toEqual([{ repoId: 'o/one', since: a.outcome.mergedAt }]);

    l.act('test-first', 'stop');
    expect(l.practice('o/one', 5, null, 'issue')).toMatchObject({ tag: null, prompt: '' });
    expect(l.assign('o/one', { number: 7, body: '', labels: [] })).toBeNull();
    expect(st.assignments).toHaveLength(1);
    expect(l.view().tags).toEqual([]);
  });

  it('promotes only a stopped experiment, and only to one of its variants', () => {
    const { l } = lab();
    l.act('fix-effort', 'start');
    expect(() => l.act('fix-effort', 'promote', 'b')).toThrow(/Stop it/);
    l.act('fix-effort', 'stop');
    expect(() => l.act('fix-effort', 'promote', 'z')).toThrow(/Pick one/);
    l.act('fix-effort', 'promote', 'b');
    expect(l.practice('o/two', 9, null, 'fix-qa').effort).toBe('high');
    expect(l.practice('o/two', 9, null, 'issue').effort).toBeNull();
    expect(() => l.act('nope', 'start')).toThrow(/No such experiment/);
  });

  it("defines the CEO's experiments as drafts, floors by number", () => {
    const { l, st } = lab();
    const input = experimentInput({ name: 'Plans', hypothesis: 'h', floors: [2], kinds: ['issue'], variants: [{ name: 'A' }, { name: 'B', effort: 'high' }] }, (n) => (n === 2 ? 'o/two' : null));
    expect(l.defineText(input)).toMatch(/^Defined "Plans" \(x[0-9a-f]{8}\) as a draft: A A, B B\. Only the manager starts it/);
    const e = st.experiments.at(-1)!;
    expect(e).toMatchObject({ floors: ['o/two'], kinds: ['issue'], status: 'draft', by: 'ceo' });
    expect(e.variants[1].settings).toEqual({ effort: { issue: 'high' } });
    expect(() => l.defineText(input)).toThrow(/already an experiment/);
    expect(() => experimentInput({ ...input, floors: [9] } as never, () => null)).toThrow(/no floor 9/);
  });

  it("gives the demo a running experiment with results and the CEO a line about it", () => {
    const st = sampleLab([{ id: 'o/one' }, { id: 'o/two' }], Date.now());
    const l = new Lab(() => st, { save: () => undefined, emit: () => undefined, floorOk: () => true });
    const view = l.view().experiments.find((e) => e.id === 'test-first')!;
    expect(view.status).toBe('running');
    expect(view.result.variants.every((v) => v.n >= 10)).toBe(true);
    expect(l.summary()[0]).toMatch(/^Test first vs current \(running, A n=\d+ B n=\d+\): /);
  });
});
