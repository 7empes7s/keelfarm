// The tour's steps (#121), for every track: the phone (pocket mode's bottom tabs), the desktop pocket (its rail) and
// the 3D office. One list with ids, so docs/pocket.md, the tour and its "What's new" stay in sync (tourSteps.test.ts
// checks the docs and that every target is a real control). Pure: Tutorial.tsx draws it.
//
// Adding a feature's step: put it where it belongs in TOUR, with `added` one more than the newest so far. Devices that
// finished the tour then get a "What's new" card replaying just the new steps.
import type { IconName } from './icons';

/** Which tour a device gets, picked from its mode and layout. */
export type Track = 'phone' | 'desk' | 'office';

/** What a step's "Try it" does: always harmless (opens something, or fills the chat's box without sending). */
export type TryIt = 'search' | 'guide' | 'bell' | 'plan' | 'console' | 'charter' | 'costs';

export interface TourStep {
  id: string;
  tracks: Track[];
  title: string;
  /** One sentence. `{ceo}` and `{company}` are names; `{key:<action>}` is the player's key for it; `{move}` the move keys. */
  text: string;
  /** The text on a touch screen, when it differs. */
  touchText?: string;
  /** `data-tour` ids of the control to spotlight, best first: the first one on screen gets the ring. */
  targets?: string[];
  tryIt?: TryIt;
  /** The tour's version that added it: What's new replays the steps newer than what a device saw. */
  added: number;
}

/** A feature still to come: its own PR swaps this entry for its step. Never shown. */
interface TourHook {
  id: string;
  hook: number; // the issue
}

export type TourEntry = TourStep | TourHook;

const ALL: Track[] = ['phone', 'desk', 'office'];
const POCKET: Track[] = ['phone', 'desk'];

export const TOUR: TourEntry[] = [
  // the 3D office's walk-through
  { id: 'look', tracks: ['office'], title: 'Look around', text: 'Click the view to look around, walk with {move} and press {key:overview} for the whole floor from above; Esc gives the mouse back.', touchText: 'Drag near the ghost stick at the bottom to walk (far to run), drag in the other bottom corner to look and tap a desk, a person or the floor to walk there.', added: 1 },
  { id: 'phone', tracks: ['office'], title: 'Pull out your phone', text: 'Press {key:phone}: your phone is how you talk to {ceo} from anywhere in the building.', targets: ['phone'], added: 1 },
  { id: 'phone-tour', tracks: ['office'], title: 'Your phone', text: '{icon:message-circle} texts {ceo}, {icon:users} Team has the changes waiting for your OK and {icon:chart-column} Company shows every project; put it away with {key:phone}.', added: 1 },
  { id: 'ceo', tracks: ['office'], title: 'Visit the CEO', text: "{ceo}'s corner office is at the back right of the lobby: walk in and press {key:interact} at the desk.", added: 1 },
  { id: 'hires', tracks: ['office'], title: 'New agents', text: 'New agents {ceo} wants wait on the green chairs by the east wall: press {key:interact} on one to hire or decline.', added: 1 },
  { id: 'upstairs', tracks: ['office'], title: 'Go upstairs', text: 'Each project has its own floor: walk into the elevator in the middle of the south wall and press {key:interact} on its panel.', added: 1 },
  { id: 'whiteboard', tracks: ['office'], title: 'The whiteboard', text: "Each floor's whiteboard is its Kanban board: press {key:interact} on it to hand out issues, send pull requests to QA and merge.", added: 1 },
  { id: 'watch', tracks: ['office'], title: 'Watch the team', text: "Walk up behind anyone to watch their screen, or press {key:interact} at a desk for their terminal.", added: 1 },

  // pocket mode's tabs
  { id: 'pocket-tabs', tracks: POCKET, title: 'Five tabs', text: 'Company, the chat with {ceo}, Kanban, Team and Approvals; a badge says what waits on you.', targets: ['pocket-tabs'], added: 2 },
  { id: 'chat-button', tracks: ['desk'], title: 'The chat, top right', text: "{ceo}'s avatar at the top right opens and closes the chat beside the pages, with a badge for unread messages and a dot while they work.", targets: ['chat'], added: 5 },
  { id: 'previews', tracks: POCKET, title: 'Previews', text: 'Previews in the menu shows every live app and PR preview on one page, by project, agent and PR, with a badge for what runs now.', touchText: 'Previews, at the top of Settings, shows every live app and PR preview on one page, by project, agent and PR.', targets: ['previews', 'console'], added: 6 },
  { id: 'desk-keys', tracks: ['desk'], title: 'Keyboard first', text: 'Keys 1 to 5 open the tabs, / jumps to the chat beside them, and {icon:building-2} 3D office walks around the building.', targets: ['switch'], added: 2 },

  // every track (#102 to #109)
  { id: 'search', tracks: ALL, title: 'Find anything', text: '{icon:search} (or Ctrl K) searches floors, agents, issues, pull requests and settings, or asks {ceo} to plan or research.', targets: ['search'], tryIt: 'search', added: 1 },
  { id: 'guide', tracks: ALL, title: 'Get the most out of it', text: 'The {icon:circle-check} guide is a checklist that ticks itself, with a Do it on each open item.', targets: ['guide'], tryIt: 'guide', added: 1 },
  { id: 'bell', tracks: ALL, title: 'Notifications', text: "{icon:bell} keeps every notification with its buttons, so you can approve or retry right from it.", targets: ['bell'], tryIt: 'bell', added: 2 },
  { id: 'chat-cards', tracks: ALL, title: 'Ask the CEO', text: "In the chat, tap a starter or type / for commands like /plan; action cards show each job's live steps.", targets: ['chat', 'phone'], tryIt: 'plan', added: 2 },
  { id: 'console', tracks: ALL, title: "The manager's console", text: 'Five tabs, each with a row of sections, and a {icon:search} that finds any setting.', targets: ['console-search', 'console'], tryIt: 'console', added: 2 },
  { id: 'charter', tracks: ALL, title: 'Charters', text: "A floor's Charter leads with its numbers for each objective; editing is tucked away.", targets: ['charter', 'console'], tryIt: 'charter', added: 2 },
  { id: 'costs', tracks: ALL, title: 'Where the plan goes', text: "Mission control's costs: insights first, the priciest issues as cards and waste grouped by cause.", targets: ['costs', 'console'], tryIt: 'costs', added: 2 },
  { id: 'info', tracks: POCKET, title: 'What can I do here?', text: "Every screen's {icon:info} says what you can do there, and brings back What's new.", targets: ['info'], added: 2 },
  { id: 'agent-chat', tracks: ALL, title: 'Their chat', text: "An agent's window shows {icon:message-circle} Chat or {icon:keyboard} Terminal, and {icon:message-circle} Chat turns chat mode on for every desk; hold a message or step to react, and your reactions reach them after their current step.", added: 3 },
  { id: 'chat-full', tracks: ALL, title: 'Full screen chat', text: "{icon:maximize-2} in the chat's header (or {key:chatFull} in the chat) gives {ceo} room for long replies (the 2D office keeps its menu beside it); Esc or Back puts everything back.", touchText: "{icon:maximize-2} in the chat's header gives {ceo} the whole screen, tab bar and all; {icon:maximize-2} again or Back puts it back.", targets: ['chat-full', 'chat', 'phone'], added: 4 },
  { id: 'switch', tracks: ['office'], title: 'The 2D office', text: 'Press {key:switchOffice} for the office as pages, with the chat beside them: quicker for getting work done.', targets: ['switch'], added: 2 },

  // features still to come: their PRs replace these hooks with steps
  { id: 'memory-alerts', hook: 115 },
  { id: 'agent-window', hook: 117 },
  { id: 'open-decisions', hook: 114 },
  { id: 'reactions', hook: 118 },

  { id: 'office', tracks: ['office'], title: 'Your office', text: "Your glass office at the back left of the lobby has the manager's console; press {key:help} for help. Enjoy running {company}!", added: 1 },
];

