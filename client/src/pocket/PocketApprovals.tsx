// Pocket mode's Approvals tab: everything waiting on the manager's decision. Team changes (new agents and let-gos, the
// phone's cards), stuck PRs with the Kanban's Retry QA / Send back / Merge / Close, and passed PRs on floors that don't
// merge on their own, and charter changes the CEO proposed (#48). On a desktop (#104) a list beside the one picked.
import { Fragment, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { QaView, RepoView } from '../../../shared/types';
import { qaCardNote } from '../qaCard';
import { confirmDialog } from '../ui/Confirm';
import { Menu } from '../ui/Menu';
import { Resume } from '../ui/Phone';
import { ProposalCard } from '../ui/CharterTab';
import { waitingOnYou } from './pocketData';

function PrCard({ repo, qa, ready }: { repo: RepoView; qa: QaView; ready?: boolean }) {
  const author = useStore((s) => (qa.devAgentId ? s.agents[qa.devAgentId] : undefined));
  const [busy, setBusy] = useState(false);
  const pr = repo.pulls.find((p) => p.number === qa.prNumber);
  if (!pr) return null;
  const { note, tone } = qaCardNote(qa, pr, repo.autoMerge);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  };
  const merge = async () => {
    const ok = await confirmDialog(
      ready
        ? { icon: '🎉', title: `Merge PR #${pr.number}?`, body: `“${pr.title}” passed QA. It will be squash-merged into ${repo.defaultBranch}.`, confirm: 'Squash & merge' }
        : { tone: 'warn', title: `Merge PR #${pr.number} without QA?`, body: `“${pr.title}” has not passed QA. Merge it into ${repo.defaultBranch} anyway?`, confirm: 'Merge anyway' },
    );
    if (ok) await act(() => api.mergePull(repo.id, pr.number));
  };
  const sendBack = async () => {
    let text = '';
    const ok = await confirmDialog({
      icon: '🔧',
      title: `Send PR #${pr.number} back for a fix?`,
      body: (
        <>
          <p>Its author, or any free agent, fixes it with QA's findings, then it's tested once more.</p>
          <input maxLength={1000} placeholder="Optional note for whoever fixes it" aria-label="Note for whoever fixes it" onChange={(e) => (text = e.target.value)} />
        </>
      ),
      confirm: 'Send back',
    });
    if (ok) await act(() => api.sendBack(repo.id, pr.number, text.trim() || undefined));
  };
  const close = async () => {
    const ok = await confirmDialog({ tone: 'danger', title: `Close PR #${pr.number}?`, body: `“${pr.title}” will be closed without merging. The branch stays on GitHub.`, confirm: 'Close PR' });
    if (ok) await act(() => api.closePull(repo.id, pr.number));
  };
  return (
    <div className={`pk-card pk-pr kcard-${tone ?? 'plain'}`} style={{ ['--accent' as string]: repo.color }}>
      <div className="pk-pr-head">
        <span className="floor-badge">{repo.floor}</span>
        <div className="grow">
          <a href={pr.url} target="_blank" rel="noreferrer">
            <b>PR #{pr.number}</b>
          </a>{' '}
          {pr.title}
          <div className="muted small">
            {repo.fullName.split('/')[1]}
            {author ? ` · by ${author.name}` : ''} · round {qa.round} · {note}
          </div>
        </div>
      </div>
      {qa.summary && <div className="small pk-pr-summary">{qa.summary}</div>}
      {qa.commentUrl && (
        <a className="small" href={qa.commentUrl} target="_blank" rel="noreferrer">
          QA report ↗
        </a>
      )}
      <div className="pk-actions">
        {!ready && (
          <button className="btn btn-small btn-good" disabled={busy} onClick={() => void act(() => api.sendToQa(repo.id, pr.number))}>
            Retry QA
          </button>
        )}
        {!ready && (
          <button className="btn btn-small" disabled={busy} onClick={() => void sendBack()}>
            Send back
          </button>
        )}
        <button className={`btn btn-small ${ready ? 'btn-good' : ''}`} disabled={busy || pr.isDraft} onClick={() => void merge()}>
          {ready ? 'Merge' : 'Merge anyway'}
        </button>
        <span className="spacer" />
        <Menu label={`More for PR #${pr.number}`} title={`PR #${pr.number} ${pr.title}`} items={[{ label: 'Close PR…', hint: 'Closed without merging; the branch stays', danger: true, disabled: busy, onSelect: () => void close() }]} />
      </div>
    </div>
  );
}

