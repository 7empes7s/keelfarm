import { FLOOR_THEME_INFO, FLOOR_THEMES, floorThemeOf, type FloorTheme } from '../../../shared/floorThemes';
import type { RepoView } from '../../../shared/types';
import { caseDef } from '../../../shared/useCases';
import { Icon } from './Icon';
import './floorThemePicker.css';

// A floor's 3D theme (#370) in its settings (console and pocket): a card per theme with a little preview of its walls,
// floor and accent. Picking one re-dresses the floor live for everyone (the repo event), and it's kept in the state.
// Until then a confirmed use case picks it (#528), which the summary says.

export function FloorThemePicker({ repo, onPick }: { repo: RepoView; onPick: (theme: FloorTheme) => void }) {
  const current = floorThemeOf(repo.theme);
  const useCase = !repo.themeByHand && repo.setup?.useCase && !repo.setup.guessed ? repo.setup.useCase : null;
  return (
    <details className="small floor-theme">
      <summary>
        <Icon name="palette" /> 3D look · {FLOOR_THEME_INFO[current].name}
        {useCase && (
          <>
            <span className="floor-theme-from">From its use case: {caseDef(useCase).label}</span>
            <span className="btn btn-ghost btn-small floor-theme-change">Change</span>
          </>
        )}
      </summary>
      <div className="floor-theme-cards" role="radiogroup" aria-label={`Floor ${repo.floor} theme`}>
        {FLOOR_THEMES.map((t) => {
          const info = FLOOR_THEME_INFO[t];
          const [wall, floor, accent] = info.swatch;
          return (
            <label key={t} className={`floor-theme-card${t === current ? ' on' : ''}`}>
              <input type="radio" name={`floor-theme-${repo.id}`} value={t} checked={t === current} onChange={() => onPick(t)} />
              <span className="floor-theme-preview" aria-hidden style={{ background: `linear-gradient(${wall} 0 58%, ${accent} 58% 64%, ${floor} 64%)` }}>
                <span className="floor-theme-screen" style={{ background: accent }} />
              </span>
              <span className="floor-theme-name">{info.name}</span>
              <span className="floor-theme-blurb">{info.blurb}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}
