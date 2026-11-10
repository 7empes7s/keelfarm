// "Redo on Opus" (#332): the inputs of the CEO's finished automated jobs, kept in the state file so one can run again on
// the CEO's own model in a fresh session, what started each job for the CEO jobs log, and the redo itself. Pure.
import type { CeoJob } from './ceo.ts';
import { isAutomatedJob, redoRefusal } from '../shared/ceoModels.ts';
import type { CeoJobKind } from '../shared/types.ts';

/** A finished job, as a redo needs it (chat, plans and research too, so a redo of one is refused for its kind). */
export interface CeoJobRecord {
  id: number;
  kind: CeoJobKind;
  model: string;
  at: number; // when it ended
  usd: number;
  message: number | null; // its last chat message
  inputs: CeoJob; // the job as it ran: the same events, PR or floor
  redoneBy?: number; // the redo's job number, once one was queued
}

/** How many finished jobs keep their inputs: older ones can't be redone. */
export const KEEP_JOBS = 100;

/** `list` with the finished job kept, newest last; a chat's text stays in the chat itself. */
export function keepJob(list: readonly CeoJobRecord[], rec: CeoJobRecord): CeoJobRecord[] {
  const inputs = isAutomatedJob(rec.kind) ? rec.inputs : { kind: rec.inputs.kind, at: rec.inputs.at };
  return [...list.filter((r) => r.id !== rec.id), { ...rec, inputs }].slice(-KEEP_JOBS);
}

/** The job's inputs, without what only its run had (its number, the retry flag, the redo link). */
function jobInputs(job: CeoJob): CeoJob {
  const inputs = { ...job };
  delete inputs.id;
  delete inputs.onCeoModel;
  delete inputs.redo;
  return inputs;
}

/**
 * The redo of job `id`: the same inputs on the CEO's own model, in a fresh session (ceoJobSession), linked to the
 * first; or why it can't run (`status`: 404 when the job is no longer kept, else 400).
 */
export function redoJob(list: readonly CeoJobRecord[], id: number, ceoModel: string, now: number): { job: CeoJob } | { status: 400 | 404; error: string } {
  const rec = list.find((r) => r.id === id);
  const why = redoRefusal(rec, ceoModel);
  if (why || !rec) return { status: rec ? 400 : 404, error: why ?? '' };
  return { job: { ...jobInputs(rec.inputs), onCeoModel: true, redo: { job: rec.id, message: rec.message }, at: now } };
}

const ids = (xs: readonly number[]) => xs.map((n) => `#${n}`).join(', ');

/** What started a job, for the log: the schedule, the manager, office events, a stuck PR, or a redo. */
export function jobTrigger(job: CeoJob): string {
  if (job.redo) return `Redo of job #${job.redo.job}`;
  const asked = job.messageIds?.length ? `Your message${job.messageIds.length > 1 ? 's' : ''} ${ids(job.messageIds)}` : '';
  switch (job.kind) {
    case 'review':
      return job.by === 'manager' ? 'You asked (Review now)' : 'Schedule';
    case 'followup': {
      const ev = job.events ?? [];
      return `Event${ev.length === 1 ? '' : 's'} ${ev.map((e) => e.id).join(', ')}: ${ev.map((e) => e.label).join(', ')}`.slice(0, 200);
    }
    case 'triage':
      return `PR #${job.prNumber ?? '?'} stuck`;
    case 'onboard':
      return 'A new floor';
    case 'changes':
      return 'Your board changes';
    case 'plan':
      return asked || 'Your floor brief';
    default:
      return asked || 'You';
  }
}
