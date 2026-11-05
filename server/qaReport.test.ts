import { describe, expect, it } from 'vitest';
import { parseReport, QA_SCHEMA } from './qaReport.ts';

const result = (o: { structured?: unknown; text?: string }) => ({ ok: true, text: o.text ?? '', costUsd: 0, turns: 1, errors: [], structured: o.structured });
const report = (o: Record<string, unknown> = {}) => ({ verdict: 'pass', summary: 'Works.', checks: [{ name: 'Tests', result: 'pass', details: '12 passed' }], commands: [], screenshots: [], ...o });

describe("QA's charter check (#48)", () => {
  it('is in the schema QA answers in', () => {
    expect((QA_SCHEMA.properties as Record<string, unknown>).charterCheck).toBeDefined();
  });

  it('becomes a passing check when the PR keeps the charter', () => {
    const r = parseReport(result({ structured: report({ charterCheck: 'ok: serves O2, keeps every standard' }) }))!;
    expect(r.verdict).toBe('pass');
    expect(r.charterCheck).toBe('ok: serves O2, keeps every standard');
    expect(r.checks.at(-1)).toEqual({ name: 'Charter check', result: 'pass', details: 'ok: serves O2, keeps every standard' });
  });

  it('fails the PR on a standards violation, whatever the verdict said', () => {
    const r = parseReport(result({ structured: report({ charterCheck: 'violation: no tests for the new store logic' }) }))!;
    expect(r.verdict).toBe('fail');
    expect(r.checks.at(-1)).toMatchObject({ name: 'Charter check', result: 'fail' });
    expect(r.fixInstructions).toBe("Keep the charter's standards: violation: no tests for the new store logic");
  });

  it('reads a "Charter check:" line from a terminal agent\'s message', () => {
    const text = 'Done.\n**Charter check:** Violation: it adds accounts, a non-goal\n```json\n' + JSON.stringify(report()) + '\n```';
    const r = parseReport(result({ text }))!;
    expect(r.verdict).toBe('fail');
    expect(r.charterCheck).toBe('Violation: it adds accounts, a non-goal');
  });

  it('adds nothing when there is no charter check', () => {
    const r = parseReport(result({ structured: report() }))!;
    expect(r).toMatchObject({ verdict: 'pass', charterCheck: undefined, fixInstructions: undefined });
    expect(r.checks).toHaveLength(1);
  });
});
