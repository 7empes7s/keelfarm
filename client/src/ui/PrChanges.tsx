// "What this PR changes" (#203): beside a PR's preview, its goal, the pages to look at (tap one and the preview
// loads it), the agent testing or fixing it live, before/after, and QA's verdict and report. A side column on a
// computer, a pull-up sheet on a phone; open the first time each PR is viewed.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PullInfo, QaView, RepoView } from '../../../shared/types';
import { screenshotUrl } from '../screenshot';
import { qaKey, useStore } from '../store';
import { QA_BADGE, qaShotUrl, type Channel } from './channels';
import { Markdown } from './Markdown';
import { HoverCard } from './HoverCard';
import { QaPeek } from './Peeks';
import { cardOpen, liveAgent, openingPath, pagePath, prPages, remember, type PrMemory, type PrPage } from './prChangesRules';
import './prChanges.css';
import { CloseButton, Icon } from './Icon';
import type { IconName } from './icons';

const MEMORY_KEY = 'cubefarm:prChanges';

function loadMemory(): PrMemory {
  try {
    const m = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? 'null');
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

function note(key: string, patch: { path?: string; closed?: boolean }) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(remember(loadMemory(), key, patch, Date.now())));
  } catch {
    // a private window: nothing remembered
  }
}

/**
 * The card's state for the channel on screen: its pages, the path the preview shows (the first page the first time,
 * then where it was left), the live agent and Follow, and whether the card is open. `sheet`: shown as a phone's sheet.
 */
export function usePrChanges(repo: RepoView | undefined, channel: Channel, forceOpen?: boolean, sheet = false) {
  const pull = repo && channel != null ? repo.pulls.find((p) => p.number === channel) : undefined;
  const key = repo && pull ? qaKey(repo.id, pull.number) : null;
  const qa = useStore((s) => (key ? s.qa[key] : undefined));
  const agent = useStore((s) => (repo && pull ? liveAgent(s.agents, repo.id, pull.number) : null));
  const fullName = repo?.fullName;
  const files = pull?.files;
  const pages = useMemo(() => (fullName ? prPages(fullName, qa?.shots, files) : []), [fullName, files, qa?.shots]);
  const [at, setAt] = useState<{ key: string; path: string } | null>(null);
  const [follow, setFollow] = useState(false);
  const [open, setOpenState] = useState(true);
  const opened = useRef<string | null>(null);
  const first = pages[0]?.path;

  // A PR newly on screen: where it opens, and the card as it was left.
  useEffect(() => {
    if (!key || opened.current === key) return;
    opened.current = key;
    const memory = loadMemory();
    const r = openingPath(memory, key, first, Date.now());
    if (r.memory !== memory) note(key, { path: r.path });
    setAt({ key, path: r.path });
    setFollow(false);
    setOpenState(!!forceOpen || cardOpen(memory, key, sheet && !first));
  }, [key, first, forceOpen, sheet]);

  // Follow: the preview goes where the agent's browser goes, while they're on it.
  const livePage = pagePath(agent?.browserUrl);
  useEffect(() => {
    if (!agent) setFollow(false);
    else if (follow && livePage && key) setAt({ key, path: livePage });
  }, [follow, livePage, key, agent]);

  return {
    pull,
    qa,
    agent,
    livePage,
    pages,
    path: key && at?.key === key ? at.path : '/',
    follow,
    setFollow,
    open,
    /** The manager picks a page: the preview loads it, remembered, and Follow stops. */
    openPage: (path: string) => {
      if (!key) return;
      setFollow(false);
      setAt({ key, path });
      note(key, { path });
    },
    setOpen: (v: boolean) => {
      setOpenState(v);
      if (key) note(key, { closed: !v });
    },
  };
}

export type PrChangesState = ReturnType<typeof usePrChanges>;

const CHECKS_LABEL: Record<PullInfo['checks'], { icon: IconName | null; text: string }> = {
  passing: { icon: 'circle-check', text: 'passing' },
  failing: { icon: 'circle-x', text: 'failing' },
  pending: { icon: 'hourglass', text: 'running' },
  none: { icon: null, text: 'none' },
};
const CHECK_ICON: Record<'pass' | 'fail' | 'skip', IconName> = { pass: 'circle-check', fail: 'circle-x', skip: 'skip-forward' };

