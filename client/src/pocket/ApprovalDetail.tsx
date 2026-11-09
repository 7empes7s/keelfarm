// The Approvals' detail pages (#209): a PR as a review room (header, the decision with the CEO's diagnosis, what's
// failing, steps, impact, preview, evidence, actions) and a design proposal (options with their shots side by side, a
// before/after slider, the pick going back to the CEO). Sections are cards; the long ones are disclosure groups.
import { useState, type ReactNode } from 'react';
import { useStore } from '../store';
import type { PullInfo, QaView, RepoView } from '../../../shared/types';
import type { Decision } from '../../../shared/decisions';
import { impactOf, prDecision, prWaitLine, waitLine, WHY_LABELS, type ApprovalWhy } from '../../../shared/approvals';
import { designAnswer, optionLetter } from '../../../shared/designs';
import { confirmDialog } from '../ui/Confirm';
import { PrActions } from '../ui/PrActions';
import { qaShotUrl } from '../ui/channels';
import { sendToCeo } from '../ui/chatSend';
import { Icon } from '../ui/Icon';
import { iconFor, type IconName } from '../ui/icons';

const CHECK_ICON: Record<'pass' | 'fail' | 'skip', IconName> = { pass: 'circle-check', fail: 'circle-x', skip: 'skip-forward' };
const fileUrl = (id: string) => `/api/files/${id}`;

/** A section card; `fold`: a disclosure group, closed until tapped. */
function Section({ title, fold, children }: { title: string; fold?: boolean; children: ReactNode }) {
  if (fold) {
    return (
      <details className="pk-card apr-section">
        <summary className="apr-summary">{title}</summary>
        {children}
      </details>
    );
  }
  return (
    <section className="pk-card apr-section" aria-label={title}>
      <h4 className="apr-h">{title}</h4>
      {children}
    </section>
  );
}

/** The why tag, as on the list's cards. */
export function WhyTag({ why }: { why: ApprovalWhy }) {
  const w = WHY_LABELS[why];
  return (
    <span className={`apr-why apr-why-${why}`}>
      <Icon name={iconFor(w.icon, 'circle-help')} /> {w.label}
    </span>
  );
}

const ceoName = () => Object.values(useStore.getState().agents).find((a) => a.role === 'ceo')?.name ?? 'the CEO';

// ---------- a PR ----------

