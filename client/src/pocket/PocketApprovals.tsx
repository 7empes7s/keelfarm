// Pocket mode's Approvals tab, a review room (#209): everything waiting on the manager's decision as cards grouped by
// why it needs them (QA blocked, only CI, a CI outage, a product or design decision, a team or charter change), with
// when it was asked, the counts on top and oldest-first or impact order. A phone opens one as a page with Back; a
// desktop (#104) shows the list beside the one picked. The detail pages are in ApprovalDetail.tsx.
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import type { PullInfo, QaView, RepoView } from '../../../shared/types';
import { Resume } from '../ui/TeamChanges';
import { ProposalCard } from '../ui/CharterTab';
import { waitingOnYou } from './pocketData';
import { DecisionCard, useMinute } from '../ui/Decisions';
import { DecisionLog } from '../ui/DecisionLog';
import { waitingDecisions } from '../../../shared/decisions';
import { impactOf, impactScore, prWaitLine, prWhy, waitLine, whySummary, WHY_LABELS, WHY_ORDER, type ApprovalWhy } from '../../../shared/approvals';
import { EmptyState } from '../ui/EmptyState';
import { useBackLayer } from '../ui/Panel';
import { DesignDetail, PrDetail, WhyTag } from './ApprovalDetail';
import './approvals.css';
import { Icon } from '../ui/Icon';
import { iconFor } from '../ui/icons';
import { HoverCard, PeekCard } from '../ui/HoverCard';
import { agoText, prAdvice } from '../ui/peekFacts';

type Dot = 'pass' | 'fail' | 'pending';

/** One thing waiting on the manager: its card in the list and its detail page. */
interface Item {
  key: string;
  why: ApprovalWhy;
  title: string;
  floor: number | null;
  color?: string;
  askedAt: number;
  openedAt: number | null;
  meta: string[]; // round, author…
  wait?: string | null; // a PR's "waiting 3 h 12 min: … → needs you" (#275)
  dots: Dot[];
  score: number; // the impact sort
  detail: ReactNode;
  /** The desktop list row's peek (#213): why it needs you and what to do. */
  peek: { why: string; recommend: string };
}

const dotsOf = (qa: QaView, pr: PullInfo): Dot[] => [
  ...qa.checks.map((c): Dot => (c.result === 'fail' ? 'fail' : 'pass')),
  ...pr.failedChecks.map((): Dot => 'fail'),
  ...pr.pendingChecks.map((): Dot => 'pending'),
  ...(pr.checks === 'passing' ? ['pass' as Dot] : []),
];

/** The items in the order the list shows: grouped by why (WHY_ORDER), each group oldest first or biggest impact first. */
function useItems(now: number): Item[] {
  const repos = useStore((s) => s.repos);
  const qa = useStore((s) => s.qa);
  const requests = useStore((s) => s.requests);
  const decisions = useStore((s) => s.decisions);
  const agents = useStore((s) => s.agents);
  const w = waitingOnYou(repos, qa, requests);
  const floorOf = (id: string) => repos.find((r) => r.id === id);
  const prItem = (repo: RepoView, q: QaView, ready: boolean): Item[] => {
    const pr = repo.pulls.find((p) => p.number === q.prNumber);
    if (!pr) return [];
    const why = prWhy(q, pr);
    const author = q.devAgentId ? agents[q.devAgentId]?.name : pr.author;
    const opened = Date.parse(pr.createdAt);
    return [
      {
        key: `pr:${repo.id}#${pr.number}`,
        why,
        title: `#${pr.number} ${pr.title}`,
        floor: repo.floor,
        color: repo.color,
        askedAt: q.stuckAt ?? q.updatedAt,
        openedAt: Number.isFinite(opened) ? opened : null,
        meta: [`round ${q.round}`, author ? `by ${author}` : ''].filter(Boolean),
        wait: prWaitLine(q, repo.defaultBranch, now),
        dots: dotsOf(q, pr),
        score: impactScore(impactOf(pr.files ?? [], pr.additions, pr.deletions)),
        detail: <PrDetail repo={repo} qa={q} pr={pr} why={why} now={now} />,
        peek: prAdvice(q, ready),
      },
    ];
  };
  return [
    ...w.requests.map((r): Item => {
      const repo = floorOf(r.repoId);
      return { key: `req:${r.id}`, why: 'team', title: r.kind === 'hire' ? `Hire ${r.name}` : `Let ${r.name} go`, floor: repo?.floor ?? null, color: repo?.color, askedAt: r.createdAt, openedAt: null, meta: [], dots: [], score: 0, detail: <TeamDetail key={r.id} req={r} now={now} />, peek: { why: r.reason || 'The CEO asked for this team change.', recommend: r.kind === 'hire' ? 'Read the résumé, then Hire or Decline' : 'Let them go, or Keep them' } };
    }),
    ...waitingDecisions(decisions, now)
      .filter((d) => d.kind === 'suggestion' || d.kind === 'question' || (d.kind === 'design' && d.design))
      .map((d): Item => {
        const repo = d.repoIds[0] ? floorOf(d.repoIds[0]) : undefined;
        const design = d.kind === 'design';
        return {
          key: d.id,
          why: design ? 'design' : 'product',
          title: design ? d.design!.title : d.question,
          floor: repo?.floor ?? null,
          color: repo?.color,
          askedAt: d.askedAt,
          openedAt: null,
          meta: design ? [`${d.options.length} options`] : d.raised > 1 ? [`asked ${d.raised}×`] : [],
          dots: [],
          score: 0,
          detail: design ? <DesignDetail key={d.id} d={d} now={now} /> : <DecisionCard key={d.id} d={d} now={now} />,
          peek: { why: d.context || 'The CEO asked you in the chat.', recommend: d.options.length ? `Answer: ${d.options.slice(0, 3).join(' / ')}` : 'Answer it in the chat' },
        };
      }),
    ...repos
      .filter((r) => r.charter.proposal)
      .map((r): Item => ({ key: `charter:${r.id}`, why: 'charter', title: `Charter change on ${r.fullName.split('/')[1]}`, floor: r.floor, color: r.color, askedAt: r.charter.proposal!.at, openedAt: null, meta: [], dots: [], score: 0, detail: <ProposalCard key={r.id} repo={r} proposal={r.charter.proposal!} />, peek: { why: r.charter.proposal!.reason || `${r.charter.proposal!.by} proposed a charter change.`, recommend: 'Read the change, then Approve or Dismiss' } })),
    ...w.stuck.flatMap((s) => prItem(s.repo, s.qa, false)),
    ...w.ready.flatMap((s) => prItem(s.repo, s.qa, true)),
  ];
}

