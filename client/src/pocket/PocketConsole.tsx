// Pocket mode's ⚙️: the manager's console on a phone (#102). The same tabs and sections as the 3D office's console
// (ui/consoleNavRules.ts), as a list you tap into with a back button, iOS Settings style, and the search over every
// setting on top; on a desktop (#104) the 3D office's top tabs and side menu instead. Loaded when first opened; nothing
// here loads 3D (the look editor's preview loads on its own).
import { useLayoutEffect, useRef, useState } from 'react';
import { Badge, ConsoleSearch, ConsoleSplit, SectionBody, useBadges, useFoundLabel, useSectionAddress } from '../ui/ConsoleNav';
import { GROUPS, loadRemembered, opening, sectionById, sectionsIn, type SectionId } from '../ui/consoleNavRules';
import type { HistoryFocus } from '../ui/HistoryTab';
import { InfoButton } from '../ui/InfoButton';
import { useRunningPreviews } from '../ui/PreviewsPage';
import { useStore } from '../store';
import { Icon } from '../ui/Icon';

/** A section, or 'menu': the list of them. */
export type ConsoleSection = SectionId | 'menu';

type Props = { section: ConsoleSection; pick: (s: ConsoleSection) => void; history?: HistoryFocus; repoId?: string };

/** The console on a desktop: the menu opens at the section last shown. */
function WideConsole({ section, pick, history, repoId }: Props) {
  const open = (section === 'menu' ? null : sectionById(section)) ?? opening(undefined, '', 'pocket', loadRemembered());
  useSectionAddress(open);
  return <ConsoleSplit where="pocket" section={open} pick={(s) => pick(s.id)} focus={{ history, repoId }} />;
}

export function PocketConsole({ wide, ...props }: Props & { wide?: boolean }) {
  return wide ? <WideConsole {...props} /> : <PhoneConsole {...props} />;
}

function PhoneConsole({ section, pick, history, repoId }: Props) {
  const open = section === 'menu' ? null : (sectionById(section) ?? null);
  const [query, setQuery] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const setFound = useFoundLabel(body);
  const badges = useBadges();
  const previews = useRunningPreviews();
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
            <Icon name="chevron-left" /> Settings
          </button>
          <h2 className="cn-title">
            <Icon name={open.icon} /> {open.label}
          </h2>
          <InfoButton screen={open.id} className="ds-btn ds-btn-icon" />
        </div>
        <div className="ds-stack-scope" role="region" aria-label={open.label}>
          <SectionBody id={open.id} where="pocket" focus={{ history, repoId }} />
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
      {!query.trim() && (
        // the phone's way to the Previews page (#226), which the rail has on a desktop
        <section className="cn-list" aria-label="Pages">
          <ul>
            <li>
              <button className="cn-item cn-row" onClick={() => useStore.getState().openOverlay({ kind: 'previews' })}>
                <Icon name="monitor" />
                <span className="cn-item-text">Previews</span>
                <Badge n={previews} />
                <span className="cn-chevron" aria-hidden>
                  <Icon name="chevron-right" />
                </span>
              </button>
            </li>
          </ul>
        </section>
      )}
      {!query.trim() &&
        GROUPS.map((g) => (
          <section key={g.id} className="cn-list" aria-label={g.label}>
            <h3 className="cn-list-head">
              <Icon name={g.icon} /> {g.label}
            </h3>
            <ul>
              {sectionsIn(g.id, 'pocket').map((s) => (
                <li key={s.id}>
                  <button className="cn-item cn-row" onClick={() => pick(s.id)}>
                    <Icon name={s.icon} />
                    <span className="cn-item-text">{s.label}</span>
                    <Badge n={badges[s.id]} />
                    <span className="cn-chevron" aria-hidden>
                      <Icon name="chevron-right" />
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
