import { describe, expect, it } from 'vitest';
import { allVersions, applyEdit, diffMarkdown, editDelivery, editLook, editNote, hasVersionsSheet, MESSAGE_VERSIONS_MAX, struckText, wordDiff } from './messageEdits';
import { compactMessage } from './journal';

describe('message edits (#125)', () => {
  it('diffs word by word, keeping the spaces', () => {
    expect(wordDiff('Merge PR #3 today', 'Merge PR #4 today, after QA')).toEqual([
      { op: 'same', text: 'Merge PR ' },
      { op: 'del', text: '#3' },
      { op: 'add', text: '#4' },
      { op: 'same', text: ' ' },
      { op: 'del', text: 'today' },
      { op: 'add', text: 'today, after QA' },
    ]);
    expect(wordDiff('same', 'same')).toEqual([{ op: 'same', text: 'same' }]);
    expect(wordDiff('', 'new')).toEqual([{ op: 'add', text: 'new' }]);
    // Joined back, each side is its own text.
    const parts = wordDiff('a b c d e', 'a x c e f');
    expect(parts.filter((p) => p.op !== 'add').map((p) => p.text).join('')).toBe('a b c d e');
    expect(parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')).toBe('a x c e f');
  });

  it('gives up on a word table for huge texts, striking the old one whole', () => {
    const big = 'w '.repeat(3000);
    expect(wordDiff(big, `${big}x`).map((p) => p.op)).toEqual(['del', 'add']);
  });

  it('strikes the old words through in Markdown, escaped, before the new ones', () => {
    expect(diffMarkdown(wordDiff('Merge PR #3 today', 'Merge PR #4 today'))).toBe('Merge PR ~~\\#3~~ #4 today');
    expect(diffMarkdown(wordDiff('Ship it **now**', 'Ship it'))).toBe('Ship it ~~\\*\\*now\\*\\*~~ ');
  });

  it('keeps the old text as a version, at most MESSAGE_VERSIONS_MAX in all', () => {
    expect(applyEdit({ text: 'a', at: 1 }, 'a', 2)).toBeNull();
    let m: { text: string; at: number; edited?: number; versions?: { text: string; at: number; reason?: string }[] } = { text: 'v0', at: 1 };
    m = { ...m, ...applyEdit(m, 'v1', 10, 'typo')! };
    expect(m).toEqual({ text: 'v1', at: 1, edited: 10, versions: [{ text: 'v0', at: 1, reason: 'typo' }] });
    for (let n = 2; n < 15; n++) m = { ...m, ...applyEdit(m, `v${n}`, n * 10)! };
    const all = allVersions(m);
    expect(all).toHaveLength(MESSAGE_VERSIONS_MAX);
    expect(all.map((v) => v.text)).toEqual(['v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14']);
    expect(all.at(-1)).toEqual({ text: 'v14', at: 140 });
    expect(all[0].at).toBe(50); // when that version was written
  });

  it("replaces the manager's own text, and shows the CEO's and agents' changes", () => {
    expect(editLook('manager')).toBe('replace');
    expect(editLook('ceo')).toBe('diff');
    expect(editLook('agent')).toBe('diff');
    const m = { text: 'two PRs', versions: [{ text: 'three PRs', at: 1 }] };
    expect(struckText(m, 'manager')).toBeNull();
    expect(struckText(m, 'ceo')).toBe('~~three~~ two PRs');
    expect(struckText(m, 'agent')).toBe('~~three~~ two PRs');
    expect(struckText({ text: 'never edited' }, 'ceo')).toBeNull();
  });

  it('offers the Versions sheet only for edited, longer messages', () => {
    expect(hasVersionsSheet({ text: 'x'.repeat(500) })).toBe(false);
    expect(hasVersionsSheet({ text: 'short', versions: [{ text: 'shorter', at: 1 }] })).toBe(false);
    expect(hasVersionsSheet({ text: 'short', versions: [{ text: 'x'.repeat(200), at: 1 }] })).toBe(true);
  });

  it('sends a queued edit as is, re-asks the last message, and notes an earlier one', () => {
    expect(editDelivery({ queued: true, last: true })).toBe('queued');
    expect(editDelivery({ queued: true, last: false })).toBe('queued');
    expect(editDelivery({ queued: false, last: true })).toBe('reask');
    expect(editDelivery({ queued: false, last: false })).toBe('note');
    expect(editNote(7, 'Plan a bakery', 'Plan a **cake** shop')).toBe('[manager edited message #7: "Plan a bakery" → "Plan a cake shop"]');
  });

  it('keeps old versions out of the journal', () => {
    const out = compactMessage({ id: 1, from: 'ceo', text: 'now', at: 1, edited: 2, versions: [{ text: 'token=abcdef123456 before', at: 1 }] });
    expect(out).not.toHaveProperty('versions');
  });
});
