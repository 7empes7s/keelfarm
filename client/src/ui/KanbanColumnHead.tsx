// A Kanban column's header (#154, #680): a disclosure button with the column's name, its count and, folded, its
// summary. Folded it's a strip side by side or a pill on a phone (kanbanFold.css), never a blank coloured square.
import type React from 'react';
import { Icon } from './Icon';

/** What a screen reader hears, e.g. "Ready, 4 items, expand" or "In QA, 5 items: 1 need you · 4 waiting, expand". */
export function columnLabel(name: string, total: number, shut: boolean, summary = ''): string {
  return `${name}, ${total} ${total === 1 ? 'item' : 'items'}${summary ? `: ${summary}` : ''}, ${shut ? 'expand' : 'collapse'}`;
}

export function KanbanColumnHead(props: { title: React.ReactNode; name: string; total: number; shut: boolean; summary: string; controls: string; onToggle: () => void }) {
  const { title, name, total, shut, summary, controls, onToggle } = props;
  return (
    <button type="button" className="kcol-head" aria-expanded={!shut} aria-controls={controls} aria-label={columnLabel(name, total, shut, summary)} onClick={onToggle}>
      <span className="kcol-name">{title}</span> <span className="count">{total}</span>
      {summary && <span className="kcol-summary">{summary}</span>}
      <span className="kcol-chev" aria-hidden="true">
        <Icon name="chevron-right" />
      </span>
    </button>
  );
}
