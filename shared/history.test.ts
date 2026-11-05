import { describe, expect, it } from 'vitest';
import { daysToTotal, dayTotals, expiredDays, filterHistory, formatEntry, historyText, keptEntries, readTranscript, transcriptPath, type HistoryEntry } from './history.ts';

const AT = Date.UTC(2026, 10, 5, 5, 40);
const DAY = 86_400_000;

const entry = (o: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'x',
  at: AT,
  startedAt: AT - 28 * 60_000,
  repoId: 'r1',
  repo: '7empes7s/keelfarm',
  floor: 3,
  agentId: 'a1',
  agent: 'Grace',
  kind: 'issue',
  issue: 41,
  pr: 63,
  title: 'Daily work log',
  outcome: 'pr',
  note: '',
  usd: 1.234,
  tokens: 12_345,
  model: 'claude-opus-5-5',
  effort: 'medium',
  sessionId: 's1',
  transcript: '2026/11/05/grace-issue-s1.jsonl.gz',
  ...o,
});

describe('daily log entries', () => {
  it('has the time range in UTC, who, what, the outcome, links, cost and the transcript', () => {
    const text = formatEntry(entry(), { transcriptFile: '/home/h/history/2026/11/05/grace-issue-s1.jsonl.gz', secrets: [] });
    expect(text).toBe(
      [
        '### 05:12–05:40 UTC · Grace · Building an issue · #41 Daily work log',
        '- Outcome: PR #63 opened',
        '- Where: 7empes7s/keelfarm (floor 3) · https://github.com/7empes7s/keelfarm/issues/41 · https://github.com/7empes7s/keelfarm/pull/63',
        '- Ran: 28m · $1.23 · 12.3k tokens · claude-opus-5-5 · medium effort',
        '- Transcript: /home/h/history/2026/11/05/grace-issue-s1.jsonl.gz',
        '',
        '',
      ].join('\n'),
    );
  });

  it("says why QA failed in one line, and a merge has no duration", () => {
    expect(formatEntry(entry({ kind: 'qa', outcome: 'qa-fail', note: 'The panel overflows\nat 390 px' }), { transcriptFile: null, secrets: [] })).toContain('- Outcome: QA failed: The panel overflows at 390 px');
    const merge = formatEntry(entry({ kind: 'merge', agent: 'The office', outcome: 'merged', issue: null, usd: 0, tokens: null, model: '', effort: '', startedAt: AT }), { transcriptFile: null, secrets: [] });
    expect(merge).toContain('### 05:40 UTC · The office · Merge · PR #63 Daily work log');
    expect(merge).not.toContain('- Ran:');
  });

  it('never writes a secret: planted tokens and environment values are redacted', () => {
    const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
    const envValue = 'hunter2-the-office-secret';
    const text = formatEntry(entry({ title: `Rotate ${token}`, outcome: 'error', note: `failed with GH_TOKEN=${token} and ${envValue}` }), { transcriptFile: null, secrets: [envValue] });
    expect(text).not.toContain(token);
    expect(text).not.toContain(envValue);
    expect(text).toContain('[redacted]');
  });

  it("totals a day: sessions, merges, QA's pass rate, cost and usage", () => {
    const day = [entry({ outcome: 'qa-pass', kind: 'qa' }), entry({ outcome: 'qa-pass', kind: 'qa' }), entry({ outcome: 'qa-fail', kind: 'qa' }), entry({ kind: 'merge', outcome: 'merged', usd: 0 }), entry({ at: AT - DAY })];
    expect(dayTotals(day, '2026-11-05', '5h 42% · week 30%')).toBe('### cubefarm totals · 2026-11-05\n- 3 sessions · 1 merged · QA pass rate 67% (2 of 3) · $3.70 · usage at end of day: 5h 42% · week 30%\n\n');
    expect(dayTotals([], '2026-11-05', null)).toContain('0 sessions · 0 merged · QA pass rate no QA verdicts');
  });

  it('keeps transcripts by UTC day, agent, kind and session', () => {
    expect(transcriptPath({ at: AT, agent: 'Ada Lovelace', kind: 'fix-qa' }, 'abc-123')).toBe('2026/11/05/ada-lovelace-fix-qa-abc-123.jsonl.gz');
    expect(transcriptPath({ at: AT, agent: 'Ada', kind: 'qa' }, '../../etc')).toBe('2026/11/05/ada-qa-etc.jsonl.gz');
  });
});

