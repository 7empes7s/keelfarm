// "Redo on Opus" (#332): an automated CEO job's line under its reply in the chat (the job, the model it ran on, the
// links between a job and its redo), and the action itself, shared with the CEO jobs log. Asks once, with what the
// redo will roughly cost, then queues the same job on the CEO model in a fresh session.
import { api } from '../api';
import { fmtUsd } from '../ops';
import { useStore } from '../store';
import { CLAUDE_MODELS, modelLabel } from '../../../shared/models';
import { isAutomatedJob, redoEstimate } from '../../../shared/ceoModels';
import { CEO_ID, type CeoJobKind, type CeoJobTag } from '../../../shared/types';
import { confirmDialog } from './Confirm';
import { Icon } from './Icon';
import './ceoJobs.css';

export const JOB_KIND_NAMES: Partial<Record<CeoJobKind, string>> = { review: 'review', followup: 'follow-up', triage: 'triage' };

/** The CEO's own model, and its family for the labels ("Opus"). */
export function useCeoModel() {
  const model = useStore((s) => s.agents[CEO_ID]?.model) || CLAUDE_MODELS[0];
  return { model, family: modelLabel(model).split(' ')[0] };
}

/** Whether a job's Redo is offered: an automated job that ran on another model than the CEO's, not redone yet. */
export const redoable = (j: { kind: CeoJobKind; model: string }, redone: boolean, ceoModel: string) => isAutomatedJob(j.kind) && j.model !== ceoModel && !redone;

/** Asks once, then queues the redo; api() toasts a refusal. */
export async function askRedo(j: { job: number; kind: CeoJobKind; model: string; usd?: number }, ceo: { model: string; family: string }) {
  const est = redoEstimate(j.usd ?? 0, j.model, ceo.model);
  const ok = await confirmDialog({
    title: `Run this ${JOB_KIND_NAMES[j.kind] ?? 'job'} again on ${ceo.family}?`,
    body: `${est !== null ? `About ${fmtUsd(est)}. ` : ''}The same job with the same inputs, on ${modelLabel(ceo.model)} in a fresh session. Its reply links back to this one.`,
    icon: 'refresh-cw',
    confirm: `Redo on ${ceo.family}`,
  });
  if (ok) await api.redoCeoJob(j.job).catch(() => undefined);
}

/** The line under an automated job's reply: what ran it, its redo's links, and Redo on Opus when it ran on another model. */
export function CeoJobLine({ tag, onJump }: { tag: CeoJobTag; onJump: (id: number) => void }) {
  const ceo = useCeoModel();
  const link = (l: { job: number; message: number | null }) =>
    l.message !== null ? (
      <button type="button" className="ceo-job-link" onClick={() => onJump(l.message!)}>
        message #{l.message}
      </button>
    ) : (
      <>job #{l.job}</>
    );
  return (
    <div className="ceo-job small">
      <span className="muted">
        {(JOB_KIND_NAMES[tag.kind] ?? 'Job').replace(/^./, (c) => c.toUpperCase())} #{tag.job} · {modelLabel(tag.model)}
      </span>
      {tag.redoOf && <span className="muted">Redone on {modelLabel(tag.model).split(' ')[0]} from {link(tag.redoOf)}</span>}
      {tag.redoneBy && <span className="muted">Redone on {ceo.family}: {link(tag.redoneBy)}</span>}
      {redoable(tag, !!tag.redoneBy, ceo.model) && (
        <button type="button" className="btn btn-small" onClick={() => void askRedo(tag, ceo)}>
          <Icon name="refresh-cw" /> Redo on {ceo.family}
        </button>
      )}
    </div>
  );
}
