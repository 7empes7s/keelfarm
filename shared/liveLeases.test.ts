import { describe, expect, it } from 'vitest';
import { diffNames, dueDiffs, mainNudges, nudgeNote, pairNudges, type LiveAgent } from './liveLeases';
import { floorLeases, PRACTICES_OFF, cleanOverrides } from './practices';

describe('live leases (#398)', () => {
  it('real-diff files win over predicted ones in leases, and declared ones stay', () => {
    const work = { agentId: 'a1', issue: 7, pr: null, declared: null, predicted: ['README.md'] };
    expect(floorLeases([{ ...work, real: ['server/swarm/core.ts', 'shared/x.ts'] }], [])).toEqual([{ issue: 7, pr: null, agentId: 'a1', files: ['server/swarm/core.ts', 'shared/x.ts'], source: 'diff' }]);
    expect(floorLeases([{ ...work, declared: ['docs/'], real: ['a.ts'] }], [])[0]).toMatchObject({ files: ['docs/', 'a.ts'], source: 'diff' });
  });

  it('with no real diff (liveLeases off), leases are exactly as before', () => {
    const work = { agentId: 'a1', issue: 7, pr: null, declared: null, predicted: ['README.md'] };
    const before = floorLeases([work], []);
    expect(floorLeases([{ ...work, real: null }], [])).toEqual(before);
    expect(floorLeases([{ ...work, real: [] }], [])).toEqual(before);
    expect(before[0].source).toBe('predicted');
  });

  it('reads git output into lease paths', () => {
    expect(diffNames('server/a.ts\nclient\\b.tsx\n\n', 'new.ts\nserver/a.ts\n')).toEqual(['server/a.ts', 'client/b.tsx', 'new.ts']);
  });

  it('reads only busy, local agents with the switch on, throttled', () => {
    const a = (id: string, o: Partial<LiveAgent> = {}): LiveAgent => ({ id, busy: true, on: true, local: true, ...o });
    const last = new Map([['b', 1_000]]);
    expect(dueDiffs([a('a'), a('b'), a('c', { busy: false }), a('d', { on: false }), a('e', { local: false })], last, 61_000, 60_000)).toEqual(['a', 'b']);
    expect(dueDiffs([a('b')], last, 30_000, 60_000)).toEqual([]);
  });

  it('flags a branch main moved onto and ignores a clean one, once per agent per main SHA, none during QA', () => {
    const branches = [
      { agentId: 'ada', files: ['server/swarm/core.ts', 'a.ts'], mainFiles: ['server/swarm/core.ts', 'z.ts'], inQa: false },
      { agentId: 'bo', files: ['client/x.tsx'], mainFiles: ['server/swarm/core.ts'], inQa: false },
      { agentId: 'cy', files: ['z.ts'], mainFiles: ['z.ts'], inQa: true },
      { agentId: 'di', files: ['z.ts'], mainFiles: null, inQa: false },
    ];
    expect(mainNudges(branches, 'sha1', new Map())).toEqual([{ agentId: 'ada', files: ['server/swarm/core.ts'] }]);
    expect(mainNudges(branches, 'sha1', new Map([['ada', 'sha1']]))).toEqual([]);
    expect(mainNudges(branches, 'sha2', new Map([['ada', 'sha1']]))).toEqual([{ agentId: 'ada', files: ['server/swarm/core.ts'] }]);
  });

  it('nudges the later starter of two agents on one file, once, and only before either has a PR', () => {
    const work = [
      { agentId: 'early', startedAt: 100, files: ['shared/types.ts', 'a.ts'], pr: null },
      { agentId: 'late', startedAt: 200, files: ['shared/types.ts'], pr: null },
      { agentId: 'solo', startedAt: 300, files: ['b.ts'], pr: null },
    ];
    const got = pairNudges(work, new Set());
    expect(got).toEqual([{ agentId: 'late', others: ['early'], files: ['shared/types.ts'], keys: ['late>early'] }]);
    expect(pairNudges(work, new Set(['late>early']))).toEqual([]);
    expect(pairNudges([work[0], { ...work[1], pr: 12 }], new Set())).toEqual([]);
  });

  it('says what the agent was told in a few words', () => {
    expect(nudgeNote('main', ['server/swarm/core.ts'])).toBe('Told to merge main: server/swarm/core.ts');
    expect(nudgeNote('pair', ['a.ts', 'b.ts', 'c.ts', 'd.ts'], 'Ada')).toBe('Shares a.ts, b.ts, c.ts and 1 more with Ada');
  });

  it('is a practice switch, off by default', () => {
    expect(PRACTICES_OFF.liveLeases).toBe(false);
    expect(cleanOverrides({ liveLeases: true })).toEqual({ liveLeases: true });
  });
});
