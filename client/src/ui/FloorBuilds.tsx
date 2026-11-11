// "What's new on this floor" (#129): a swipeable row of cards on a floor's board and its pocket Company card, one per
// recent build (floorBuildCards.ts). A PR's card opens the PR's page and its "Open preview" button the preview (a
// merged PR's: main's, #407); other cards open their preview, or the builder's terminal while there's nothing to run.
// A card with nothing to open is not a button.
import { useMemo } from 'react';
import { useStore } from '../store';
import { BUILD_LABEL, cardAction, cardActionLabel, floorBuilds, type CardAction, type BuildStatus } from './floorBuildCards';
import { Icon } from './Icon';
import { prPage } from './prNav';
import type { IconName } from './icons';
import './floorBuilds.css';

const GLYPH: Record<BuildStatus, IconName> = {
  live: 'circle-dot',
  building: 'hammer',
  qa: 'search',
  fixing: 'wrench',
  passed: 'circle-check',
  failed: 'circle-x',
  'needs-you': 'hand',
  open: 'git-merge',
  merged: 'party-popper',
};

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
          const page = c.pr != null ? prPage(repo, c.pr) : null;
          const tap = page ? () => openOverlay(page) : act ? () => open(act) : undefined;
          const Card = tap ? 'button' : 'div';
          const title = c.pr ? `PR #${c.pr} ${c.title}` : c.title;
          const body = (
            <Card className={page ? 'fb-main' : `fb-card fb-${c.status} ${tap ? '' : 'fb-card-still'}`} onClick={tap} title={page ? `Open PR #${c.pr}'s page` : title}>
              <span className="fb-thumb" aria-hidden>
                {c.shot ? (
                  <img src={c.shot} alt="" loading="lazy" />
                ) : (
                  <span className="fb-thumb-glyph">
                    <Icon name={c.status === 'live' ? 'monitor' : GLYPH[c.status]} />
                  </span>
                )}
                {c.preview === 'running' && <span className="fb-running"><Icon name="circle-dot" /> live</span>}
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
                  <Icon name={GLYPH[c.status]} /> {BUILD_LABEL[c.status]}
                </span>
              </span>
              {label && !page && (
                <span className="fb-open">
                  {label} <Icon name="chevron-right" />
                </span>
              )}
            </Card>
          );
          return (
            <div key={c.key} role="listitem" className="fb-item">
              {page ? (
                <div className={`fb-card fb-split fb-${c.status}`} title={title}>
                  {body}
                  {act && label && (
                    <button type="button" className="fb-open fb-open-btn" onClick={() => open(act)}>
                      {label} <Icon name="chevron-right" />
                    </button>
                  )}
                </div>
              ) : (
                body
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