export const isStep = (e: TourEntry): e is TourStep => !('hook' in e);

/** The track for this device: the 3D office, or pocket mode on a phone's layout or a desktop's. */
export function trackFor(mode: 'pocket' | 'office', layout: 'compact' | 'medium' | 'expanded'): Track {
  if (mode === 'office') return 'office';
  return layout === 'compact' ? 'phone' : 'desk';
}

/** A track's steps, in order. */
export const stepsFor = (track: Track): TourStep[] => TOUR.filter(isStep).filter((s) => s.tracks.includes(track));

/** What a device that finished the tour before #121 had seen: the original tour. */
const LEGACY = TOUR.filter(isStep)
  .filter((s) => s.added === 1)
  .map((s) => s.id);

/**
 * The ids this device has seen, from its saved list (`raw`, or null if it never saved one). A device with none whose
 * office says the tour was finished (`finished`) saw the original tour; one with none mid-tour has seen nothing yet.
 */
export function seenIds(raw: string | null, finished: boolean): string[] {
  if (raw) {
    try {
      const v: unknown = JSON.parse(raw);
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    } catch {
      // unreadable: as if never saved
    }
  }
  return finished ? LEGACY : [];
}

/** The steps of `track` this device hasn't seen: what the "What's new" card replays. */
export const newSince = (track: Track, seen: readonly string[]): TourStep[] => stepsFor(track).filter((s) => !seen.includes(s.id));

/** What's new asked for again (Settings, ⓘ): the unseen steps, else the newest version's. */
export function whatsNew(track: Track, seen: readonly string[]): TourStep[] {
  const fresh = newSince(track, seen);
  if (fresh.length) return fresh;
  const steps = stepsFor(track);
  const newest = Math.max(...steps.map((s) => s.added));
  return steps.filter((s) => s.added === newest);
}

/** The seen list after a run over `steps`, to save. */
export const markSeen = (seen: readonly string[], steps: readonly TourStep[]): string[] => [...new Set([...seen, ...steps.map((s) => s.id)])];

export type TextPart = { text: string } | { key: string } | { move: true } | { name: 'ceo' | 'company' } | { icon: IconName };

/** A step's text in parts: words, a key binding, the move keys, a name, an icon (`{icon:bell}`, naming a control by its icon). */
export function textParts(text: string): TextPart[] {
  return text
    .split(/(\{[^}]+\})/)
    .filter(Boolean)
    .map((p): TextPart => {
      if (p === '{move}') return { move: true };
      if (p === '{ceo}' || p === '{company}') return { name: p.slice(1, -1) as 'ceo' | 'company' };
      if (p.startsWith('{key:')) return { key: p.slice(5, -1) };
      if (p.startsWith('{icon:')) return { icon: p.slice(6, -1) as IconName };
      return { text: p };
    });
}