/** One decision: its group's heading, its line in the desktop's list, and its card. */
interface Decision {
  key: string;
  group: string;
  label: string;
  card: ReactNode;
}

export function Approvals({ wide }: { wide?: boolean }) {
  const repos = useStore((s) => s.repos);
  const qa = useStore((s) => s.qa);
  const requests = useStore((s) => s.requests);
  const [picked, setPicked] = useState<string | null>(null);
  const w = waitingOnYou(repos, qa, requests);
  const charters = repos.filter((r) => r.charter.proposal);
  const pr = (s: (typeof w.stuck)[number]) => `PR #${s.qa.prNumber} ${s.repo.pulls.find((p) => p.number === s.qa.prNumber)?.title ?? ''}`;
  const items: Decision[] = [
    ...w.requests.map((r) => ({ key: `req:${r.id}`, group: '👥 Team changes', label: r.kind === 'hire' ? `Hire ${r.name}` : `Let ${r.name} go`, card: <Resume key={r.id} req={r} /> })),
    ...charters.map((r) => ({ key: `charter:${r.id}`, group: '🎯 Charter changes (edit them in ⚙️ → Charter)', label: `Floor ${r.floor} · ${r.fullName.split('/')[1]}`, card: <ProposalCard key={r.id} repo={r} proposal={r.charter.proposal!} /> })),
    ...w.stuck.map((s) => ({ key: `stuck:${s.repo.id}#${s.qa.prNumber}`, group: '⚠️ Pull requests that need you', label: pr(s), card: <PrCard key={`${s.repo.id}#${s.qa.prNumber}`} repo={s.repo} qa={s.qa} /> })),
    ...w.ready.map((s) => ({ key: `ready:${s.repo.id}#${s.qa.prNumber}`, group: '✅ Ready to merge', label: pr(s), card: <PrCard key={`${s.repo.id}#${s.qa.prNumber}`} repo={s.repo} qa={s.qa} ready /> })),
  ];
  const heading = (d: Decision, i: number) => (i === 0 || items[i - 1].group !== d.group ? d.group : null);
  if (items.length === 0) {
    return (
      <div className="pk-page">
        <p className="pk-empty">Nothing waits on you. The team carries on, and your phone hears when that changes.</p>
      </div>
    );
  }
  if (!wide) {
    return (
      <div className="pk-page">
        {items.map((d, i) => (
          <Fragment key={d.key}>
            {heading(d, i) && <h3 className="pk-h">{d.group}</h3>}
            {d.card}
          </Fragment>
        ))}
      </div>
    );
  }
  const open = items.find((d) => d.key === picked) ?? items[0];
  return (
    <div className="pk-page pk-split">
      <ul className="pk-split-list" aria-label="Decisions waiting on you">
        {items.map((d, i) => (
          <Fragment key={d.key}>
            {heading(d, i) && <li className="pk-h">{d.group}</li>}
            <li>
              <button className={`pk-split-item ${d === open ? 'pk-split-on' : ''}`} aria-current={d === open ? 'true' : undefined} onClick={() => setPicked(d.key)}>
                {d.label}
              </button>
            </li>
          </Fragment>
        ))}
      </ul>
      <div className="pk-split-detail">{open.card}</div>
    </div>
  );
}
