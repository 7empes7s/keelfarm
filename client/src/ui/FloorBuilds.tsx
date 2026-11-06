// "What's new on this floor" (#129): a swipeable row of cards on a floor's board and its pocket Company card, one per
// recent build (floorBuilds.ts), each opening its preview, or the builder's terminal while there's nothing to run.
import { useMemo } from 'react';
import { useStore } from '../store';
import type { PreviewStatus } from '../../../shared/types';
import { BUILD_LABEL, floorBuilds, type BuildCard, type BuildStatus } from './floorBuilds';
import './floorBuilds.css';

const GLYPH: Record<BuildStatus, string> = { live: '🟢', building: '🔨', qa: '🔍', fixing: '🔧', passed: '✅', failed: '❌', 'needs-you': '🙋', open: '🔀', merged: '🟣' };

function action(preview: PreviewStatus | null): string {
  if (preview == null) return 'Watch them build';
  if (preview === 'error') return "Didn't run: see why";
  return preview === 'preparing' || preview === 'installing' || preview === 'starting' ? 'Starting…' : 'Open preview';
}

export function FloorBuilds({ repoId }: { repoId: string }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const prPreviews = useStore((s) => s.prPreviews);
  const openOverlay = useStore((s) => s.openOverlay);
  const cards = useMemo(() => (repo ? floorBuilds(repo, Object.values(agents), qa, prPreviews) : []), [repo, agents, qa, prPreviews]);
  if (!repo) return null;
  const open = (c: BuildCard) => {
    if (c.preview == null) return c.agentId && openOverlay({ kind: 'terminal', agentId: c.agentId });
    openOverlay({ kind: 'app', repoId, pr: c.status === 'merged' ? null : c.pr });
  };
  return (
    <section className="fb" aria-label={`What's new on floor ${repo.floor}`}>
      <h3 className="fb-head small">What's new</h3>
      <div className="fb-row" role="list">
        {cards.map((c) => {
          const agent = c.agentId ? agents[c.agentId] : undefined;
          return (
            <div key={c.key} role="listitem" className="fb-item">
              <button className={`fb-card fb-${c.status}`} onClick={() => open(c)} title={c.pr ? `PR #${c.pr} ${c.title}` : c.title}>
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
                <span className="fb-open">{action(c.preview)} ›</span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
