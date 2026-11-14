import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ceoSystemPrompt } from './ceo.ts';
import { archiveFileOf, splitNotes, tidyContextFile } from './ceoNotes.ts';

// #663: NOTES.md grew past the Read tool's 256 KB and the CEO couldn't read its notes. The office keeps CURRENT in it
// and moves the archive into NOTES-archive.md, append-only, never losing a line.
const lines = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix} ${i}: ${'x'.repeat(60)}`);

describe('splitNotes', () => {
  it('leaves a small file alone', () => {
    expect(splitNotes('# CURRENT\n- a\n\nARCHIVE BELOW\n- old', 1000)).toBeNull();
  });

  it('keeps CURRENT and moves everything under ARCHIVE BELOW out, with no line lost', () => {
    const current = ['# CURRENT', ...lines('now', 20)];
    const old = lines('old', 400);
    const text = [...current, '## ARCHIVE BELOW', ...old].join('\n');
    const s = splitNotes(text, 10_000)!;
    expect(s.current.split('\n').slice(0, current.length)).toEqual(current);
    expect(s.current).toContain('NOTES-archive.md');
    expect(s.current).not.toContain('old 0:');
    for (const l of text.split('\n')) expect(s.current.includes(l) || s.archive.includes(l)).toBe(true);
  });

  it('cuts at a line when there is no marker or CURRENT alone is too big, keeping the top', () => {
    const text = lines('note', 500).join('\n');
    const s = splitNotes(text, 10_000)!;
    expect(Buffer.byteLength(s.current)).toBeLessThanOrEqual(10_000);
    expect(s.current.startsWith('note 0:')).toBe(true);
    expect([...s.current.split('\n').filter((l) => l.startsWith('note')), ...s.archive.split('\n').filter((l) => l.startsWith('note'))]).toEqual(text.split('\n'));
  });
});

describe('tidyContextFile', () => {
  it('rewrites NOTES.md to CURRENT and appends the rest to NOTES-archive.md, every time', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
    const file = path.join(dir, 'NOTES.md');
    fs.writeFileSync(file, ['# CURRENT', '- keep me', 'ARCHIVE BELOW', ...lines('first', 300)].join('\n'));
    expect(tidyContextFile(file, 5_000)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('- keep me');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('first 0:');
    fs.appendFileSync(file, `\n${lines('second', 300).join('\n')}`);
    expect(tidyContextFile(file, 5_000)).toBe(true);
    const archive = fs.readFileSync(archiveFileOf(file), 'utf8');
    for (const l of [...lines('first', 300), ...lines('second', 300)]) expect(archive).toContain(l);
    expect(archive.indexOf('first 0:')).toBeLessThan(archive.indexOf('second 0:')); // appended, never rewritten
    expect(tidyContextFile(file, 5_000)).toBe(false); // small again
    expect(tidyContextFile(path.join(dir, 'missing.md'), 5_000)).toBe(false);
  });
});

describe("the CEO's prompt", () => {
  it('reads only the current notes and greps the archive', () => {
    const notesFile = path.join('/x', 'ceo', 'NOTES.md');
    const p = ceoSystemPrompt({ name: 'Luna', company: 'Acme', manager: 'Sam', notesFile, sessionLimit: 0, maxAgents: 10, scaling: 'approve' });
    expect(p).toContain(path.join('/x', 'ceo', 'NOTES-archive.md'));
    expect(p).toMatch(/Grep it/);
  });
});
