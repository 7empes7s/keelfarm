// Pocket mode's ⚙️: the manager's console on a phone (#102). The same tabs and sections as the 3D office's console
// (ui/consoleNav.ts), as a list you tap into with a back button, iOS Settings style, and the search over every
// setting on top. Loaded when first opened; nothing here loads 3D (the look editor's preview loads on its own).
import { useLayoutEffect, useRef, useState } from 'react';
import { Badge, ConsoleSearch, SectionBody, useBadges, useFoundLabel, useSectionAddress } from '../ui/ConsoleNav';
import { GROUPS, sectionById, sectionsIn, type SectionId } from '../ui/consoleNav';
import type { HistoryFocus } from '../ui/HistoryTab';

/** A section, or 'menu': the list of them. */
export type ConsoleSection = SectionId | 'menu';

export function PocketConsole({ section, pick, history }: { section: ConsoleSection; pick: (s: ConsoleSection) => void; history?: HistoryFocus }) {
  const open = section === 'menu' ? null : (sectionById(section) ?? null);
  const [query, setQuery] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const setFound = useFoundLabel(body);
  const badges = useBadges();
  useSectionAddress(open);
  // each screen opens at its top (a block: Chrome's scrollTo can return a promise, which React would take for a cleanup)
  useLayoutEffect(() => {
    body.current?.closest('.panel-body')?.scrollTo(0, 0);
  }, [section]);
  if (open) {
    return (
      <div className="pk-console" ref={body}>
        <div className="cn-back-bar">
          <button className="btn btn-ghost cn-back" onClick={() => pick('menu')} aria-label="Back to settings">
            ‹ Settings
          </button>
          <h2 className="cn-title">
            <span aria-hidden>{open.icon}</span> {open.label}
          </h2>
        </div>
        <div className="ds-stack-scope" role="region" aria-label={open.label}>
          <SectionBody id={open.id} where="pocket" focus={{ history }} />
        </div>
      </div>
    );
  }
  return (
    <div className="pk-console" ref={body}>
      <ConsoleSearch
        where="pocket"
        query={query}
        setQuery={setQuery}
        go={(h) => {
          setQuery('');
          pick(h.section.id);
          setFound(h.label === h.section.label ? null : h.label);
        }}
      />
      {!query.trim() &&
        GROUPS.map((g) => (
          <section key={g.id} className="cn-list" aria-label={g.label}>
            <h3 className="cn-list-head">
              {g.icon} {g.label}
            </h3>
            <ul>
              {sectionsIn(g.id, 'pocket').map((s) => (
                <li key={s.id}>
                  <button className="cn-item cn-row" onClick={() => pick(s.id)}>
                    <span aria-hidden>{s.icon}</span>
                    <span className="cn-item-text">{s.label}</span>
                    <Badge n={badges[s.id]} />
                    <span className="cn-chevron" aria-hidden>
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
