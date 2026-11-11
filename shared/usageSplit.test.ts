import { describe, expect, it } from 'vitest';
import type { CostSession } from './costs.ts';
import { usageSplit } from './usageSplit.ts';

const NOW = Date.UTC(2026, 10, 11, 12);
const HOUR = 3_600_000;

const line = (p: Partial<CostSession>): CostSession => ({ type: 'session', at: NOW - HOUR, ms: 60_000, repoId: 'acme/shop', agentId: 'ada', agent: 'Ada', kind: 'issue', issue: 1, pr: null, round: null, model: 'claude-opus-5-5', effort: 'medium', usd: 1, tokens: null, outcome: 'pr', ...p });

const codex = { id: 'codex-login', builtIn: true, cli: 'codex' as const, usage: [] };
const claude = { id: 'claude-login', builtIn: true, cli: 'claude' as const, usage: [{ type: 'seven_day', pct: 40, resetsAt: NOW + 2 * 24 * HOUR, at: NOW }] };

describe('usageSplit (#409)', () => {
  it("splits only the account's own sessions in its window by floor, agent and kind, with the top tasks", () => {
    const lines = [
      line({ account: 'codex-login', usd: 3, pr: 7 }),
      line({ account: 'codex-login', usd: 1, kind: 'qa', issue: 1, pr: 7, agentId: 'bo', agent: 'Bo' }),
      line({ account: 'codex-login', usd: 2, repoId: 'acme/api', issue: 9 }),
      line({ account: 'codex-login', usd: 2, repoId: '', kind: 'ceo-chat', issue: null, agentId: 'ceo', agent: 'Mimoun' }),
      line({ account: 'claude-login', usd: 50 }), // another account's
      line({ account: 'codex-login', usd: 50, at: NOW - 8 * 24 * HOUR }), // before the window
    ];
    const s = usageSplit(lines, codex, NOW)!;
    expect(s).toMatchObject({ label: 'Last 7 days', usd: 8, sessions: 4 });
    expect(s.floors.map((f) => [f.key, f.usd, f.sessions, f.pct])).toEqual([
      ['acme/shop', 4, 2, 50],
      ['', 2, 1, 25],
      ['acme/api', 2, 1, 25],
    ]);
    expect(s.agents.map((a) => [a.label, a.usd])).toEqual([
      ['Ada', 5],
      ['Mimoun', 2],
      ['Bo', 1],
    ]);
    expect(s.kinds.map((k) => k.key)).toEqual(['build', 'ceo', 'qa']);
    expect(s.tasks).toEqual([
      { repoId: 'acme/shop', issue: 1, pr: 7, usd: 4, sessions: 2 }, // the build and its QA are one task
      { repoId: 'acme/api', issue: 9, pr: null, usd: 2, sessions: 1 },
    ]);
  });

  it("counts lines from before accounts as the built-in Claude login's, over its weekly window", () => {
    const s = usageSplit([line({ usd: 2 }), line({ usd: 1, at: NOW - 6 * 24 * HOUR })], claude, NOW)!;
    expect(s).toMatchObject({ label: 'This week', usd: 2, sessions: 1, since: NOW - 5 * 24 * HOUR });
    expect(usageSplit([line({ usd: 2 })], codex, NOW)).toBeNull();
  });
});