const sortItems = (items: Item[], by: 'oldest' | 'impact') =>
  [...items].sort((a, b) => WHY_ORDER.indexOf(a.why) - WHY_ORDER.indexOf(b.why) || (by === 'impact' ? b.score - a.score : 0) || a.askedAt - b.askedAt);

function TeamDetail({ req, now }: { req: Parameters<typeof Resume>[0]['req']; now: number }) {
  const team = useStore((s) => Object.values(s.agents).filter((a) => a.repoId === req.repoId && a.role !== 'ceo').length);
  const after = req.kind === 'hire' ? team + 1 : Math.max(0, team - 1);
  return (
    <div className="apr-detail">
      <section className="pk-card apr-section apr-header" aria-label={req.kind === 'hire' ? `Hire ${req.name}` : `Let ${req.name} go`}>
        <div className="apr-chips">
          <WhyTag why="team" />
        </div>
        <div className="small">{waitLine(req.createdAt, null, now)}</div>
        <p className="small">
          If approved: the floor goes from {team} to {after} agent{after === 1 ? '' : 's'}
          {after > 0 ? `, each taking about ${Math.round(100 / after)}% of its work and its share of the plan's usage` : ''}.
        </p>
      </section>
      <Resume req={req} />
    </div>
  );
}

/** "20 need you · 17 only CI · 2 product": a bar of the groups and their counts. */
function Summary({ items }: { items: Item[] }) {
  const s = whySummary(items.map((i) => i.why));
  return (
    <div className="pk-card apr-progress" aria-label={`${s.total} need you`}>
      <div className="apr-bar" aria-hidden>
        {s.parts.map((p) => (
          <span key={p.why} className={`apr-seg apr-why-${p.why}`} style={{ flexGrow: p.n }} />
        ))}
      </div>
      <p className="small apr-wrap">
        <b>{s.total} need you</b>
        {s.parts.map((p) => (
          <Fragment key={p.why}>
            {' · '}
            <span className="nowrap">
              {p.n} {WHY_LABELS[p.why].short}
            </span>
          </Fragment>
        ))}
      </p>
    </div>
  );
}

