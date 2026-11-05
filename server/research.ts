// The CEO's research jobs (#20): started only by the manager ("Research: <topic>" in the chat, or "Research first" in a
// floor's Plan dialog). The CEO looks outward (the web) and inward (the floors, the manager's connected apps), brings
// options with sources, files nothing, and the manager's pick becomes a normal plan job.
import fs from 'node:fs/promises';
import path from 'node:path';
import { researchTopic } from '../shared/chat.ts';
import type { PhoneMessage } from '../shared/types.ts';
import type { SessionHandle } from './agentRunner.ts';
import type { CeoJob, OfficeHandlers } from './ceo.ts';

export const DEFAULT_RESEARCH_MIN = 20;
/** Minutes past the budget before the office stops a research session that didn't wrap up. */
const RESEARCH_GRACE_MIN = 5;

/** Refused file_issue during research: it ends with a question, and the manager's pick is planned as a job of its own. */
export const RESEARCH_NO_FILING = 'Research files nothing. Put the options in your final message with suggestions; the option the manager picks comes back to you as a plan job, which files the issues.';

/** Refused office tools during research, which reads untrusted pages and so acts on nothing. */
export const RESEARCH_READ_ONLY = 'Research only reads: it changes nothing in the office and sends nothing. Put what you would change in your final message; the manager decides.';
/** The office tools research may use: the read-only ones, and attach_file to hand the manager a file. */
const RESEARCH_TOOLS = new Set<keyof OfficeHandlers>(['companyStatus', 'agentDetail', 'agentLog', 'qaReport', 'worktreeFile', 'prDiff', 'sessionHistory', 'attachFile']);

/** `h` with every tool but RESEARCH_TOOLS refused while `researching()` (file_issue with RESEARCH_NO_FILING). */
export function researchReadOnly(h: OfficeHandlers, researching: () => boolean): OfficeHandlers {
  const out: Record<string, unknown> = { ...h };
  for (const k of Object.keys(h) as (keyof OfficeHandlers)[]) {
    if (RESEARCH_TOOLS.has(k)) continue;
    const act = h[k] as (a: never) => unknown;
    out[k] = (a: never) => {
      if (researching()) throw new Error(k === 'fileIssue' ? RESEARCH_NO_FILING : RESEARCH_READ_ONLY);
      return act(a);
    };
  }
  return out as unknown as OfficeHandlers;
}

export const clampResearchMin = (n: unknown) => Math.max(5, Math.min(120, Math.round(Number(n)) || DEFAULT_RESEARCH_MIN));

/** The research job's prompt: the topic, the floor it's for (if any), the time budget and the no-filing rule. */
export function researchPrompt(topic: string, floor: { floor: number; fullName: string; clone: string } | null, minutes: number): string {
  return [
    `Research for the manager: "${topic}"`,
    floor ? `It is for floor ${floor.floor} (${floor.fullName}, clone at ${floor.clone}).` : 'It is not tied to a floor: relate it to the floors in company_status where it fits.',
    `You have about ${minutes} minutes. When the office says time is up, wrap up with what you have.`,
    '',
    '1. Pin down the question.',
    '2. Look outward and inward, in parallel (subagents for independent strands when the topic is broad):',
    '- outward: WebSearch and WebFetch for current docs, comparable products, prior art and pitfalls; keep each source\'s URL.',
    "- inward: the floors' code and docs, and the manager's connected apps when relevant (Notion, Drive/Docs, Gmail, Figma): read only, never send, edit or create anything there.",
    'Use skills that fit (brainstorming, deep-research, design or architecture).',
    '3. Brainstorm 2 to 4 distinct options, not variations. Each: how it would work here, effort (rough issue count), risks, cost to the Claude plan. Keep facts (with sources) apart from guesses.',
    '',
    'File nothing and change nothing: no issues, team changes or settings.',
    `Final message: a 3 to 5 line summary with your recommendation; a \`\`\`artifact title="Research: ${short(topic)}" block with the question, findings with linked sources, an options table, the recommendation and open questions; a \`\`\`suggestions block (e.g. "Go with B", "Plan A and B", "Dig deeper on C"). End with a question for the manager.`,
  ].join('\n');
}

