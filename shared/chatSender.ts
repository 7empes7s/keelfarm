// Who a CEO-chat item is really from (#679): the CEO's own replies stay bubbles headed by its name; research, IT, the
// CEO's background jobs, office events and agents' questions get a name, a glyph and a tinted card of their own. And a
// research job's card, updated in place as it moves (queued → running → done) instead of a new message each time. Pure.
import type { CeoJobKind, ChatOrigin, ChatResearch, PhoneMessage } from './types.ts';

/** Where a message came from, by its fields (an explicit `origin` first). 'manager' is the manager's own. */
export function chatOrigin(m: Pick<PhoneMessage, 'from' | 'origin' | 'research' | 'question' | 'background' | 'ceoJob'>): ChatOrigin | 'manager' {
  if (m.from === 'manager') return 'manager';
  if (m.origin) return m.origin;
  if (m.research) return 'research';
  if (m.question) return 'agent';
  if (m.background || (m.ceoJob && m.ceoJob.kind !== 'chat')) return 'job';
  return m.from === 'office' ? 'event' : 'ceo';
}

/** The names a sender's header uses. `agent`: the asking agent's, when known. */
export interface SenderNames {
  ceo: string;
  researcher: string;
  it: string;
  agent?: string;
}

/** A sender's header: its name, its role (shown after it), its Lucide glyph and the tint its card takes. */
export interface SenderLook {
  name: string;
  role: string | null;
  icon: string;
  tone: ChatOrigin;
}

export function senderLook(origin: ChatOrigin, n: SenderNames): SenderLook {
  switch (origin) {
    case 'research':
      return { name: n.researcher, role: 'Research', icon: 'telescope', tone: origin };
    case 'it':
      return { name: n.it, role: 'IT', icon: 'server', tone: origin };
    case 'job':
      return { name: n.ceo, role: 'background', icon: 'clock', tone: origin };
    case 'agent':
      return { name: n.agent || 'An agent', role: 'asks', icon: 'bot', tone: origin };
    case 'event':
      return { name: 'Office', role: null, icon: 'building-2', tone: origin };
    default:
      return { name: n.ceo, role: null, icon: 'user', tone: 'ceo' };
  }
}

const JOB_NAMES: Partial<Record<CeoJobKind, string>> = { review: 'Reviewing the company', followup: 'Following up', triage: 'Triaging a PR', plan: 'Planning', onboard: 'Onboarding a floor' };

/** A background card's job name: the one saved with it, else its job's kind (replies from before #679). */
export const jobName = (m: Pick<PhoneMessage, 'background' | 'ceoJob'>) => m.background || (m.ceoJob && JOB_NAMES[m.ceoJob.kind]) || 'Background job';

/** The asking agent's name in an agent question's text ("❓ Ada asks (floor 2…): …"), or undefined. */
export const askerName = (text: string) => /^❓\s*(.+?) asks\b/u.exec(text)?.[1];

/** A research card's state; briefs from before #679 have none and are done. */
export const researchState = (r: ChatResearch) => r.state ?? 'done';

/** Still going (queued or running): never read aloud or pushed, and updated in place. */
export const researchInterim = (r: ChatResearch | undefined) => !!r && (r.state === 'queued' || r.state === 'running');

/**
 * The research card a job's new state goes into: its card still in `messages` (the latest one for the job), updated
 * in place with `patch`. Null when there is none (it scrolled out, or the job had no card yet): post a new one.
 */
export function updateResearchCard(messages: PhoneMessage[], job: number, patch: Partial<PhoneMessage> & { research: ChatResearch }): PhoneMessage | null {
  const m = messages.findLast((x) => x.research?.job === job);
  if (!m) return null;
  Object.assign(m, patch);
  return m;
}

/**
 * The job's interim card, taken out of `messages` when its brief is posted (the brief takes its place at the end of
 * the chat, so one card per job). Null when it has none.
 */
export function takeResearchCard(messages: PhoneMessage[], job: number): PhoneMessage | null {
  const i = messages.findLastIndex((x) => x.research?.job === job && researchInterim(x.research));
  return i < 0 ? null : messages.splice(i, 1)[0];
}

/** The brief's summary for its card: the text without its 🔎 header line. */
export function briefSummary(text: string): string {
  return text.replace(/^🔎[^\n]*\n+/u, '').trim();
}
