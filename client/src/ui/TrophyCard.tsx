// A trophy up close (#311): E on one on the lobby shelf opens this card with its whole story, the PR it names as a
// link. One at a time: looking at another trophy replaces it.
import { useStore } from '../store';
import { Icon } from './Icon';
import { Panel } from './Panel';
import { trophyStory } from './trophyStory';
import './trophyCard.css';

export function TrophyCard({ id }: { id: string }) {
  const achievements = useStore((s) => s.progress.achievements);
  const repos = useStore((s) => s.repos);
  const t = trophyStory(id, achievements, repos);
  if (!t) return null;
  return (
    <Panel
      title={
        <span>
          {t.icon ?? <Icon name="lock" />} {t.name}
        </span>
      }
      className="trophy-card"
    >
      {t.locked ? (
        <>
          <p className="trophy-for">
            <span className="muted small">How to win it</span>
            {t.blurb}
          </p>
          <p className="muted small">Still locked: its plaque says ??? until the office earns it.</p>
        </>
      ) : (
        <>
          <p className="trophy-for">
            <span className="muted small">What it was for</span>
            {t.blurb}
          </p>
          <dl className="trophy-facts">
            <dt>Won</dt>
            <dd>{t.when}</dd>
            {t.detail && (
              <>
                <dt>How</dt>
                <dd>{t.detail}</dd>
              </>
            )}
            {t.floor && (
              <>
                <dt>Floor</dt>
                <dd>
                  {t.floor.n} · {t.floor.name}
                </dd>
              </>
            )}
          </dl>
          {t.pr && (
            <a className="btn" href={t.pr.url} target="_blank" rel="noopener noreferrer">
              Open PR #{t.pr.n}
            </a>
          )}
        </>
      )}
    </Panel>
  );
}
