import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Change } from './CostCards';

// The store reaches for window at import; Change doesn't use it.
vi.mock('../store', () => ({ useStore: () => undefined }));

describe('Change', () => {
  it('tells screen readers whether the cost went up or down, not only the percentage', () => {
    const up = renderToStaticMarkup(<Change change={0.24} />);
    const down = renderToStaticMarkup(<Change change={-0.24} />);
    expect(up).toContain('aria-label="Up"');
    expect(down).toContain('aria-label="Down"');
    expect(up).not.toContain('aria-hidden');
    expect(down).not.toContain('aria-hidden');
    expect(up).toContain('24%');
    expect(down).toContain('24%');
  });

  it('says level when the change rounds to nothing', () => {
    expect(renderToStaticMarkup(<Change change={0.001} />)).toContain('level');
  });
});
