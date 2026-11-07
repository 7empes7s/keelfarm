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

describe("QA's cause for a fail (#188)", () => {
  it('is in the schema and read back on a fail only', () => {
    expect((QA_SCHEMA.properties as Record<string, { enum?: string[] }>).cause.enum).toEqual(expect.arrayContaining(['bug', 'nit', 'spec-missing', 'lab-error', 'outage']));
    expect(parseReport(result({ structured: report({ verdict: 'fail', cause: 'nit' }) }))!.cause).toBe('nit');
    expect(parseReport(result({ structured: report({ verdict: 'pass', cause: 'nit' }) }))!.cause).toBeUndefined();
    expect(parseReport(result({ structured: report({ verdict: 'fail', cause: 'typo' }) }))!.cause).toBeUndefined();
  });
});

describe('lab errors (#189)', () => {
  it('is a verdict QA can give', () => {
    expect((QA_SCHEMA.properties as { verdict: { enum: string[] } }).verdict.enum).toContain('lab-error');
    expect(parseReport(result({ structured: report({ verdict: 'lab-error', summary: 'No browser.' }) }))!.verdict).toBe('lab-error');
  });

  it('turns a fail whose only failures are the lab into a lab error: a watchdog-aborted run is not a failed round', () => {
    const checks = [
      { name: 'Unit tests', result: 'pass', details: '210 passed' },
      { name: 'e2e overflow.spec.ts', result: 'fail', details: 'lab_run went silent for 300 s and was aborted, twice' },
    ];
    expect(parseReport(result({ structured: report({ verdict: 'fail', checks }) }))!.verdict).toBe('lab-error');
    const missing = [{ name: 'e2e guard', result: 'fail', details: "the lab has no Playwright browser: Executable doesn't exist" }];
    expect(parseReport(result({ structured: report({ verdict: 'fail', checks: missing }) }))!.verdict).toBe('lab-error');
  });

  it('keeps a real failure a fail, even next to a lab problem, and a charter violation too', () => {
    const checks = [
      { name: 'e2e', result: 'fail', details: 'LAB ERROR (silent)' },
      { name: 'Pocket mode at 390 px', result: 'fail', details: 'the sheet is cut off' },
    ];
    expect(parseReport(result({ structured: report({ verdict: 'fail', checks }) }))!.verdict).toBe('fail');
    expect(parseReport(result({ structured: report({ verdict: 'fail', checks: [] }) }))!.verdict).toBe('fail');
    const lab = [{ name: 'e2e', result: 'fail', details: 'LAB ERROR (oom)' }];
    expect(parseReport(result({ structured: report({ verdict: 'fail', checks: lab, charterCheck: 'violation: no test' }) }))!.verdict).toBe('fail');
  });
});
