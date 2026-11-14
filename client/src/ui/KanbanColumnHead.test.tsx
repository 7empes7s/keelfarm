import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KanbanColumnHead, columnLabel } from './KanbanColumnHead';

const head = (name: string, total: number, shut: boolean, summary = '') =>
  renderToStaticMarkup(<KanbanColumnHead title={name} name={name} total={total} shut={shut} summary={summary} controls="c" onToggle={() => {}} />);

describe("a Kanban column's header (#680)", () => {
  it('shows a folded column its name and count, not just a chevron', () => {
    const html = head('Ready', 4, true);
    expect(html).toContain('<span class="kcol-name">Ready</span>');
    expect(html).toContain('<span class="count">4</span>');
    expect(html).toContain('aria-label="Ready, 4 items, expand"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('reads an empty column as 0 and an open one as collapse', () => {
    expect(head('Merged', 0, true)).toContain('<span class="count">0</span>');
    expect(columnLabel('In QA', 1, false)).toBe('In QA, 1 item, collapse');
    expect(columnLabel('In QA', 5, true, '1 need you · 4 waiting')).toBe('In QA, 5 items: 1 need you · 4 waiting, expand');
  });
});
