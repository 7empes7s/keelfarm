// The QA session's report: the JSON schema it answers in and the parser that reads it back from the session's result
// (structured output, or the last ```json block of a terminal agent's message).

import type { QaCheck } from '../shared/types.ts';
import type { SessionResult } from './agentRunner.ts';
import { LAB_PROBLEM_TEXT } from './testLab.ts';

export interface QaReport {
  /** lab-error: the test lab failed (watchdog, no browser, OOM, a busy port), so the PR couldn't be judged (#189). */
  verdict: 'pass' | 'fail' | 'lab-error';
  summary: string;
  checks: QaCheck[];
  commands: { command: string; result: string }[];
  screenshots: string[];
  fixInstructions?: string;
  /** The charter check (#48): "ok …" or "violation: …"; a violation fails the PR. */
  charterCheck?: string;
}

export const QA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'checks', 'commands', 'screenshots'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail', 'lab-error'], description: 'pass only if the change works and meets the issue requirements; lab-error only if the lab itself failed (LAB ERROR) and you could not judge it' },
    summary: { type: 'string', description: 'Two to four sentences for the pull request comment.' },
    checks: {
      type: 'array',
      description: 'Each acceptance criterion, test run or scenario you verified.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'result', 'details'],
        properties: {
          name: { type: 'string' },
          result: { type: 'string', enum: ['pass', 'fail', 'skip'] },
          details: { type: 'string', description: 'What you did and what you observed.' },
        },
      },
    },
    commands: {
      type: 'array',
      description: 'Test suites, linters, builds and other commands you ran.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'result'],
        properties: { command: { type: 'string' }, result: { type: 'string', description: 'e.g. "42 passed, 0 failed"' } },
      },
    },
    screenshots: {
      type: 'array',
      description: 'One short caption per screenshot you took with browser_take_screenshot, in the order you took them.',
      items: { type: 'string' },
    },
    fixInstructions: { type: 'string', description: 'When the verdict is fail: precise, actionable instructions for the developer.' },
    charterCheck: { type: 'string', description: 'When the project has a charter: one line, "ok" or "violation: <the standard broken>", on its standards and the issue\'s objective.' },
  },
};

/** The charter check: the report's field, else a "Charter check: …" line in the agent's message. */
function charterCheckOf(field: unknown, text: string | undefined): string | undefined {
  const line = typeof field === 'string' && field.trim() ? field : text?.match(/^\W*charter check\W*:?\s*(.+)$/im)?.[1];
  return line ? line.trim().slice(0, 300) : undefined;
}

const charterViolation = (check: string | undefined) => !!check && /^\W*violat/i.test(check);

/** A fail whose every failed check is the lab's problem (a run the watchdog stopped, no browser, OOM, a busy port) is a lab error. */
function labFailure(checks: readonly QaCheck[]): boolean {
  const failed = checks.filter((c) => c.result === 'fail');
  return failed.length > 0 && failed.every((c) => LAB_PROBLEM_TEXT.test(`${c.name} ${c.details}`));
}

export function parseReport(result: SessionResult): QaReport | null {
  let raw: unknown = result.structured;
  if (!raw && result.text) {
    // Terminal agents end their last message with the report, usually in a ```json block.
    const fenced = [...result.text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)].map((m) => m[1]).reverse();
    for (const json of [...fenced, result.text.match(/\{[\s\S]*\}/)?.[0]].filter((j): j is string => !!j)) {
      try {
        raw = JSON.parse(json);
        break;
      } catch {
        raw = null;
      }
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<QaReport>;
  if (r.verdict !== 'pass' && r.verdict !== 'fail' && r.verdict !== 'lab-error') return null;
  const charterCheck = charterCheckOf(r.charterCheck, result.text);
  const broken = charterViolation(charterCheck);
  const checks: QaCheck[] = Array.isArray(r.checks) ? r.checks.map((c) => ({ name: String(c.name ?? ''), result: c.result === 'fail' ? 'fail' : c.result === 'skip' ? 'skip' : 'pass', details: String(c.details ?? '') })) : [];
  // On the PR comment and in the QA panel with the other checks; a broken standard fails the PR whatever the verdict said.
  if (charterCheck) checks.push({ name: 'Charter check', result: broken ? 'fail' : 'pass', details: charterCheck });
  const fixInstructions = r.fixInstructions ? String(r.fixInstructions) : broken ? `Keep the charter's standards: ${charterCheck}` : undefined;
  return {
    verdict: broken ? 'fail' : r.verdict === 'fail' && labFailure(checks) ? 'lab-error' : r.verdict,
    summary: String(r.summary ?? ''),
    checks,
    commands: Array.isArray(r.commands) ? r.commands.map((c) => ({ command: String(c.command ?? ''), result: String(c.result ?? '') })) : [],
    screenshots: Array.isArray(r.screenshots) ? r.screenshots.map(String) : [],
    fixInstructions,
    charterCheck,
  };
}
