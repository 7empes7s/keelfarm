import { describe, expect, it } from 'vitest';
import { loadMemory, MEMORY_MAX_NOTES, MEMORY_NOTE_MAX, MEMORY_TOTAL_MAX, memoryPrompt, removeNote, saveNote, searchNotes, type MemoryNote } from './ceoMemory.ts';

const notes = (n: number, len = 10): MemoryNote[] => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, text: 'x'.repeat(len), at: 0 }));

describe("the manager's notes for the CEO (memory cap)", () => {
  it('adds, edits and deletes notes, tidying spaces', () => {
    let list = saveNote([], '  Ship   on Fridays\nonly after QA ', 5);
    expect(list).toEqual([{ id: expect.any(String), text: 'Ship on Fridays only after QA', at: 5 }]);
    list = saveNote(list, 'Ship on Thursdays', 6, list[0].id);
    expect(list[0]).toMatchObject({ text: 'Ship on Thursdays', at: 6 });
    expect(removeNote(list, list[0].id)).toEqual([]);
    expect(() => removeNote(list, 'nope')).toThrow('That note is gone.');
    expect(() => saveNote(list, 'x', 1, 'nope')).toThrow('That note is gone.');
  });

  it('caps the number of notes, each note and their total', () => {
    expect(() => saveNote([], '   ', 1)).toThrow('Write the note first.');
    expect(() => saveNote([], 'y'.repeat(MEMORY_NOTE_MAX + 1), 1)).toThrow(/under 300 characters/);
    expect(() => saveNote(notes(MEMORY_MAX_NOTES), 'one more', 1)).toThrow(/12 notes at most/);
    const full = notes(Math.floor(MEMORY_TOTAL_MAX / MEMORY_NOTE_MAX), MEMORY_NOTE_MAX); // 6 × 300 = 1800
    expect(() => saveNote(full, 'z'.repeat(250), 1)).toThrow(/2000 characters in all/);
    expect(saveNote(full, 'z'.repeat(200), 1)).toHaveLength(full.length + 1);
    expect(saveNote(full, 'z'.repeat(MEMORY_NOTE_MAX), 1, full[0].id)[0].text).toHaveLength(MEMORY_NOTE_MAX); // an edit replaces its own size
  });

  it('cleans what was saved', () => {
    expect(loadMemory(undefined)).toEqual([]);
    expect(loadMemory([{ id: 'a', text: ' keep ', at: 3 }, { id: 'b', text: '' }, null, { text: 'no id' }])).toEqual([{ id: 'a', text: 'keep', at: 3 }]);
  });

  it("goes in every job's prompt, and only when there are notes", () => {
    expect(memoryPrompt([])).toBe('');
    expect(memoryPrompt([{ id: 'a', text: 'No releases on Fridays', at: 0 }])).toBe('\n\nThe manager asked you to always remember:\n- No releases on Fridays');
  });
});

describe("searching the CEO's notes", () => {
  it('finds the lines with every word, under their heading', () => {
    const text = '# Notes\n## Floors\n- Floor 1: the web shop\n- Floor 2: the API\n## Lessons\nThe shop needs phones first';
    expect(searchNotes(text, 'SHOP')).toEqual([
      { heading: 'Floors', line: '- Floor 1: the web shop' },
      { heading: 'Lessons', line: 'The shop needs phones first' },
    ]);
    expect(searchNotes(text, 'floor api')).toEqual([{ heading: 'Floors', line: '- Floor 2: the API' }]);
    expect(searchNotes(text, '')).toEqual([]);
  });
});
