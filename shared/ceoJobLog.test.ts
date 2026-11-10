import { describe, expect, it } from 'vitest';
import { ceoLogRows, countTools, jobReply, toolsLine, transcriptTokens, type CeoJobInfo } from './ceoJobLog.ts';
import type { HistoryEntry } from './history.ts';

const info = (job: number, over: Partial<CeoJobInfo> = {}): CeoJobInfo => ({ job, kind: 'followup', trigger: 'Event e1: Ada stalled', fresh: true, reply: 'replied', message: 40 + job, tools: {}, issues: 0, inputTokens: null, outputTokens: null, ...over });
const entry = (at: number, model: string, ceo?: CeoJobInfo, kind: HistoryEntry['kind'] = 'ceo-followup'): HistoryEntry => ({
  id: `h${at}`, at, startedAt: at - 60_000, repoId: '', repo: '', floor: null, agentId: 'ceo', agent: 'Mimoun', kind, issue: null, pr: null, title: 'Follow-up',
  outcome: 'ceo-acted', note: '', usd: 0.3, tokens: null, model, effort: 'medium', sessionId: null, transcript: null, ...(ceo && { ceo }),
});

describe('the CEO jobs log (#332)', () => {
  it('counts the tools a job called, by short name', () => {
    const tools = countTools({}, [{ kind: 'tool', tool: 'mcp__office__file_issue' }, { kind: 'result' }, { kind: 'tool', tool: 'mcp__office__file_issue' }, { kind: 'tool', tool: 'Read' }]);
    expect(tools).toEqual({ file_issue: 2, Read: 1 });
    expect(toolsLine(tools)).toBe('file_issue ×2 · Read');
  });

  it('says replied, quiet or failed', () => {
    expect(jobReply(true, 12)).toBe('replied');
    expect(jobReply(true, null)).toBe('quiet');
    expect(jobReply(false, 12)).toBe('failed');
  });

  it("adds up only this job's tokens from its transcript", () => {
    const t = (iso: string, usage: object) => JSON.stringify({ type: 'assistant', timestamp: iso, message: { role: 'assistant', content: [], usage } });
    const jsonl = [
      t('2026-11-10T09:00:00Z', { input_tokens: 999, output_tokens: 999 }), // an earlier job in the kept session
      t('2026-11-10T10:00:01Z', { input_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 50, output_tokens: 300 }),
      JSON.stringify({ type: 'user', timestamp: '2026-11-10T10:00:02Z', message: { usage: { input_tokens: 5 } } }),
      t('2026-11-10T10:00:03Z', { input_tokens: 10, output_tokens: 20 }),
      '{"type":"assistant","usage', // torn
    ].join('\n');
    expect(transcriptTokens(jsonl, Date.parse('2026-11-10T10:00:00Z'))).toEqual({ input: 2160, output: 320 });
    expect(transcriptTokens('{"type":"user"}', 0)).toBeNull();
  });

  it('keeps one row per CEO job with its fields, filtered by kind and model, linked to its redo', () => {
    const first = entry(1000, 'claude-sonnet-5', info(7, { tools: { agent_log: 1 }, inputTokens: 41_000, outputTokens: 900 }));
    const redo = entry(3000, 'claude-opus-5-5', info(8, { trigger: 'Redo of job #7', redoOf: 7 }));
    const chat = entry(2000, 'claude-opus-5-5', info(6, { kind: 'chat', fresh: false }), 'ceo-wait');
    const rows = ceoLogRows([first, chat, redo, entry(500, 'claude-sonnet-5'), entry(400, '', undefined, 'merge')], { kind: '', model: '' });
    expect(rows.map((r) => r.entry.ceo.job)).toEqual([8, 6, 7]); // newest first, entries without a job left out
    expect(rows.find((r) => r.entry.ceo.job === 7)).toMatchObject({ redoneBy: 8, entry: { model: 'claude-sonnet-5', usd: 0.3, ceo: { trigger: 'Event e1: Ada stalled', fresh: true, reply: 'replied', tools: { agent_log: 1 }, inputTokens: 41_000, outputTokens: 900, issues: 0 } } });
    expect(rows.find((r) => r.entry.ceo.job === 8)).toMatchObject({ redoneBy: null, entry: { ceo: { redoOf: 7 } } });
    expect(ceoLogRows([first, chat, redo], { kind: 'chat', model: '' }).map((r) => r.entry.ceo.job)).toEqual([6]); // by the job's kind, not the session's
    expect(ceoLogRows([first, chat, redo], { kind: 'followup', model: 'claude-sonnet-5' }).map((r) => [r.entry.ceo.job, r.redoneBy])).toEqual([[7, 8]]); // the link survives the filter
  });
});
