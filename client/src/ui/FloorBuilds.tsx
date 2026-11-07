// "What's new on this floor" (#129): a swipeable row of cards on a floor's board and its pocket Company card, one per
// recent build (floorBuildCards.ts), each opening its preview (a merged PR's: main's), or the builder's terminal while
// there's nothing to run. A card with nothing to open is not a button.
import { useMemo } from 'react';
import { useStore } from '../store';
import { BUILD_LABEL, cardAction, cardActionLabel, floorBuilds, type CardAction, type BuildStatus } from './floorBuildCards';
import './floorBuilds.css';

const GLYPH: Record<BuildStatus, string> = { live: '🟢', building: '🔨', qa: '🔍', fixing: '🔧', passed: '✅', failed: '❌', 'needs-you': '🙋', open: '🔀', merged: '🟣' };

export function FloorBuilds({ repoId }: { repoId: string }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const prPreviews = useStore((s) => s.prPreviews);
  const openOverlay = useStore((s) => s.openOverlay);
  const cards = useMemo(() => (repo ? floorBuilds(repo, Object.values(agents), qa, prPreviews) : []), [repo, agents, qa, prPreviews]);
  if (!repo) return null;
  const open = (a: NonNullable<CardAction>) => openOverlay(a.kind === 'terminal' ? a : { ...a, repoId });
  return (
    <section className="fb" aria-label={`What's new on floor ${repo.floor}`}>
      <h3 className="fb-head small">What's new</h3>
      <div className="fb-row" role="list">
        {cards.map((c) => {
          const agent = c.agentId ? agents[c.agentId] : undefined;
          const act = cardAction(c);
          const label = cardActionLabel(c, act);
          const Card = act ? 'button' : 'div';
          return (
            <div key={c.key} role="listitem" className="fb-item">
              <Card className={`fb-card fb-${c.status} ${act ? '' : 'fb-card-still'}`} onClick={act ? () => open(act) : undefined} title={c.pr ? `PR #${c.pr} ${c.title}` : c.title}>
                <span className="fb-thumb" aria-hidden>
                  {c.shot ? <img src={c.shot} alt="" loading="lazy" /> : <span className="fb-thumb-glyph">{c.status === 'live' ? '🖥️' : GLYPH[c.status]}</span>}
                  {c.preview === 'running' && <span className="fb-running">● live</span>}
                </span>
                <span className="fb-title">
                  {c.pr ? <span className="muted">#{c.pr} </span> : null}
                  {c.title}
                </span>
                <span className="fb-meta">
                  {agent && (
                    <span className="fb-avatar" style={{ background: agent.color }} title={agent.name}>
                      {agent.name[0]}
                    </span>
                  )}
                  <span className="fb-chip">
                    {GLYPH[c.status]} {BUILD_LABEL[c.status]}
                  </span>
                </span>
                {label && <span className="fb-open">{label} ›</span>}
              </Card>
            </div>
          );
        })}
      </div>
    </section>
  );
}
