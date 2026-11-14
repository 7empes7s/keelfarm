import { describe, expect, it } from 'vitest';
import type { CostRecord } from '../shared/costs.ts';
import { dayKey } from '../shared/journal.ts';
import type { UsageSource } from '../shared/types.ts';
import type { SpendDay } from '../shared/earnings.ts';
import { providerSpend, rollSpend } from './earnings.ts';
import type { OfficeTools } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// Earnings vs. spend (#666): the spend rollup and company_status's earnings block.

const NOW = new Date(2026, 10, 12, 12).getTime();
const at = (d: number, h = 10) => new Date(2026, 10, d, h).getTime();
const session = (t: number, repoId: string, kind: 'build' | 'ceo-chat', usd: number) => ({ type: 'session', at: t, ms: 1, repoId, agentId: 'a', agent: 'Ada', kind, issue: null, pr: null, round: null, model: '', effort: '', usd, tokens: null }) as CostRecord;
const source = (o: Partial<UsageSource>): UsageSource => ({ id: 'x', provider: 'elevenlabs', category: 'audio', label: 'ElevenLabs', plan: '', windows: [], status: 'ready', checkedAt: 1, ...o });

describe('rollSpend', () => {
  it("counts the ledger's days by floor (the CEO as ''), keeps older days and sets today's providers", () => {
    const old: Record<string, SpendDay> = { [dayKey(at(1))]: { claude: { r1: 9 }, providers: {} }, [dayKey(at(10))]: { claude: { r1: 999 }, providers: { X: 1 } } };
    const out = rollSpend(old, [session(at(10), 'r1', 'build', 2), session(at(10, 15), 'r1', 'build', 1.5), session(at(11), '', 'ceo-chat', 4)], { ElevenLabs: 0.5 }, NOW);
    expect(out[dayKey(at(1))]).toEqual({ claude: { r1: 9 }, providers: {} }); // before the ledger's first line: the rollup stands
    expect(out[dayKey(at(10))]).toEqual({ claude: { r1: 3.5 }, providers: { X: 1 } });
    expect(out[dayKey(at(11))]).toEqual({ claude: { '': 4 }, providers: {} });
    expect(out[dayKey(NOW)]).toEqual({ claude: {}, providers: { ElevenLabs: 0.5 } });
  });

  it('drops days older than the card shows', () => {
    const out = rollSpend({ '2026-01-01': { claude: { r1: 1 }, providers: {} } }, [], {}, NOW);
    expect(out['2026-01-01']).toBeUndefined();
  });
});

describe('providerSpend', () => {
  it("takes providers' 7-day reports per day, leaving out what the ledger counts already", () => {
    expect(providerSpend([source({ spendUsd7d: 7 }), source({ label: 'Claude Max', category: 'coding', spendUsd7d: 70 }), source({ label: 'Anthropic API', provider: 'anthropic', category: 'text', spendUsd7d: 70 }), source({ label: 'Gemini', provider: 'gemini' })])).toEqual({ ElevenLabs: 1 });
  });
});

describe('company_status', () => {
  type Internals = { ensureCeo(interrupted: unknown[]): void; officeTools(): OfficeTools };

  it('has the earnings block the CEO plans against', async () => {
    const swarm = new Swarm(createDemoBackend());
    await swarm.connectRepo('demo-co/pixel-todo', {});
    const internals = swarm as unknown as Internals;
    internals.ensureCeo([]);
    swarm.addFixedCost({ label: 'Server', usdPerMonth: 30 });
    swarm.addEarning({ usd: 1000, source: 'Sponsor' });
    const status = JSON.parse(await internals.officeTools().call('company_status', {})) as { company: { earnings: { weekEarnings: number; weekSpend: number; profit: number } } };
    const e = status.company.earnings;
    expect(e.weekEarnings).toBe(1000);
    expect(e.weekSpend).toBeGreaterThan(0); // the server's share of every day so far
    expect(e.profit).toBeCloseTo(e.weekEarnings - e.weekSpend, 2);
  });
});