/** The card. `sheet`: a phone's pull-up sheet, its handle always showing; otherwise the side column. */
export function PrChangesCard({ repo, pull, state, sheet, onCompare }: { repo: RepoView; pull: PullInfo; state: PrChangesState; sheet: boolean; onCompare: () => void }) {
  const { qa, agent, livePage, pages, path, follow, setFollow, open, openPage, setOpen } = state;
  const box = useRef<HTMLDivElement>(null);
  const shots = qa?.shots ?? [];
  const issue = repo.issues.find((i) => pull.closesIssues.includes(i.number));
  const jump = (part: string) => box.current?.querySelector(`[data-part="${part}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const title = 'What this PR changes';

  if (sheet && !open) {
    return (
      <button className="prc prc-sheet prc-peek" onClick={() => setOpen(true)} aria-expanded={false}>
        <Icon name="clipboard-list" />
        <b>{title}</b>
        <span className="muted small">
          {pages.length} {pages.length === 1 ? 'page' : 'pages'}
          {qa ? ` · ${QA_BADGE[qa.status].text}` : ''}
          {agent ? ` · @${agent.name} live` : ''}
        </span>
      </button>
    );
  }
  return (
    <aside ref={box} className={`prc ${sheet ? 'prc-sheet' : 'prc-side'}`} aria-label={`${title}: PR #${pull.number}`}>
      <div className="prc-head">
        {sheet && <span className="prc-grip" aria-hidden />}
        <h4 className="prc-title">{title}</h4>
        {sheet ? (
          <button className="panel-x" onClick={() => setOpen(false)} aria-label="Lower the sheet">
            <Icon name="chevron-down" />
          </button>
        ) : (
          <CloseButton className="panel-x" onClick={() => setOpen(false)} label="Hide what this PR changes" />
        )}
      </div>

      <section className="prc-goal">
        <div className="small">
          <a href={pull.url} target="_blank" rel="noreferrer">
            PR #{pull.number} <Icon name="external-link" />
          </a>{' '}
          {issue ? (
            <>
              closes{' '}
              <a href={issue.url} target="_blank" rel="noreferrer">
                #{issue.number}
              </a>
            </>
          ) : null}
        </div>
        <b className="prc-goal-title">{issue?.title ?? pull.title}</b>
        {pull.summary && <p className="prc-goal-text">{pull.summary}</p>}
      </section>

      <div className="prc-stats" role="group" aria-label="At a glance">
        <a className="prc-stat" href={`${pull.url}/files`} target="_blank" rel="noreferrer">
          <b>{pull.files?.length ?? 0}</b>
          <span>files</span>
        </a>
        <button className="prc-stat" onClick={() => jump('pages')}>
          <b>{pages.length}</b>
          <span>pages</span>
        </button>
        <button className="prc-stat" onClick={() => jump('qa')}>
          <b>{qa?.round ?? 0}</b>
          <span>QA rounds</span>
        </button>
        <button className="prc-stat" onClick={() => jump('shots')}>
          <b>{shots.length}</b>
          <span>shots</span>
        </button>
      </div>

      {agent && (
        <section className="prc-live" aria-live="polite">
          <button className="prc-live-main" onClick={() => livePage && openPage(livePage)} disabled={!livePage} title="Open their page in the preview">
            {agent.screenshotAt ? <img src={screenshotUrl(agent.id, agent.screenshotAt)} alt={`${agent.name}'s screen`} /> : <span className="prc-live-dot" aria-hidden />}
            <span className="prc-live-text">
              <b>@{agent.name}</b> {agent.task === 'fix' ? 'is fixing it' : 'is testing it'}
              {livePage && (
                <>
                  {' '}
                  on <code>{livePage}</code>
                </>
              )}
            </span>
          </button>
          <button className={`btn btn-small ${follow ? 'btn-on' : ''}`} aria-pressed={follow} onClick={() => setFollow(!follow)} title="The preview goes where their browser goes, until you pick a page">
            {follow ? (
              <>
                <Icon name="locate-fixed" /> Following
              </>
            ) : (
              <>
                <Icon name="locate" /> Follow
              </>
            )}
          </button>
        </section>
      )}

      <section data-part="pages">
        <h5 className="prc-h">Pages to look at</h5>
        {pages.length ? (
          <ul className="prc-pages">
            {pages.map((p: PrPage) => (
              <li key={p.path}>
                <button className={`prc-page ${p.path === path ? 'prc-page-on' : ''}`} aria-current={p.path === path || undefined} onClick={() => openPage(p.path)}>
                  {p.shot != null && qa ? <img src={qaShotUrl(repo.id, pull.number, p.shot, qa.updatedAt)} alt="" loading="lazy" /> : <span className="prc-page-glyph" aria-hidden><Icon name="file-text" /></span>}
                  <span className="prc-page-text">
                    <span>{p.caption}</span>
                    <code>{p.path}</code>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No pages recorded yet.</p>
        )}
        <button className="btn btn-small" onClick={onCompare}>
          <Icon name="arrow-left-right" /> Before / after on <code>{path}</code>
        </button>
      </section>

      <section data-part="qa" className="prc-qa">
        <h5 className="prc-h">QA</h5>
        <div className="qa-side-meta small">
          <span>
            +{pull.additions} −{pull.deletions}
          </span>
          <a href={`${pull.url}/checks`} target="_blank" rel="noreferrer">
            Checks: {CHECKS_LABEL[pull.checks].icon && <Icon name={CHECKS_LABEL[pull.checks].icon!} />} {CHECKS_LABEL[pull.checks].text}
          </a>
          {pull.isDraft && <span>draft</span>}
        </div>
        {pull.failedChecks.length > 0 && (
          <ul className="qa-failed small">
            {pull.failedChecks.map((c) => (
              <li key={c.name}>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer">
                    <Icon name="circle-x" /> {c.name}
                  </a>
                ) : (
                  <>
                    <Icon name="circle-x" /> {c.name}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {qa ? <QaReport repo={repo} pull={pull} qa={qa} /> : <p className="muted small">QA hasn't tested this PR yet.</p>}
      </section>
    </aside>
  );
}

/** QA's verdict, round and latest report with its screenshots. */
function QaReport({ repo, pull, qa }: { repo: RepoView; pull: PullInfo; qa: QaView }) {
  const shots = qa.shots ?? [];
  return (
    <>
      <div className="qa-side-status">
        <HoverCard label={`QA on PR #${qa.prNumber}`} peek={<QaPeek qa={qa} />}>
          <span className={`qa-badge qa-badge-${qa.status}`} tabIndex={0}>
            <Icon name={QA_BADGE[qa.status].icon} /> {QA_BADGE[qa.status].text}
          </span>
        </HoverCard>
        <span className="muted small">round {qa.round}</span>
        {qa.commentUrl && (
          <a className="small" href={qa.commentUrl} target="_blank" rel="noreferrer">
            Full report <Icon name="external-link" />
          </a>
        )}
      </div>
      {qa.summary ? <Markdown className="qa-summary" text={qa.summary} /> : <p className="muted small">{qa.status === 'testing' ? 'QA is testing it now.' : 'No QA report yet.'}</p>}
      {qa.checks.length > 0 && (
        <ul className="qa-checks">
          {qa.checks.map((c, i) => (
            <li key={i} className={`qa-check qa-check-${c.result}`}>
              <span aria-label={c.result}><Icon name={CHECK_ICON[c.result]} /></span>
              <div>
                <b>{c.name}</b>
                {c.details && <div className="muted small">{c.details}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div data-part="shots">
        {shots.length > 0 && (
          <div className="qa-shots">
            {shots.map((s, i) => {
              const url = qaShotUrl(repo.id, pull.number, i, qa.updatedAt);
              return (
                <a key={i} className="qa-shot" href={url} target="_blank" rel="noreferrer" title={s.page ?? s.caption}>
                  <img src={url} alt={s.caption} loading="lazy" />
                  <span className="small">{s.caption}</span>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
