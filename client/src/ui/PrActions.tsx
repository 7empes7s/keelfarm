// PR decisions shared by the approvals room and every CardView entry point.
import { useId, useState } from 'react';
import type { PullInfo, QaView, RepoView } from '../../../shared/types';
import { mergeConfirmText, prActions, prDecision, prWhy, type PrAction } from '../../../shared/approvals';
import { api } from '../api';
import { useStore } from '../store';
import { confirmDialog } from './Confirm';
import { Menu } from './Menu';
import './prActions.css';

export function PrActions({ repo, qa, pr }: { repo: RepoView; qa: QaView; pr: PullInfo }) {
  const [busy, setBusy] = useState(false);
  const recId = useId();
  const openOverlay = useStore((s) => s.openOverlay);
  const why = prWhy(qa, pr);
  const ready = why === 'ready';
  const decision = prDecision(why, qa.round, repo.autoMerge, pr.checks);
  const order = prActions(qa.status, repo.autoMerge);
  const agentId = qa.status === 'testing' ? qa.qaAgentId : qa.status === 'fixing' ? qa.devAgentId : null;
  if (pr.state !== 'OPEN') return null;
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
  const actions: Record<PrAction, { label: string; run: () => Promise<void> }> = {
    merge: {
      label: ready ? 'Approve & merge' : 'Merge anyway',
      run: async () => {
        const t = mergeConfirmText(why, qa, pr, repo);
        const ok = await confirmDialog(t.warn ? { tone: 'warn', title: t.title, body: t.body, confirm: t.confirm } : { icon: 'party-popper', title: t.title, body: t.body, confirm: t.confirm });
        if (ok) await act(() => api.mergePull(repo.id, pr.number));
      },
    },
    retry: {
      label: 'Retry QA',
      run: async () => {
        const ok = await confirmDialog({ icon: 'search', title: `Retry QA on PR #${pr.number}?`, body: `A free agent tests it again as round ${qa.round + 1}. Nobody's work is stopped.`, confirm: 'Retry QA' });
        if (ok) await act(() => api.sendToQa(repo.id, pr.number));
      },
    },
    sendBack: {
      label: 'Send back',
      run: async () => {
        let text = '';
        const ok = await confirmDialog({
          icon: 'wrench',
          title: `Send PR #${pr.number} back for a fix?`,
          body: (
            <>
              <p>Its author, or any free agent, fixes it with QA's findings and your note, then it's tested once more.</p>
              <input maxLength={1000} placeholder="What should change? (optional)" aria-label="Note for whoever fixes it" onChange={(e) => (text = e.target.value)} />
            </>
          ),
          confirm: 'Send back',
        });
        if (ok) await act(() => api.sendBack(repo.id, pr.number, text.trim() || undefined));
      },
    },
    close: {
      label: 'Close PR…',
      run: async () => {
        const ok = await confirmDialog({ tone: 'danger', title: `Close PR #${pr.number}?`, body: `“${pr.title}” will be closed without merging. The branch stays on GitHub.`, confirm: 'Close PR' });
        if (ok) await act(() => api.closePull(repo.id, pr.number));
      },
    },
  };
  return (
    <div className="pr-actions">
      <div className="pr-action-row">
        {order.filter((k) => k !== 'close').map((k) => (
          <button key={k} className={`btn ${decision.recommend === k ? 'btn-good' : ''}`} disabled={busy || (k === 'merge' && pr.isDraft)} onClick={() => void actions[k].run()} aria-describedby={decision.recommend === k ? recId : undefined}>
            {actions[k].label}
          </button>
        ))}
        {agentId && <button className="btn" onClick={() => openOverlay({ kind: 'terminal', agentId })}>Terminal</button>}
        {order.includes('close') && <Menu label={`More for PR #${pr.number}`} title={`PR #${pr.number} ${pr.title}`} items={[{ label: actions.close.label, hint: 'Closed without merging; the branch stays', danger: true, disabled: busy, onSelect: () => void actions.close.run() }]} />}
      </div>
      {decision.recommend && order.includes(decision.recommend) && <p id={recId} className="muted small">Recommended: {actions[decision.recommend].label}</p>}
    </div>
  );
}
