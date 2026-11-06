// What every empty list says (#109): what would appear there, why it's empty now, and the next thing to do, never a
// bare "Nothing here". EmptyState.tsx draws one; the words live here so they stay consistent. Pure.
import type { Target } from './goTo';

export interface Empty {
  icon: string;
  /** What shows up here once there is some. */
  what: string;
  /** Why it's empty right now. */
  why: string;
  /** The next action: a label and where it goes (a screen can swap in its own handler, e.g. the board's issue form). */
  action: { label: string; target: Target };
}

export const DOCS = 'https://github.com/7empes7s/keelfarm/blob/main/docs/';

export const EMPTY = {
  backlog: {
    icon: '📋',
    what: 'Open issues wait here until a free agent picks one up.',
    why: 'This floor has no open issues right now.',
    action: { label: 'Ask the CEO to plan', target: { kind: 'ceo', text: 'Plan the next milestone for the busiest floor and file the issues.' } },
  },
  progress: {
    icon: '🔨',
    what: 'Agents building an issue show here, with the issue they have.',
    why: 'Nobody is coding: the backlog is empty, or everyone is testing and fixing.',
    action: { label: 'Ask what to do next', target: { kind: 'ceo', text: "What's everyone working on, and what should come next?" } },
  },
  qa: {
    icon: '🔍',
    what: 'Pull requests waiting for QA, being tested or being fixed show here.',
    why: 'No open pull request is in testing.',
    action: { label: 'Write a QA brief', target: { kind: 'section', section: 'ceo' } },
  },
  ready: {
    icon: '✅',
    what: 'Pull requests that passed QA wait here for a merge.',
    why: 'Nothing has passed QA yet, or auto-merge already merged it.',
    action: { label: 'Auto-merge settings', target: { kind: 'section', section: 'floors' } },
  },
  merged: {
    icon: '🎉',
    what: 'Pull requests merged in the last days show here.',
    why: 'Nothing has been merged on this floor yet.',
    action: { label: 'Ask what is closest', target: { kind: 'ceo', text: 'Which pull request is closest to merging, and what does it need?' } },
  },
  approvals: {
    icon: '✋',
    what: 'Team changes, charter proposals and pull requests that need your call wait here.',
    why: 'Nothing waits on you: the team carries on by itself.',
    action: { label: 'Get told when it does', target: { kind: 'section', section: 'notifications' } },
  },
  waste: {
    icon: '💸',
    what: 'Sessions that ended without a PR, a commit or a verdict show here, with what they cost.',
    why: 'Nothing wasted: every session ended with a result.',
    action: { label: 'Open the session history', target: { kind: 'section', section: 'history' } },
  },
  drift: {
    icon: '🧭',
    what: "Merged pull requests of the last 7 days, under the objective their issue named.",
    why: 'Nothing merged on this floor in the last 7 days.',
    action: { label: 'Ask the CEO to plan', target: { kind: 'ceo', text: "Plan each floor's next issues against its charter objectives." } },
  },
  history: {
    icon: '📜',
    what: 'Every finished session: who worked on what, how it ended, and its transcript.',
    why: 'No session matches: none has finished yet, or the filters hide them.',
    action: { label: 'Ask the CEO to plan', target: { kind: 'ceo', text: 'Plan the next milestone for the busiest floor.' } },
  },
  experiments: {
    icon: '🧪',
    what: "A/B tests of the office's practices, with their results, so defaults change on evidence.",
    why: 'No experiment has been set up yet.',
    action: { label: 'Ask the CEO for one', target: { kind: 'ceo', text: 'Suggest an experiment on how the agents work that would cut QA rounds or cost.' } },
  },
  devices: {
    icon: '🔔',
    what: 'Phones and computers that get push notifications show here.',
    why: 'No device has signed up for push yet.',
    action: { label: 'How to set it up', target: { kind: 'link', url: `${DOCS}pocket.md#get-notified-on-this-phone` } },
  },
  projects: {
    icon: '🏢',
    what: 'Each project gets a floor of its own, with its team and board.',
    why: 'No project has moved in yet.',
    action: { label: 'Move in a project', target: { kind: 'section', section: 'floors' } },
  },
  team: {
    icon: '👥',
    what: "This floor's agents show here, with what each is doing.",
    why: 'Nobody works on this floor yet.',
    action: { label: 'Add an agent', target: { kind: 'section', section: 'team' } },
  },
} satisfies Record<string, Empty>;

export type EmptyKind = keyof typeof EMPTY;
