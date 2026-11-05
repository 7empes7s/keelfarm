import { describe, expect, it } from 'vitest';
import { firstTurnTokens, officeParts, REST_LABEL, startupParts, startupRows, usageTokens } from './startup';

describe('startup context (#50)', () => {
  it("reads the first API call's input tokens from a transcript, cache included", () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { content: 'Build #7' } }),
      '{"type":"assistant", broken',
      JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 3, cache_creation_input_tokens: 20_000, cache_read_input_tokens: 12_000, output_tokens: 50 } } }),
      JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 5, cache_read_input_tokens: 40_000 } } }),
    ];
    expect(firstTurnTokens(lines.join('\n'))).toBe(32_003);
    expect(firstTurnTokens(lines.slice(0, 2).join('\n'))).toBeNull();
    expect(usageTokens({ input_tokens: 0 })).toBeNull();
    expect(usageTokens(null)).toBeNull();
  });

  it("sizes the office's texts, the playbooks and QA brief apart, only when the prompt has them", () => {
    const system = `Rules.\nEvery project's playbook:\n- Minimal diff.\nThis floor's playbook:\n${'p'.repeat(400)}`;
    expect(officeParts({ system, prompt: 'x'.repeat(80), officePlaybook: '- Minimal diff.', playbook: 'p'.repeat(400), qaBrief: 'not in it' })).toEqual([
      { label: 'Office instructions', tokens: 14 },
      { label: 'Office playbook', tokens: 4 },
      { label: "Floor's playbook", tokens: 100 },
      { label: 'Task prompt', tokens: 20 },
    ]);
  });

  it('splits the measurement into the known parts and the rest, largest first', () => {
    expect(startupParts(30_000, [{ label: 'CLAUDE.md files', tokens: 9_000 }, { label: 'Office instructions', tokens: 1_000 }, { label: 'QA brief', tokens: 0 }])).toEqual({
      tokens: 30_000,
      parts: [
        { label: REST_LABEL, tokens: 20_000 },
        { label: 'CLAUDE.md files', tokens: 9_000 },
        { label: 'Office instructions', tokens: 1_000 },
      ],
    });
    // Estimates over the measurement shrink to fit it.
    expect(startupParts(100, [{ label: 'a', tokens: 150 }, { label: 'b', tokens: 50 }]).parts).toEqual([
      { label: 'a', tokens: 75 },
      { label: 'b', tokens: 25 },
    ]);
  });

  it('averages each kind of task and its three largest parts, over the sessions that measured it', () => {
    const s = (kind: 'issue' | 'qa', tokens: number, claudeMd: number) => ({ kind, startup: startupParts(tokens, [{ label: 'CLAUDE.md files', tokens: claudeMd }, { label: 'Task prompt', tokens: 100 }, { label: 'Office instructions', tokens: 50 }]) });
    const rows = startupRows([s('issue', 30_000, 8_000), s('issue', 34_000, 10_000), s('qa', 60_000, 8_000), { kind: 'qa' }]);
    expect(rows).toEqual([
      { kind: 'qa', sessions: 1, avg: 60_000, top: [{ label: REST_LABEL, tokens: 51_850 }, { label: 'CLAUDE.md files', tokens: 8_000 }, { label: 'Task prompt', tokens: 100 }] },
      { kind: 'issue', sessions: 2, avg: 32_000, top: [{ label: REST_LABEL, tokens: 22_850 }, { label: 'CLAUDE.md files', tokens: 9_000 }, { label: 'Task prompt', tokens: 100 }] },
    ]);
  });
});
