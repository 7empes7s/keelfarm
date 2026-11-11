import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import type { FloorRef } from './chatLinks';
import { noteChips, noteSections, searchSections, type NoteChip, type NoteSection } from './noteSections';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import './ceoNotes.css';

// The CEO's own NOTES.md on the memory sheet (#417): a sticky search and jump list over one card per section, each
// folding on its own (ARCHIVE starts folded), its Markdown drawn only while open, with chips for its references.

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Chip({ chip }: { chip: NoteChip }) {
  switch (chip.kind) {
    case 'lead':
      return (
        <span className="note-chip note-chip-lead">
          {chip.msg !== undefined && <span>msg {chip.msg}</span>}
          {chip.date && <time dateTime={chip.date}>{day(chip.date)}</time>}
        </span>
      );
    case 'issue':
      return chip.url ? (
        <a className="note-chip note-chip-issue" href={chip.url} target="_blank" rel="noopener noreferrer">
          #{chip.number}
        </a>
      ) : (
        <span className="note-chip note-chip-issue">#{chip.number}</span>
      );
    case 'file':
      return (
        <code className="note-chip note-chip-file" title={`${chip.path}:${chip.line}`}>
          <Icon name="file-text" />
          {chip.path}:{chip.line}
        </code>
      );
    case 'label':
      return <span className="note-label">{chip.text}</span>;
  }
}

const SectionBody = memo(function SectionBody({ section, floors }: { section: NoteSection; floors: FloorRef[] }) {
  const { md, chips } = useMemo(() => noteChips(section, floors), [section, floors]);
  const renderRef = (i: number, children: ReactNode) => (chips[i] ? <Chip chip={chips[i]} /> : children);
  return <Markdown className="notes-md" text={md} renderRef={renderRef} />;
});

function SectionCard({ section, open, onToggle, floors }: { section: NoteSection; open: boolean; onToggle: () => void; floors: FloorRef[] }) {
  if (!section.body) {
    // a heading with only ### sections under it (ARCHIVE): a group title
    return (
      <h4 id={`note-${section.id}`} className="notes-group">
        {section.archived && <Icon name="archive" />} {section.title}
      </h4>
    );
  }
  const unit = section.count === 1 ? 'item' : 'items';
  return (
    <section id={`note-${section.id}`} className={`notes-card${section.level === 3 ? ' notes-card-sub' : ''}${section.archived ? ' notes-card-archived' : ''}`}>
      <button type="button" className="notes-head" onClick={onToggle} aria-expanded={open}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} />
        <span className="notes-title">
          {section.parent && <span className="notes-eyebrow">{section.parent}</span>}
          <span className="notes-name">{section.title}</span>
        </span>
        <span className="notes-meta">
          {section.count} {unit}
          {section.updated && (
            <>
              {' · '}
              <time dateTime={section.updated}>{day(section.updated)}</time>
            </>
          )}
        </span>
      </button>
      {open && <SectionBody section={section} floors={floors} />}
    </section>
  );
}

export function CeoNotes({ ceoName, text, truncated }: { ceoName: string; text: string; truncated: boolean }) {
  const repos = useStore((s) => s.repos);
  // By value: other changes to the floors leave the cards' Markdown alone.
  const floorsKey = JSON.stringify(repos.map((r): FloorRef => ({ floor: r.floor, fullName: r.fullName, prs: r.pulls.map((p) => p.number) })));
  const floors = useMemo<FloorRef[]>(() => JSON.parse(floorsKey), [floorsKey]);
  const sections = useMemo(() => noteSections(text), [text]);
  const [q, setQ] = useState('');
  // the cards opened or folded by hand, against their default (open; ARCHIVE folded unless searching)
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const list = useRef<HTMLDivElement>(null);
  const searching = !!q.trim();
  const shown = useMemo(() => (searching ? searchSections(sections, q) : sections), [sections, q, searching]);
  const isOpen = (s: NoteSection) => (searching || !s.archived) !== flipped.has(s.id);
  const flip = (id: string) =>
    setFlipped((f) => {
      const next = new Set(f);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const search = (v: string) => {
    if (!v.trim() !== !searching) setFlipped(new Set());
    setQ(v);
  };
  const jump = (id: string) => {
    const s = sections.find((x) => x.id === id);
    if (!s) return;
    setQ('');
    // open it, out of the search
    setFlipped((f) => {
      const next = new Set(searching ? [] : f);
      if (s.archived) next.add(id);
      else next.delete(id);
      return next;
    });
    requestAnimationFrame(() => list.current?.querySelector(`#note-${CSS.escape(id)}`)?.scrollIntoView({ block: 'start' }));
  };
  return (
    <>
      <div className="notes-bar">
        <input className="conv-search notes-search" type="search" value={q} onChange={(e) => search(e.target.value)} placeholder="Search the notes…" aria-label={`Search ${ceoName}'s notes`} />
        {sections.length > 1 && (
          <select className="notes-jump" value="" onChange={(e) => jump(e.target.value)} aria-label="Jump to a section">
            <option value="" disabled>
              Jump to…
            </option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.level === 3 ? `  ${s.title}` : s.title}
              </option>
            ))}
          </select>
        )}
      </div>
      <div ref={list} className="notes-list">
        {searching && !shown.length && <p className="muted">Nothing matches.</p>}
        {shown.map((s) => (
          <SectionCard key={s.id} section={s} open={isOpen(s)} onToggle={() => flip(s.id)} floors={floors} />
        ))}
      </div>
      {truncated && <p className="muted small">The file is longer than this; the start is shown.</p>}
    </>
  );
}