/** What the office sends the CEO when the research budget runs out. */
export function researchWrapUp(topic: string, minutes: number): string {
  return `Time is up for the research on "${short(topic)}" (${minutes} minutes). Stop looking and write your final message now with what you have: the summary, the "Research: ${short(topic)}" artifact and the suggestions.`;
}

/** The artifact title's topic: one line, at most 60 characters. */
export function short(topic: string): string {
  const t = topic.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t;
}

/**
 * The job a reply to a research message becomes: "dig deeper" researches again; anything else (a pick) is a plan
 * job for the research's floor (pass the only floor for research not tied to one), or else a chat the CEO plans on
 * the floor it fits.
 * `forward` is the reply as the CEO gets it (with its quote), `brief` where the research brief was saved.
 */
export function researchHandoff(r: { topic: string; repoId?: string }, reply: string, forward: string, brief: string | null, messageIds: number[], at: number): CeoJob {
  const pick = reply.trim().slice(0, 1000);
  if (/^\s*(dig|look|research)\s+(deeper|further|more)\b/i.test(pick)) return { kind: 'research', topic: `${r.topic} · ${pick}`.slice(0, 1000), ...(r.repoId && { repoId: r.repoId }), messageIds, at };
  const from = brief ? ` Your brief: ${brief} (read it first).` : '';
  if (r.repoId) return { kind: 'plan', repoId: r.repoId, topic: r.topic, pick, ...(brief && { brief }), messageIds, at };
  return { kind: 'chat', text: `${forward}\nThis picks from your research on "${short(r.topic)}".${from} Plan it on the floor it fits: file the issues.`, messageIds, at };
}

/**
 * The job a manager's message starts, if it is about research: "Research: <topic>" starts one, and a reply to a
 * research message hands off (researchHandoff, after saving that message's artifacts in `dir` as the brief). Null otherwise.
 */
export async function researchJob(o: { text: string; quoted?: PhoneMessage; forward: string; id: number; dir: string; onlyRepo?: string }): Promise<CeoJob | null> {
  const topic = researchTopic(o.text);
  if (topic) return { kind: 'research', topic, messageIds: [o.id], at: Date.now() };
  const r = o.quoted?.research;
  if (!o.quoted || !r) return null;
  const brief = await saveBrief(path.join(o.dir, `${o.quoted.id}.md`), o.quoted.artifacts ?? []);
  return researchHandoff({ ...r, repoId: r.repoId ?? o.onlyRepo }, o.text, o.forward, brief, [o.id], Date.now());
}

/** Writes a research message's artifacts to `file` for the plan picked from it: the path, or null when there's nothing to save. */
async function saveBrief(file: string, artifacts: NonNullable<PhoneMessage['artifacts']>): Promise<string | null> {
  const docs = artifacts.filter((x) => x.markdown);
  if (!docs.length) return null;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, docs.map((x) => `# ${x.title}\n\n${x.markdown}`).join('\n\n'));
    return file;
  } catch {
    return null;
  }
}

/** What a CEO reply posted during `job` carries: the research it answers, so a reply to it hands off. */
export function researchRef(job: CeoJob | null): Pick<PhoneMessage, 'research'> {
  return job?.kind === 'research' ? { research: { topic: job.topic ?? '', ...(job.repoId && { repoId: job.repoId }) } } : {};
}

/**
 * A research job's time budget: at `min` minutes the CEO is told to wrap up, RESEARCH_GRACE_MIN later its session is
 * stopped (`stopping` runs first, with the reason). `clear` when the job ends.
 */
export class ResearchGuard {
  private timers: NodeJS.Timeout[] = [];

  start(min: number, topic: string, session: () => SessionHandle | null, stopping: (note: string) => void) {
    this.clear();
    this.timers.push(
      setTimeout(() => session()?.send(researchWrapUp(topic, min)), min * 60_000),
      setTimeout(() => {
        const s = session();
        if (!s) return;
        stopping(`the research ran past its ${min}-minute budget and was stopped. Raise it in Settings → The CEO, or ask again with a narrower topic.`);
        s.stop();
      }, (min + RESEARCH_GRACE_MIN) * 60_000),
    );
  }

  clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
