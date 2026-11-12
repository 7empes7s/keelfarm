import { PROP_SET_INFO, PROP_SETS, propSetFor, type PropSet } from '../../../shared/floorProps';
import type { RepoView } from '../../../shared/types';
import { Icon } from './Icon';
import './floorThemePicker.css';

// A floor's project props (#536) in its settings, next to its 3D theme: the things in the room that show what the team
// builds. Auto lets the floor's profile and use case pick them; a card picks a set by hand. Like the theme, picking
// re-dresses the floor live for everyone.

export function FloorPropsPicker({ repo, onPick }: { repo: RepoView; onPick: (props: PropSet | 'auto') => void }) {
  const auto = propSetFor({ ...repo, useCase: repo.setup?.useCase ?? null });
  const current = repo.props ?? auto;
  const card = (value: PropSet | 'auto', name: string, blurb: string, on: boolean) => (
    <label key={value} className={`floor-theme-card${on ? ' on' : ''}`}>
      <input type="radio" name={`floor-props-${repo.id}`} value={value} checked={on} onChange={() => onPick(value)} />
      <span className="floor-theme-name">{name}</span>
      <span className="floor-theme-blurb">{blurb}</span>
    </label>
  );
  return (
    <details className="small floor-theme">
      <summary>
        <Icon name="toolbox" /> Project props · {PROP_SET_INFO[current].name}
        {!repo.props && <span className="floor-theme-from">Picked from what the floor builds</span>}
      </summary>
      <div className="floor-theme-cards" role="radiogroup" aria-label={`Floor ${repo.floor} project props`}>
        {card('auto', 'Auto', `From what it builds: ${PROP_SET_INFO[auto].name}`, !repo.props)}
        {PROP_SETS.map((s) => card(s, PROP_SET_INFO[s].name, PROP_SET_INFO[s].blurb, repo.props === s))}
      </div>
    </details>
  );
}
