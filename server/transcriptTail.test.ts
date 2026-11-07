import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assistantTexts, TranscriptTail } from './transcriptTail.ts';

const line = (o: Record<string, unknown>) => `${JSON.stringify(o)}\n`;
const said = (uuid: string, text: string, at = '2026-11-05T10:00:05Z', extra: Record<string, unknown> = {}) =>
  line({ type: 'assistant', uuid, timestamp: at, message: { content: [{ type: 'text', text }, { type: 'tool_use', name: 'Read' }] }, ...extra });
const since = Date.parse('2026-11-05T10:00:00Z');

describe("the CEO's transcript, as it is written", () => {
  it("picks the main thread's new text blocks, once each", () => {
    const seen = new Set<string>();
    const chunk = [
      said('a', 'From the conversation being resumed', '2026-11-05T09:00:00Z'),
      line({ type: 'user', uuid: 'u', message: { content: 'Message from the manager' } }),
      said('b', 'Let me check the floors.'),
      said('c', 'A helper talking', undefined, { isSidechain: true }),
      'not json\n',
      said('d', '   '),
    ].join('');
    expect(assistantTexts(chunk, since, seen)).toEqual(['Let me check the floors.']);
    expect(assistantTexts(said('b', 'Let me check the floors.'), since, seen)).toEqual([]);
  });

  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  it('reads only whole lines, picking up a line once it is finished', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tail-'));
    dirs.push(dir);
    const file = path.join(dir, 'session.jsonl');
    const got: string[] = [];
    const tail = new TranscriptTail(since, (t) => got.push(t));
    tail.watch(file); // not there yet
    const second = said('2', 'Filing it now.');
    fs.writeFileSync(file, said('1', 'Reading the status.') + second.slice(0, 20));
    tail.read();
    expect(got).toEqual(['Reading the status.']);
    fs.appendFileSync(file, second.slice(20));
    tail.read();
    tail.stop();
    expect(got).toEqual(['Reading the status.', 'Filing it now.']);
  });

  it("passes an agent's steps on for their chat (#120), without text-only listeners", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tail-'));
    dirs.push(dir);
    const file = path.join(dir, 'session.jsonl');
    const kinds: string[] = [];
    const tail = new TranscriptTail(since, undefined, (ev) => kinds.push(...ev.map((e) => e.kind)));
    fs.writeFileSync(file, said('1', 'Reading the status.'));
    tail.watch(file);
    tail.stop();
    expect(kinds).toEqual(['text', 'tool']);
  });
});
