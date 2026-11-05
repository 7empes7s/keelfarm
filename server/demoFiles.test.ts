import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoMakeFiles, sentFiles } from './demoFiles.ts';

describe("the demo CEO's files", () => {
  it('reads what was sent, makes a PDF and a PNG, attaches both and keeps the PDF', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-ceo-'));
    const calls: [string, Record<string, unknown>][] = [];
    const reads: string[] = [];
    const sent = sentFiles('- /store/abc (brief.pdf, application/pdf, 2 KB)');
    const reply = await demoMakeFiles(
      {
        step: async () => undefined,
        read: async (f) => void reads.push(f),
        use: async (tool, args) => (calls.push([tool, args]), tool === 'attach_file' ? 'Attached (file id 0123456789abcdef01234567).' : 'ok'),
        cwd,
      },
      [{ floor: 1, repo: 'demo/app', team: { size: 2 }, backlog: [1], pullRequests: [] }],
      sent,
    );
    expect(reads).toEqual(['/store/abc']);
    expect(calls.map(([t]) => t)).toEqual(['attach_file', 'attach_file', 'keep_file']);
    const pdf = fs.readFileSync(String(calls[0][1].path)).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('Floor 1 \\(demo/app\\): 2 agents');
    expect(fs.readFileSync(String(calls[1][1].path)).subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(reply).toMatch(/^I read brief.pdf\./);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
