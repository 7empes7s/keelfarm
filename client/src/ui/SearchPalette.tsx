// The search palette (#109): Ctrl/Cmd+K, or 🔍 in pocket's header and the 3D HUD. One box over everything the office
// has (searchIndex.ts), results grouped with icons, ↑ ↓ Enter or a tap to go.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Where } from './consoleNavRules';
import { go, openSearch, useFinder } from './goTo';
import { buildIndex, loadRecent, saveRecent, searchAll, withRecent, type Item } from './searchIndex';
import { Sheet } from './Sheet';
import { XLabel } from './HoverCard';

const close = () => useFinder.setState({ search: false });

/** Ctrl/Cmd+K anywhere opens the search (and closes it again). */
function useShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyK' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (useFinder.getState().search) close();
      else openSearch();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

function Palette({ where }: { where: Where }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const messages = useStore((s) => s.messages);
  const items = useMemo(() => buildIndex({ repos, agents, qa, messages, where }), [repos, agents, qa, messages, where]);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(loadRecent);
  const groups = useMemo(() => searchAll(query, items, recent), [query, items, recent]);
  const flat = groups.flatMap((g) => g.items);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const ids = useId();
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const pick = (i: Item) => {
    const next = withRecent(recent, i.id);
    saveRecent(next);
    setRecent(next);
    close();
    go(i.target);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      pick(flat[active]);
    }
  };
  let n = -1;
  return (
    <Sheet title="🔍 Search everything" onClose={close} className="search-sheet" top>
      <input
        className="search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        placeholder="Floors, agents, issues, PRs, settings, actions…"
        aria-label="Search everything"
        role="combobox"
        aria-expanded
        aria-controls={`${ids}-list`}
        aria-activedescendant={flat[active] ? `${ids}-${active}` : undefined}
        autoFocus
        enterKeyHint="go"
      />
      <div className="search-results" id={`${ids}-list`} role="listbox" aria-label="Results" ref={list}>
        {groups.length === 0 || flat.length === 0 ? (
          <p className="muted small search-none">Nothing found for “{query.trim()}”. Try fewer letters, or ask the CEO.</p>
        ) : (
          groups.map((g) => (
            <div key={g.kind} role="group" aria-label={g.label}>
              <div className="search-group">{g.label}</div>
              {g.items.map((i) => {
                n++;
                const at = n;
                return (
                  <div
                    key={i.id}
                    id={`${ids}-${at}`}
                    role="option"
                    aria-selected={at === active}
                    className={`search-item ${at === active ? 'search-item-on' : ''}`}
                    onPointerMove={() => setActive(at)}
                    onClick={() => pick(i)}
                  >
                    <span className="search-icon" aria-hidden>
                      {i.icon}
                    </span>
                    <span className="search-text">
                      <span className="search-label">{i.label}</span>
                      {i.sub && <span className="search-sub">{i.sub}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="muted small search-keys">
        <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close
      </div>
    </Sheet>
  );
}

export function SearchPalette({ where }: { where: Where }) {
  const open = useFinder((s) => s.search);
  useShortcut();
  return open ? <Palette where={where} /> : null;
}

/** The 🔍 that opens it. */
export function SearchButton({ className }: { className?: string }) {
  return (
    <button data-tour="search" className={`${className ?? 'pill pill-search'} xbtn`} onClick={openSearch} aria-label="Search everything (Ctrl+K)" title="Search everything (Ctrl+K)">
      🔍
      <XLabel text="Search everything" keys="Ctrl K" />
    </button>
  );
}
