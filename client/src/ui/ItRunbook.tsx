// A runbook job's card in IT's chat (#611): what it installs and touches, each step's progress with its output, the
// health check's verdict, and Approve / Not now while it waits, Undo (with a confirmation) once it ran. The job's rules
// are the server's (server/itRunbook.ts); it comes in the IT desk's view.
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { ItRunbookView, RunbookStepState } from '../../../shared/itRunbook';
import { confirmDialog } from './Confirm';
import { Icon } from './Icon';
import type { IconName } from './icons';
import './itRunbook.css';

const STEP: Record<RunbookStepState, { icon: IconName; word: string }> = {
  waiting: { icon: 'circle', word: 'Waiting' },
  running: { icon: 'loader-circle', word: 'Running' },
  done: { icon: 'circle-check', word: 'Done' },
  failed: { icon: 'circle-x', word: 'Failed' },
  skipped: { icon: 'minus', word: 'Skipped' },
};

function status(j: ItRunbookView): string {
  const at = j.steps.findIndex((s) => s.state === 'running');
  switch (j.state) {
    case 'waiting':
      return 'Waiting for your Approve';
    case 'running':
      return `Step ${at + 1} of ${j.steps.length}`;
    case 'done':
      return j.check ? (j.check.ok ? 'Done · check green' : 'Done · check failed') : 'Done';
    case 'failed':
      return j.check && !j.check.ok ? 'Health check failed' : `Stopped at step ${j.steps.findIndex((s) => s.state === 'failed') + 1}`;
    case 'dismissed':
      return 'Not run';
    case 'undone':
      return 'Undone';
  }
}

function RunbookCard({ j }: { j: ItRunbookView }) {
  const [busy, setBusy] = useState(false);
  const done = j.steps.filter((s) => s.state === 'done').length;
  const act = (call: () => Promise<unknown>) => {
    setBusy(true);
    void call().catch(() => undefined).finally(() => setBusy(false)); // api() already toasted the error
  };
  const undo = async () => {
    const ok = await confirmDialog({ title: `Undo "${j.title}"?`, body: 'Every file it changed goes back, and what it created (folders, units, the Caddy block) is removed.', confirm: 'Undo all', tone: 'warn', icon: 'rotate-ccw' });
    if (ok) act(() => api.itRunbookUndo(j.id));
  };
  return (
    <section className={`it-card it-rb it-rb-${j.state}`} aria-label={`Runbook: ${j.title}`}>
      <div className="it-card-head">
        <b className="grow">
          <Icon name="clipboard-list" /> {j.title}
        </b>
        <span className="it-rb-status">{status(j)}</span>
      </div>
      <p className="it-why">{j.summary}</p>
      <progress className="it-rb-bar" max={j.steps.length} value={done} aria-label={`${done} of ${j.steps.length} steps done`} />
      {j.held && j.state === 'waiting' && <p className="muted small">Needs your tap: {j.held}.</p>}
      <details className="it-rb-steps" open={j.state === 'failed' || undefined}>
        <summary>
          {j.steps.length} steps · {j.source}
        </summary>
        <ol>
          {j.steps.map((s, i) => (
            <li key={i} className={`it-rb-step it-rb-step-${s.state}`}>
              <span className="it-rb-step-top">
                <Icon name={STEP[s.state].icon} label={STEP[s.state].word} />
                <code className="grow">{s.label}</code>
                {s.check && <span className="it-rb-tag">Check</span>}
              </span>
              {s.out && <pre className="it-rb-out">{s.out}</pre>}
            </li>
          ))}
        </ol>
      </details>
      {j.state === 'waiting' && (
        <div className="it-actions">
          <button type="button" className="btn btn-good" disabled={busy} onClick={() => act(() => api.itRunbook(j.id, true))}>
            <Icon name="play" /> Approve all {j.steps.length}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.itRunbook(j.id, false))}>
            Not now
          </button>
        </div>
      )}
      {j.undoable && j.state !== 'running' && j.state !== 'undone' && (
        <div className="it-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void undo()}>
            <Icon name="rotate-ccw" /> {busy ? 'Undoing…' : 'Undo'}
          </button>
        </div>
      )}
    </section>
  );
}

/** Under a runbook's latest message in IT's chat: its card, live from the IT desk. */
export function ItRunbookCard({ id }: { id: string }) {
  const j = useStore((s) => s.itDesk?.runbooks?.find((r) => r.id === id));
  return j ? <RunbookCard j={j} /> : null;
}