/** A list row; on the desktop's split it peeks on hover (#213). */
function Row({ item, now, on, peek, onOpen }: { item: Item; now: number; on: boolean; peek?: boolean; onOpen: () => void }) {
  const row = (
    <button className={`pk-card apr-row ${on ? 'apr-row-on' : ''}`} aria-current={on ? 'true' : undefined} onClick={onOpen} style={{ ['--accent' as string]: item.color }}>
      <span className="apr-chips">
        <WhyTag why={item.why} />
        {item.floor !== null && <span className="apr-floor">Floor {item.floor}</span>}
      </span>
      <span className="apr-row-title">{item.title}</span>
      <span className="muted small">{[waitLine(item.askedAt, item.openedAt, now), ...item.meta].join(' · ')}</span>
      {item.wait && <span className="small">{item.wait}</span>}
      {item.dots.length > 0 && (
        <span className="apr-dots" aria-label={`${item.dots.filter((d) => d === 'fail').length} failing, ${item.dots.filter((d) => d === 'pass').length} passing checks`}>
          {item.dots.slice(0, 12).map((d, i) => (
            <span key={i} className={`apr-dot apr-dot-${d}`} />
          ))}
        </span>
      )}
    </button>
  );
  if (!peek) return row;
  return (
    <HoverCard label={item.title} peek={<PeekCard title={item.title} sub={`Asked ${agoText(item.askedAt, Date.now())}`} note={item.peek.why} stats={[['Recommended', item.peek.recommend]]} />}>
      {row}
    </HoverCard>
  );
}

/** The pocket's scrolling element, shared by the list and its detail pages. */
const SCROLLER = '.pk-main';

/** A phone's detail page: Back on top, and the back gesture closes it, not the app. */
function Page({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  useBackLayer(onBack);
  const page = useRef<HTMLDivElement>(null);
  // it opens at its top, not at the list's scroll offset (a block: Chrome's scrollTo can return a promise, which React
  // would take for a cleanup)
  useLayoutEffect(() => {
    page.current?.closest(SCROLLER)?.scrollTo(0, 0);
  }, []);
  return (
    <div className="pk-page apr-page" ref={page}>
      <button className="btn btn-small btn-ghost apr-back" onClick={onBack}>
        <Icon name="chevron-left" /> Approvals
      </button>
      {children}
    </div>
  );
}

export function Approvals({ wide }: { wide?: boolean }) {
  const now = useMinute();
  const [picked, setPicked] = useState<string | null>(null);
  const [by, setBy] = useState<'oldest' | 'impact'>('oldest');
  const items = sortItems(useItems(now), by);
  const listRef = useRef<HTMLDivElement>(null);
  const listTop = useRef<number | null>(null);
  // Back returns to where the list was
  useLayoutEffect(() => {
    if (picked !== null || listTop.current === null) return;
    listRef.current?.closest(SCROLLER)?.scrollTo(0, listTop.current);
    listTop.current = null;
  }, [picked]);
  const pick = (key: string) => {
    if (!wide) listTop.current = listRef.current?.closest(SCROLLER)?.scrollTop ?? null;
    setPicked(key);
  };
  const log = <DecisionLog heading={(t) => <h3 className="pk-h">{t}</h3>} />;
  if (items.length === 0) {
    return (
      <div className="pk-page">
        <EmptyState kind="approvals" />
        {log}
      </div>
    );
  }
  const open = items.find((d) => d.key === picked) ?? (wide ? items[0] : undefined);
  if (!wide && open) return <Page onBack={() => setPicked(null)}>{open.detail}</Page>;
  const heading = (d: Item, i: number) => (i === 0 || items[i - 1].why !== d.why ? WHY_LABELS[d.why] : null);
  const list = (
    <div className="apr-list-col" ref={listRef}>
      <Summary items={items} />
      <div className="apr-sort" role="group" aria-label="Sort">
        {(['oldest', 'impact'] as const).map((k) => (
          <button key={k} className={`btn btn-small ${by === k ? '' : 'btn-ghost'}`} aria-pressed={by === k} onClick={() => setBy(k)}>
            {k === 'oldest' ? 'Oldest first' : 'Impact'}
          </button>
        ))}
      </div>
      <ul className="apr-rows" aria-label="Decisions waiting on you">
        {items.map((d, i) => {
          const h = heading(d, i);
          return (
            <Fragment key={d.key}>
              {h && (
                <li className="pk-h apr-group">
                  <Icon name={iconFor(h.icon, 'circle-help')} /> {h.label}
                  {d.why === 'charter' && <span className="muted small"> (edit them in Settings → Charter)</span>}
                </li>
              )}
              <li>
                <Row item={d} now={now} on={wide === true && d === open} peek={wide} onOpen={() => pick(d.key)} />
              </li>
            </Fragment>
          );
        })}
      </ul>
      {log}
    </div>
  );
  if (!wide) return <div className="pk-page">{list}</div>;
  return (
    <div className="pk-page pk-split apr-split">
      {list}
      <div className="pk-split-detail">{open?.detail}</div>
    </div>
  );
}
