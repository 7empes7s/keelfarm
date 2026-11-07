// Design proposals (#209): a style or UX change the CEO puts to the manager with options and screenshots, kept as an
// open decision of kind 'design' (shared/decisions.ts). The manager's pick goes back as a reply to the chat message
// that presented it, so the CEO hears it like any answer and the decision closes (onManagerMessage). Pure.
import type { Decision } from './decisions.ts';
import type { FileRef } from './files.ts';

interface DesignOption {
  label: string;
  shots: FileRef[]; // its screenshots, in the office's files store
  previewUrl: string | null;
}

export interface DesignProposal {
  floor: number;
  title: string;
  issue: number | null;
  options: DesignOption[];
}

/** The open decision a propose_design call makes, tied to the chat message that presented it. */
export function designDecision(p: DesignProposal & { question: string; repoId: string }, messageId: number, now: number): Decision {
  const { question, repoId, ...design } = p;
  return {
    id: `design:${messageId}`,
    kind: 'design',
    question,
    context: design.title,
    options: design.options.map((o) => o.label),
    repoIds: [repoId],
    about: design.issue !== null ? [{ kind: 'issue', repoId, number: design.issue }] : [],
    messageId,
    askedAt: now,
    lastAskedAt: now,
    raised: 1,
    status: 'open',
    snoozedUntil: null,
    closedAt: null,
    outcome: null,
    design,
  };
}

/** The option's letter: A, B, C. */
export const optionLetter = (i: number) => String.fromCharCode(65 + i);

/** The manager's answer, sent as a reply to the proposal's message: the pick (or "changes"), then their note. */
export function designAnswer(d: Pick<Decision, 'options' | 'design'>, pick: number | 'changes', note = ''): string {
  const title = d.design?.title ?? 'the design';
  const head = pick === 'changes' ? `Design “${title}”: none yet, please change it.` : `Design “${title}”: I pick ${optionLetter(pick)}, ${d.options[pick]}.`;
  const n = note.trim();
  return n ? `${head} ${n}` : head;
}