export function PrDetail({ repo, qa, pr, why, now }: { repo: RepoView; qa: QaView; pr: PullInfo; why: ApprovalWhy; now: number }) {
  const author = useStore((s) => (qa.devAgentId ? s.agents[qa.devAgentId] : undefined));
  const openOverlay = useStore((s) => s.openOverlay);
  const decision = prDecision(why, qa.round, repo.autoMerge, pr.checks);
  const impact = impactOf(pr.files ?? [], pr.additions, pr.deletions);
  const opened = Date.parse(pr.createdAt);
  const asked = qa.stuckAt ?? qa.updatedAt;
  const wait = prWaitLine(qa, repo.defaultBranch, now);
  const repoUrl = pr.url.replace(/\/pull\/\d+$/, '');
  const ceo = ceoName();
  const ask = async () => {
    const ok = await confirmDialog({ icon: 'message-circle', title: `Ask ${ceo} about PR #${pr.number}?`, body: `${ceo} gets your question in the chat and answers there.`, confirm: 'Ask' });
    if (ok) sendToCeo(`What do you recommend for PR #${pr.number} on floor ${repo.floor} (“${pr.title}”)? It's in my Approvals as ${WHY_LABELS[why].label.toLowerCase()}.`);
  };
  const shots = qa.shots ?? [];
  return (
    <div className="apr-detail">
      <section className="pk-card apr-section apr-header" aria-label={`PR #${pr.number}`} style={{ ['--accent' as string]: repo.color }}>
        <div className="apr-chips">
          <span className="floor-badge">{repo.floor}</span>
          <WhyTag why={why} />
        </div>
        <h3 className="apr-title">
          <a href={pr.url} target="_blank" rel="noreferrer">
            PR #{pr.number}
          </a>{' '}
          {pr.title}
        </h3>
        <div className="muted small">
          {[repo.fullName.split('/')[1], author ? `by ${author.name}` : pr.author ? `by ${pr.author}` : '', `round ${qa.round}`].filter(Boolean).join(' · ')}
        </div>
        <div className="small">{waitLine(asked, Number.isFinite(opened) ? opened : null, now)}</div>
        {wait && <div className="small">{wait}</div>}
        {pr.closesIssues.length > 0 && (
          <div className="small">
            Closes{' '}
            {pr.closesIssues.map((n) => (
              <a key={n} href={`${repoUrl}/issues/${n}`} target="_blank" rel="noreferrer">
                #{n}{' '}
              </a>
            ))}
          </div>
        )}
      </section>

      <Section title="The decision">
        <p className="apr-lead">{decision.text}</p>
        {(qa.ceoNote || qa.stuckWhy) && (
          <div className="apr-ceo">
            <b>{qa.ceoNote ? `${ceo}'s diagnosis` : 'Why it stopped'}</b>
            <p>{qa.ceoNote ?? qa.stuckWhy}</p>
          </div>
        )}
        <PrActions repo={repo} qa={qa} pr={pr} />
        <div className="pk-actions">
          <button className="btn btn-small btn-ghost" onClick={() => void ask()}>Ask {ceo}</button>
        </div>
      </Section>

      <Section title="What's failing">
        {why === 'outage' && <p className="apr-badge-good">
            <Icon name="credit-card" /> Only CI or billing, not the code
          </p>}
        <ul className="apr-list">
          {pr.failedChecks.map((c) => (
            <li key={c.name}>
              <span aria-label="failed">
                <Icon name="circle-x" />
              </span>{' '}
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.name}
                </a>
              ) : (
                c.name
              )}
              <span className="muted small">{c.neverStarted ? ' · never started' : ' · failed'}</span>
            </li>
          ))}
          {pr.pendingChecks.map((n) => (
            <li key={n}>
              <span aria-label="pending">
                <Icon name="hourglass" />
              </span>{' '}
              {n} <span className="muted small">· running</span>
            </li>
          ))}
          {!pr.failedChecks.length && !pr.pendingChecks.length && (
            <li>
              {pr.checks === 'passing' ? (
                <>
                  <Icon name="circle-check" /> GitHub checks pass
                </>
              ) : pr.checks === 'none' ? 'No GitHub checks' : `GitHub checks: ${pr.checks}`}
              {pr.checkRun && <span className="muted small"> · {Math.round(pr.checkRun.ms / 60_000)} min</span>}
            </li>
          )}
        </ul>
        {qa.checks.length > 0 && (
          <>
            <b className="small">QA, round {qa.round}</b>
            <ul className="apr-list">
              {qa.checks.map((c, i) => (
                <li key={i}>
                  <span aria-label={c.result}>
                    <Icon name={CHECK_ICON[c.result]} />
                  </span> <b>{c.name}</b>
                  {c.details && <div className="muted small">{c.details}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
        {qa.summary && <p className="small apr-wrap">{qa.summary}</p>}
        {qa.fixInstructions && (
          <div className="apr-ceo">
            <b>What has to change</b>
            <p className="apr-wrap">{qa.fixInstructions}</p>
          </div>
        )}
      </Section>

      <Section title="Steps" fold>
        <p className="small apr-wrap">{pr.summary || 'The PR body has no summary.'}</p>
        <p className="muted small">
          QA ran {qa.checks.length || 'no'} check{qa.checks.length === 1 ? '' : 's'} in round {qa.round}
          {qa.commentUrl ? '; ' : '.'}
          {qa.commentUrl && (
            <a href={qa.commentUrl} target="_blank" rel="noreferrer">
              the full QA report <Icon name="external-link" />
            </a>
          )}
        </p>
      </Section>

      <Section title="Impact">
        <div className="apr-chips">
          <span className="apr-stat">
            <b>+{impact.additions}</b> <b className="apr-minus">−{impact.deletions}</b>
          </span>
          {impact.areas.map((a) => (
            <span key={a.area} className="apr-stat">
              {a.area} · {a.files}
            </span>
          ))}
        </div>
        {impact.risks.length > 0 && (
          <div className="apr-chips">
            {impact.risks.map((r) => (
              <span key={r} className="apr-risk">
                <Icon name="triangle-alert" /> {r}
              </span>
            ))}
          </div>
        )}
        {impact.screens.length > 0 && <p className="small apr-wrap">Screens: {impact.screens.join(', ')}</p>}
        <p className="muted small">On merge: floor {repo.floor}'s {repo.defaultBranch} gets it{repo.preview ? ', and its preview restarts' : ''}.</p>
      </Section>

      <Section title="Preview">
        <p className="small">Runs this PR beside {repo.defaultBranch}, opening at the pages it changes, with Compare.</p>
        <div className="pk-actions">
          <button className="btn btn-small" onClick={() => openOverlay({ kind: 'app', repoId: repo.id, pr: pr.number })}>
            Open preview
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => openOverlay({ kind: 'app', repoId: repo.id, pr: pr.number, qa: true })}>
            With QA's panel
          </button>
        </div>
      </Section>

      <Section title={`Evidence${shots.length ? ` · ${shots.length}` : ''}`}>
        {shots.length ? (
          <div className="apr-gallery" role="list" aria-label="QA screenshots">
            {shots.map((s, i) => {
              const url = qaShotUrl(repo.id, pr.number, i, qa.updatedAt);
              return (
                <a key={i} role="listitem" className="apr-shot" href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt={s.caption} loading="lazy" />
                  <span className="small">{s.caption}</span>
                  {s.page && <span className="muted small">{s.page}</span>}
                </a>
              );
            })}
          </div>
        ) : (
          <p className="muted small">No screenshots from QA's latest round.</p>
        )}
        {qa.commentUrl && (
          <a className="small" href={qa.commentUrl} target="_blank" rel="noreferrer">
            <Icon name="file-text" /> QA report <Icon name="external-link" />
          </a>
        )}
      </Section>
    </div>
  );
}

// ---------- a design proposal ----------

/** Two shots on top of each other, the second revealed up to the slider: before/after on a phone. */
function Compare({ a, b, labels }: { a: string; b: string; labels: [string, string] }) {
  const [at, setAt] = useState(50);
  return (
    <div className="apr-compare">
      <div className="apr-compare-stage">
        <img src={fileUrl(a)} alt={labels[0]} />
        <img src={fileUrl(b)} alt={labels[1]} style={{ clipPath: `inset(0 0 0 ${at}%)` }} />
      </div>
      <input type="range" min={0} max={100} value={at} onChange={(e) => setAt(Number(e.target.value))} aria-label={`Slide between ${labels[0]} and ${labels[1]}`} />
      <div className="apr-compare-labels small">
        <span>{labels[0]}</span>
        <span>{labels[1]}</span>
      </div>
    </div>
  );
}

export function DesignDetail({ d, now }: { d: Decision; now: number }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === d.repoIds[0]));
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const design = d.design!;
  const ceo = ceoName();
  const firsts = design.options.map((o) => o.shots[0]?.id);
  const answer = async (pick: number | 'changes') => {
    const text = designAnswer(d, pick, note);
    const ok = await confirmDialog({ icon: 'palette', title: pick === 'changes' ? 'Ask for changes?' : `Pick ${optionLetter(pick)}?`, body: `${ceo} gets: “${text}” and passes it to the floor's agent.`, confirm: pick === 'changes' ? 'Ask for changes' : `Pick ${optionLetter(pick)}` });
    if (!ok) return;
    sendToCeo(text, d.messageId ?? undefined);
    setSent(text);
  };
  return (
    <div className="apr-detail">
      <section className="pk-card apr-section apr-header" aria-label={design.title} style={{ ['--accent' as string]: repo?.color }}>
        <div className="apr-chips">
          {repo && <span className="floor-badge">{repo.floor}</span>}
          <WhyTag why="design" />
        </div>
        <h3 className="apr-title">{design.title}</h3>
        <div className="muted small">{[`from ${ceo}`, waitLine(d.askedAt, null, now), design.issue ? `issue #${design.issue}` : ''].filter(Boolean).join(' · ')}</div>
        <p className="apr-lead">{d.question}</p>
      </section>
      {design.options.length === 2 && firsts[0] && firsts[1] && (
        <Section title="Before / after">
          <Compare a={firsts[0]} b={firsts[1]} labels={[`A · ${design.options[0].label}`, `B · ${design.options[1].label}`]} />
        </Section>
      )}
      <div className="apr-options">
        {design.options.map((o, i) => (
          <section key={i} className="pk-card apr-section apr-option" aria-label={`Option ${optionLetter(i)}: ${o.label}`}>
            <h4 className="apr-h">
              <span className="apr-letter">{optionLetter(i)}</span> {o.label}
            </h4>
            <div className="apr-gallery" role="list" aria-label={`Option ${optionLetter(i)} screenshots`}>
              {o.shots.map((s) => (
                <a key={s.id} role="listitem" className="apr-shot" href={fileUrl(s.id)} target="_blank" rel="noreferrer">
                  <img src={fileUrl(s.id)} alt={`${o.label}: ${s.name}`} loading="lazy" />
                  <span className="small">{s.name}</span>
                </a>
              ))}
            </div>
            <div className="pk-actions">
              <button className="btn btn-small btn-good" disabled={!!sent} onClick={() => void answer(i)}>
                Pick {optionLetter(i)}
              </button>
              {o.previewUrl && (
                <a className="btn btn-small btn-ghost" href={o.previewUrl} target="_blank" rel="noreferrer">
                  Live preview <Icon name="external-link" />
                </a>
              )}
            </div>
          </section>
        ))}
      </div>
      <Section title="Your answer">
        {sent ? (
          <p className="small">Sent to {ceo}: “{sent}”</p>
        ) : (
          <>
            <textarea className="apr-note" rows={2} maxLength={600} placeholder="A comment for the pick (optional)" aria-label="Comment for the pick" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="pk-actions">
              <button className="btn btn-small" onClick={() => void answer('changes')}>
                Ask for changes
              </button>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
