import { describe, expect, it } from 'vitest';
import { prSummary } from './prSummary';

describe('prSummary', () => {
  it('takes the first paragraph as plain text', () => {
    const body = '## Summary\nAdds a **Follow** button to the [app viewer](https://x.y) and `PrChanges.tsx`.\nIt tracks the agent.\n\nMore details here.';
    expect(prSummary(body)).toBe('Adds a Follow button to the app viewer and PrChanges.tsx. It tracks the agent.');
  });
  it('skips Closes lines, headings, code and comments', () => {
    expect(prSummary('Closes #203\n\n<!-- template -->\n\n```ts\nconst a = 1\n```\n\n- Fixes the toolbar wrap')).toBe('Fixes the toolbar wrap');
  });
  it('clips long text and is empty without a body', () => {
    expect(prSummary('word '.repeat(100), 40)).toHaveLength(40);
    expect(prSummary('word '.repeat(100), 40).endsWith('…')).toBe(true);
    expect(prSummary('')).toBe('');
    expect(prSummary(null)).toBe('');
    expect(prSummary('Closes #1')).toBe('');
  });
});