describe('filtering', () => {
  const all = [
    entry({ id: '1', at: AT - 3000, agent: 'Grace', agentId: 'a1', kind: 'issue' }),
    entry({ id: '2', at: AT - 2000, agent: 'Alan', agentId: 'a2', kind: 'fix-qa', outcome: 'commit', issue: 7, title: 'Fix the lobby lights' }),
    entry({ id: '3', at: AT - 1000, agent: 'Grace', agentId: 'a1', kind: 'qa', outcome: 'qa-fail', note: 'tests fail', repoId: 'r2' }),
  ];
  const ids = (p: { entries: HistoryEntry[] }) => p.entries.map((e) => e.id);

  it('narrows by floor, agent (id or name), kind, outcome and issue, newest first', () => {
    expect(ids(filterHistory(all, {}))).toEqual(['3', '2', '1']);
    expect(ids(filterHistory(all, { agent: 'grace' }))).toEqual(['3', '1']);
    expect(ids(filterHistory(all, { agent: 'a2' }))).toEqual(['2']);
    expect(ids(filterHistory(all, { kind: 'fix' }))).toEqual(['2']);
    expect(ids(filterHistory(all, { outcome: 'qa-fail' }))).toEqual(['3']);
    expect(ids(filterHistory(all, { repoId: 'r1', issue: 41 }))).toEqual(['1']);
    expect(ids(filterHistory(all, { since: AT - 1500 }))).toEqual(['3']);
  });

  it('searches titles and outcomes, every word', () => {
    expect(ids(filterHistory(all, { q: 'lobby' }))).toEqual(['2']);
    expect(ids(filterHistory(all, { q: 'QA failed tests' }))).toEqual(['3']);
    expect(ids(filterHistory(all, { q: 'lobby tests' }))).toEqual([]);
  });

  it('pages', () => {
    const p = filterHistory(all, { offset: 1, limit: 1 });
    expect(ids(p)).toEqual(['2']);
    expect(p).toMatchObject({ total: 3, offset: 1, more: true });
    expect(filterHistory(all, { offset: 2, limit: 1 }).more).toBe(false);
  });

  it("is session_history's small text, with the next page", () => {
    const text = historyText(filterHistory(all, { agent: 'Grace', limit: 1 }), 1, 1);
    expect(text.split('\n')).toEqual(['2 sessions, page 1 of 2 (page 2 next):', '- 2026-11-05 05:12–05:39 UTC · Grace · qa · floor 3 #41 Daily work log → QA failed: tests fail · 28m · $1.23 · transcript kept']);
    expect(historyText(filterHistory(all, { agent: 'Nobody' }), 1, 20)).toMatch(/^No sessions match/);
  });
});

describe('retention', () => {
  it('keeps what is younger than the retention, everything at 0', () => {
    const old = entry({ at: AT - 91 * DAY });
    expect(keptEntries([old, entry()], AT, 90)).toEqual([entry()]);
    expect(keptEntries([old, entry()], AT, 0)).toHaveLength(2);
  });

  it('removes day folders older than the retention, none at 0', () => {
    const days = ['2026/08/06', '2026/08/07', '2026/11/05', 'junk'];
    expect(expiredDays(days, AT, 90)).toEqual(['2026/08/06']);
    expect(expiredDays(days, AT, 0)).toEqual([]);
  });

  it('totals each finished day once', () => {
    const list = [entry({ at: AT - 2 * DAY }), entry({ at: AT - DAY }), entry()];
    expect(daysToTotal(list, AT, null)).toEqual(['2026-11-03', '2026-11-04']);
    expect(daysToTotal(list, AT, '2026-11-03')).toEqual(['2026-11-04']);
    expect(daysToTotal(list, AT, '2026-11-04')).toEqual([]);
  });
});

describe('transcripts', () => {
  const token = 'sk-ant-' + 'abcdefghijklmnopqrstuvwx';
  const lines = [
    { type: 'summary', summary: 'x' },
    { type: 'user', timestamp: '2026-11-05T05:12:00Z', message: { role: 'user', content: 'Build #41' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Looking around.' }, { type: 'tool_use', id: 't', name: 'Bash', input: { command: `ANTHROPIC_API_KEY=${token} npm test` } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: '42 passed' }] }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: 'boom' }] } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'caveat' } },
  ];
  const jsonl = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n{"type":"user","mess`;

  it('reads prompts, replies, tool calls and results, skipping the rest and a torn line', () => {
    const { items, cut } = readTranscript(jsonl, []);
    expect(cut).toBe(false);
    expect(items.map((i) => [i.role, i.tool ?? '', i.text])).toEqual([
      ['user', '', 'Build #41'],
      ['assistant', '', 'Looking around.'],
      ['tool', 'Bash', 'ANTHROPIC_API_KEY=[redacted] npm test'],
      ['result', '', '42 passed'],
      ['error', '', 'boom'],
    ]);
    expect(items[0].at).toBe(Date.UTC(2026, 10, 5, 5, 12));
    expect(JSON.stringify(items)).not.toContain(token);
  });

  it('stops at the cap and says so', () => {
    const { items, cut } = readTranscript(jsonl, [], 2);
    expect(items).toHaveLength(2);
    expect(cut).toBe(true);
  });
});
