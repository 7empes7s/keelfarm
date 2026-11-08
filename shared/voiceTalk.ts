// The CEO talking while it works (#286, docs/voice.md): an instant spoken ack when the manager speaks mid-job, and short
// spoken progress from its step log (shared/ceoSteps.ts) at milestones or every minute or so. No model call: the words
// come from fixed lists and the steps' plain words, with no numbers, paths or markdown. Pure: the server picks the
// lines and paces what it sends, each tab decides whether to say one now.
import type { LiveStep } from './ceoStream.ts';
import type { TalkWhileWorking } from './types/voice.ts';

/** The acks: short, varied, and never pretending to answer. */
export const ACKS = ['Got it, I’ll fold that in.', 'Heard you, one moment.', 'Okay, noted.', 'Sure, give me a second.', 'Got it, one moment.', 'Heard you, I’ll get to it.'];
/** Never two acks closer than this. */
export const ACK_GAP_MS = 20_000;

/** The ack for a message arriving at `now` (null: one was said too recently); `n` varies the wording. */
export function pickAck(lastAt: number, now: number, n: number): string | null {
  if (now - lastAt < ACK_GAP_MS) return null;
  return ACKS[Math.abs(Math.floor(n)) % ACKS.length];
}

/** How often the server offers a regular progress line, and how long a job runs before the first. */
export interface TalkPace {
  regularMs: number;
  /** The least time between two milestones. */
  milestoneMs: number;
}
export const TALK_PACE: TalkPace = { regularMs: 50_000, milestoneMs: 10_000 };
/** The demo's jobs take seconds, not minutes: it talks sooner, so its progress can be heard. */
export const DEMO_TALK_PACE: TalkPace = { regularMs: 6_000, milestoneMs: 3_000 };

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * A step's plain words as something to say: "Reading PR #122's changes on floor 3" → "reading a pull request's changes".
 * Numbers, paths, quotes, links and markdown go; what can't be cleaned becomes "working through it".
 */
export function spokenStep(label: string): string {
  if (label.startsWith('Running ')) return 'running a command';
  const s = label
    .replace(/\s*\([^)]*\)/g, '') // "(up to 10 min)"
    .replace(/:\s.*$/, '') // "Searching the web: …", "Filing an issue: “…”"
    .replace(/“[^”]*”/g, 'something')
    .replace(/\bPR #\d+/g, 'a pull request')
    .replace(/(?:floor \d+ )?#\d+/g, 'an issue')
    .replace(/\s+on floor \d+/g, '')
    .replace(/\bfloor \d+'s\b/g, "the floor's")
    .replace(/\bfloor \d+\b/g, 'the floor')
    .split(/\s+/)
    .map((w) => (/[/\\]|^\S+\.[a-z]{1,5}$|^https?:/i.test(w) ? 'a file' : w))
    .join(' ')
    .replace(/…$/, '')
    .trim();
  return !s || /[\d#*_`[\]<>{}|~]/.test(s) ? 'working through it' : lowerFirst(s);
}

/** What a step says when it's a milestone (null: it isn't): an issue filed, a wait on QA or a merge, a PR sent back. */
export function milestoneLine(step: Pick<LiveStep, 'icon' | 'label' | 'state'>): string | null {
  if (step.icon === '📝' && step.state === 'done' && step.label.startsWith('Filed')) return 'Filed that issue.';
  if (step.icon === '⏳' && step.label.includes("QA's verdict")) return 'Waiting on QA now.';
  if (step.icon === '⏳' && step.label.includes('to merge')) return 'Waiting for the merge.';
  if (step.icon === '↩️' && step.label.startsWith('Sending')) return 'Sending it back for a fix.';
  if (step.icon === '🔍' && step.label.startsWith('Sending')) return 'Sending it back to QA.';
  if (step.icon === '👥') return 'Sizing the team.';
  return null;
}

const REGULAR = [(s: string) => `Still ${s}.`, (s: string) => `Now ${s}.`, (s: string) => `Quick update: ${s}.`];

/** Where the server's pacing of one job is: the last line's time per kind, and the step a milestone was said for. */
export interface TalkState {
  regularAt: number; // the job's start until a regular line is said
  milestoneAt: number;
  milestoneStep: number; // the stepCount of the last milestone said (-1: none)
}

export const talkStart = (now: number): TalkState => ({ regularAt: now, milestoneAt: 0, milestoneStep: -1 });

/** A progress line to offer the tabs, or null; `stepCount` numbers the latest step, so each one is a milestone once. */
export function progressCue(t: TalkState, step: LiveStep | null, stepCount: number, now: number, pace: TalkPace = TALK_PACE): { text: string; milestone: boolean; state: TalkState } | null {
  if (!step) return null;
  const m = milestoneLine(step);
  if (m && t.milestoneStep !== stepCount && now - t.milestoneAt >= pace.milestoneMs) return { text: m, milestone: true, state: { ...t, milestoneAt: now, milestoneStep: stepCount, regularAt: now } };
  if (now - t.regularAt < pace.regularMs || step.state !== 'running') return null;
  return { text: REGULAR[stepCount % REGULAR.length](spokenStep(step.label)), milestone: false, state: { ...t, regularAt: now } };
}

/** What this tab's voice says of progress: the setting, or milestones during a call when it's off ("voice mode"). */
export function talkMode(setting: TalkWhileWorking, inCall: boolean): TalkWhileWorking {
  return setting === 'off' && inCall ? 'milestones' : setting;
}

/** Whether a tab says a line now: never over the manager's open mic or other speech, progress only as its mode allows. */
export function sayNow(line: { kind: 'ack' | 'progress'; milestone?: boolean }, mode: TalkWhileWorking, quiet: { micOpen: boolean; speaking: boolean }): boolean {
  if (quiet.micOpen || quiet.speaking) return false;
  if (line.kind === 'ack') return true;
  return mode === 'regular' || (mode === 'milestones' && line.milestone === true);
}
