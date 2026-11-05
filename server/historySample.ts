// The demo's Claude Code transcripts (#49): demo sessions write none, so each finished one gets a short made-up
// transcript in the demo's own home, in Claude Code's .jsonl shape, for the History screen to keep and show.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { HistoryEntry } from '../shared/history.ts';

type Block = Record<string, unknown>;

/** A made-up session's lines: the task, a look around, a test run and the reply. Pure. */
function demoTranscriptLines(about: Pick<HistoryEntry, 'kind' | 'title' | 'at'>, sessionId: string): string[] {
  const t = (s: number) => new Date(about.at - (60 - s) * 1000).toISOString();
  const line = (type: 'user' | 'assistant', content: string | Block[], s: number) => JSON.stringify({ type, sessionId, timestamp: t(s), message: { role: type, content } });
  const qa = about.kind === 'qa';
  return [
    line('user', `${qa ? 'Test' : 'Work on'} ${about.title || 'the task'} (demo).`, 0),
    line('assistant', [{ type: 'text', text: qa ? "I'll check out the PR and run its checks." : "I'll read the code around this first." }, { type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'TODO' } }], 5),
    line('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'src/app.ts:12: // TODO\nsrc/ui.ts:40: // TODO' }], 8),
    line('assistant', [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }], 20),
    line('user', [{ type: 'tool_result', tool_use_id: 't2', content: ' ✓ 42 tests passed (1.8s)' }], 40),
    line('assistant', [{ type: 'text', text: qa ? 'Everything I checked works. QA passed.' : 'Done: the change is in, tests pass, and the PR is open.' }], 58),
  ];
}

/** Writes a made-up transcript under `dir` and returns it; a session without an id gets one. */
export async function demoTranscript(dir: string, sessionId: string | null, about: Pick<HistoryEntry, 'kind' | 'title' | 'at'>) {
  const id = sessionId && /^[\w-]{1,128}$/.test(sessionId) ? sessionId : `demo-${crypto.randomUUID()}`;
  const file = path.join(dir, `${id}.jsonl`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, `${demoTranscriptLines(about, id).join('\n')}\n`);
  return { file, sessionId: id };
}
