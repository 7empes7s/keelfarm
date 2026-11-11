import { useLayoutEffect, useRef } from 'react';
import type { RepoView } from '../../../shared/types';
import { plateTint, scrollToShow } from './floorPlates';
import './floorPicker.css';

// The floor picker (#412): the floors as an elevator panel's row of level plates, each with its number in a little
// display and its repo's name, tinted with its 3D theme. The picked one is pressed in with its display lit and ringed.
// The row scrolls sideways inside itself, never the page, and keeps the picked plate in view.

export function FloorPicker({ repos, value, onPick }: { repos: RepoView[]; value: string; onPick: (id: string) => void }) {
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = row.current;
    const on = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el && on) el.scrollLeft = scrollToShow(el.scrollLeft, el.clientWidth, on.offsetLeft,on.offsetWidth);
  }, [value]);
  return (
    <div ref={row} className="floor-picker" role="tablist" aria-label="Floor">
      {repos.map((r) => {
        const on = r.id === value;
        return (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-current={on ? 'true' : undefined}
            className={`fp-plate ${on ? 'fp-plate-on' : ''}`}
            style={{ ['--accent' as string]: r.color, ['--fp-tint' as string]: plateTint(r.theme) }}
            onClick={() => onPick(r.id)}
            title={r.fullName}
          >
            <span className="fp-num">{r.floor}</span>
            <span className="sr-only"> · </span>
            <span className="fp-name">{r.fullName.split('/')[1] ?? r.fullName}</span>
          </button>
        );
      })}
    </div>
  );
}
