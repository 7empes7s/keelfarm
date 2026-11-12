// The manager's console's map (#102): five top tabs, each a group of sections shown one at a time under a row of their tabs
// (a list you tap into on a phone), deep links like #settings/cloud-agents, the last section each tab showed, and the
// search over every setting's label. Pure; ConsoleNav.tsx draws it.
import type { IconName } from './icons';

export type GroupId = 'work' | 'company' | 'ceo' | 'history' | 'settings';

export type SectionId =
  | 'floors'
  | 'issues'
  | 'team'
  | 'ops'
  | 'charter'
  | 'map'
  | 'ceo'
  | 'ceo-settings'
  | 'it-dept'
  | 'tools'
  | 'history'
  | 'daily-log'
  | 'timelapse'
  | 'agents'
  | 'projects'
  | 'runtime'
  | 'office'
  | 'profile'
  | 'providers'
  | 'guides'
  | 'accounts'
  | 'cloud-agents'
  | 'voice'
  | 'outside'
  | 'notifications'
  | 'themes'
  | 'access'
  | 'pocket'
  | 'about';

export interface Group {
  id: GroupId;
  icon: IconName;
  label: string;
}

export interface Section {
  id: SectionId;
  group: GroupId;
  icon: IconName;
  label: string;
  /** Only in the 3D office's console, or only on a phone. */
  only?: 'office' | 'pocket';
  /** The labels of the settings and parts inside, for the search. */
  find: string[];
}

export const GROUPS: Group[] = [
  { id: 'work', icon: 'building-2', label: 'Work' },
  { id: 'company', icon: 'satellite', label: 'Company' },
  { id: 'ceo', icon: 'brain', label: 'CEO' },
  { id: 'history', icon: 'scroll-text', label: 'History' },
  { id: 'settings', icon: 'settings', label: 'Settings' },
];

export const SECTIONS: Section[] = [
  { id: 'floors', group: 'work', icon: 'building-2', label: 'Floors & repos', find: ['Office update', 'Update automatically', 'Floor colour', 'Auto-assign issues', 'Auto-merge', 'Browser testing', 'App preview', 'Add a project', 'Sync the folder', 'Disconnect', 'Practices', 'Setup', 'Not now', 'Kind of project'] },
  { id: 'issues', group: 'work', icon: 'notebook-pen', label: 'Issues', find: ['File a new issue', 'Open issues', 'Assign', 'Close as not planned'] },
  { id: 'team', group: 'work', icon: 'laptop', label: 'Team', find: ['Add an agent', 'Model', 'Effort', 'Coding agent', 'Look', 'Terminal', 'Let go', 'Team stats'] },
  { id: 'ops', group: 'company', icon: 'satellite', label: 'Mission control', find: ['Claude usage', 'Needs you', 'Office doctor', 'The numbers', 'Where the plan goes', 'Costs', 'Experiments', 'Server health', 'IT desk', 'Disk', 'Free up space', 'Test lab', 'Who runs on what'] },
  { id: 'charter', group: 'company', icon: 'target', label: 'Charter', find: ['Mission', 'Objectives', 'Standards', 'Non-goals', 'Current focus', 'Proposal'] },
  { id: 'map', group: 'company', icon: 'map', label: 'Memory map', find: ['Search the map', 'Local graph', 'Colour by', 'Replay how the map grew', 'Hottest files', 'No objective'] },
  { id: 'ceo', group: 'ceo', icon: 'brain', label: 'The CEO', find: ['Message the CEO', 'CEO coding agent', 'CEO runs on', 'CEO model', 'CEO effort', 'Review the company now', 'Standing mandates', 'Team changes', 'Project briefs', 'QA brief', 'Playbook'] },
  { id: 'ceo-settings', group: 'ceo', icon: 'sliders-horizontal', label: 'CEO settings', find: ['Team changes from the CEO', 'I approve each one', 'Apply straight away', 'Company review every', 'Model per job', 'Run all automated jobs on', 'Research time budget', 'Follow-ups', 'Staying awake, waits and consults', 'IT desk', 'Commands run'] },
  { id: 'it-dept', group: 'ceo', icon: 'monitor', label: 'IT department', find: ['The IT department', 'IT chat', 'Ask IT', 'IT lead', 'IT model', 'IT account', 'IT Telegram bot', 'Disk free', 'Machine health', 'Health checks', 'IT recommendations'] },
  { id: 'tools', group: 'ceo', icon: 'toolbox', label: 'Tools & skills', find: ['Plugins', 'Skills', 'MCP servers', 'Switches for', 'Lean sessions'] },
  { id: 'history', group: 'history', icon: 'scroll-text', label: 'Sessions', find: ['Session history', 'Transcripts', 'Daily log entries', 'CEO jobs', 'Redo on Opus'] },
  { id: 'daily-log', group: 'history', icon: 'archive', label: 'Daily log', find: ['Daily log folder', 'Keep transcripts for', 'History storage'] },
  { id: 'timelapse', group: 'history', icon: 'film', label: 'Time-lapse', only: 'office', find: ['Replay the day', 'Since I was last here'] },
  { id: 'agents', group: 'settings', icon: 'laptop', label: 'Agents', find: ['Default coding agent', 'Default model', 'Default effort', 'Effort per kind of task', 'Session limit', 'Memory kept free', 'Most memory per session', 'Disk warning', 'Store agents’ working copies on', 'Lab browser jobs at once', 'Lab heavy runs at once', 'Sessions while pacing', 'When Claude warns that usage is high', 'Most agents per floor'] },
  { id: 'projects', group: 'settings', icon: 'hard-hat', label: 'Every project', find: ['Version control', "Every project's playbook"] },
  { id: 'runtime', group: 'settings', icon: 'keyboard', label: 'How agents run', find: ['Real terminals', 'Agent SDK', 'Chat mode'] },
  { id: 'office', group: 'settings', icon: 'store', label: 'Company', find: ['Your name', 'Company name', "The office dog's name", 'Projects folder', 'Free idle desks after', 'Previews', 'Stop a PR preview after no use', 'Max lifetime', 'Update the office after merges settle', 'Replay the tour', "What's new"] },
  { id: 'profile', group: 'settings', icon: 'user', label: 'Profile', find: ['Your name', 'Your colour', 'Appear to others'] },
  { id: 'providers', group: 'settings', icon: 'plug', label: 'Providers', find: ['Add provider', 'MCP servers', 'What uses it', 'Keys found on this computer', 'Scan', 'OpenAI API', 'Anthropic API', 'Gemini', 'OpenRouter', 'Hetzner', 'ElevenLabs', 'Upstash', 'Runway', 'Luma', 'Kling', 'Video', 'Nano Banana', 'OpenAI Images', 'Image', 'Test'] },
  { id: 'guides', group: 'settings', icon: 'book-open', label: 'Guides', find: ['Guides', 'Use case', 'What the company mainly makes', 'Recommended setup', 'Web app', 'API', '3D / browser game', 'Static site', 'CLI or library', 'Mobile app', 'What each coding agent is good at'] },
  { id: 'accounts', group: 'settings', icon: 'key-round', label: 'Providers & accounts', find: ['Add account', 'API key', 'Subscription login', 'Setup token', 'Sign in again', 'Daily cost cap', 'Tags', 'Rotation', 'API keys only as a last resort', 'Simulate a limit', 'Billing'] },
  { id: 'cloud-agents', group: 'settings', icon: 'cloud', label: 'Cloud agents', find: ['Upstash Box API key', 'Where new agents work', 'Box size', "Your plan's Box limit"] },
  { id: 'voice', group: 'settings', icon: 'volume-2', label: 'Voice', find: ['ElevenLabs API key', 'Browser voice', 'Keep voice clips for', 'Speech to Text', 'Speed', 'Favourite voices', 'Model'] },
  { id: 'outside', group: 'settings', icon: 'cloud-sun-rain', label: 'Weather & world', find: ['Weather', 'Your city', 'Keep it calm', 'World events'] },
  { id: 'notifications', group: 'settings', icon: 'bell', label: 'Notifications', find: ['Push to my devices', 'Desktop notifications', 'Tell me when', 'Office address for links', 'Telegram', 'Channels'] },
  { id: 'themes', group: 'settings', icon: 'party-popper', label: 'Themes', find: ['Holiday themes', 'Theme to show', 'Birthday'] },
  { id: 'access', group: 'settings', icon: 'accessibility', label: 'Accessibility', find: ['Captions', 'Caption size', 'Colour and status', 'Motion', 'UI scale', 'Readable font', 'High contrast', 'Keyboard and screen readers'] },
  { id: 'pocket', group: 'settings', icon: 'smartphone', label: 'Pocket mode', only: 'pocket', find: ['Open the 3D office'] },
  { id: 'about', group: 'settings', icon: 'info', label: 'About this office', find: ['Version', 'Commit', 'GitHub account', "Agents' machines", 'Environment'] },
];

export type Where = 'office' | 'pocket';

const shows = (s: Section, where: Where) => !s.only || s.only === where;

/** Sections shown in a second tab too (#246): Team sits beside Agents under Settings, where the manager looks for it. Same section, opened in that tab. */
const ALSO: { id: SectionId; group: GroupId; after: SectionId }[] = [{ id: 'team', group: 'settings', after: 'agents' }];
const PLACED = ALSO.map(({ id, group, after }) => ({ section: { ...SECTIONS.find((s) => s.id === id)!, group }, after }));

export const sectionsIn = (group: GroupId, where: Where) =>
  SECTIONS.filter((s) => s.group === group && shows(s, where)).flatMap((s) => [s, ...PLACED.filter((p) => p.section.group === group && p.after === s.id && shows(p.section, where)).map((p) => p.section)]);

/** The sections row under the top tabs (#199): a group's sections, or none when it has only one. */
export const sectionRow = (group: GroupId, where: Where) => {
  const list = sectionsIn(group, where);
  return list.length > 1 ? list : [];
};

/** Arrow keys in a row of tabs: the index a key moves to (wrapping; Home and End to the ends), or undefined for other keys. */
export function stepTab(at: number, count: number, key: string): number | undefined {
  if (count < 1) return undefined;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (at + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}

/** Where the lobby's test lab screen opens the console: the section with the Test lab card. */
export const TEST_LAB_SECTION: SectionId = 'ops';

export const sectionById = (id: string) => SECTIONS.find((s) => s.id === id);

const isGroup = (id: string): id is GroupId => GROUPS.some((g) => g.id === id);

/** What a deep link or an old tab name (ManagerTab, e.g. 'settings' or 'access') opens: a section, else a group's remembered or first one. */
export function resolve(id: string | undefined, where: Where, remembered: Partial<Record<GroupId, string>> = {}): Section | undefined {
  if (!id) return undefined;
  const s = sectionById(id);
  if (s && shows(s, where)) return s;
  if (!isGroup(id)) return undefined;
  const list = sectionsIn(id, where);
  return list.find((x) => x.id === remembered[id]) ?? list[0];
}

/** `#settings/cloud-agents` → that section; anything else → undefined. */
export function parseHash(hash: string, where: Where): Section | undefined {
  const [group, section] = hash.replace(/^#/, '').split('/');
  return section && isGroup(group) ? sectionsIn(group, where).find((s) => s.id === section) : undefined;
}

export const hashFor = (s: Section) => `#${s.group}/${s.id}`;

export interface Hit {
  section: Section;
  /** The label that matched: a setting's, or the section's own. */
  label: string;
}

/** The side menu's search: sections and settings whose label has every word typed, best first (sections, then labels starting with the query). */
export function search(query: string, where: Where): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const q = words.join(' ');
  const hits: (Hit & { rank: number })[] = [];
  for (const section of SECTIONS) {
    if (!shows(section, where)) continue;
    if (has(section.label)) hits.push({ section, label: section.label, rank: 0 });
    for (const label of section.find) if (label !== section.label && has(label)) hits.push({ section, label, rank: label.toLowerCase().startsWith(q) ? 1 : 2 });
  }
  return hits.sort((a, b) => a.rank - b.rank).map(({ section, label }) => ({ section, label }));
}

// ---------- the last section each tab showed (per browser) ----------

export interface Remembered {
  group?: GroupId;
  sections: Partial<Record<GroupId, string>>;
}

const KEY = 'cubefarm.console';

export function loadRemembered(): Remembered {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Remembered>;
    return { group: v.group && isGroup(v.group) ? v.group : undefined, sections: v.sections && typeof v.sections === 'object' ? v.sections : {} };
  } catch {
    return { sections: {} };
  }
}

export function remember(s: Section) {
  const r = loadRemembered();
  try {
    localStorage.setItem(KEY, JSON.stringify({ group: s.group, sections: { ...r.sections, [s.group]: s.id } }));
  } catch {
    // private windows and blocked storage: the console still works, it just forgets
  }
}

/** Where the console opens: what was asked for, else the address's #group/section, else the last section opened, else Floors. */
export function opening(asked: string | undefined, hash: string, where: Where, r: Remembered): Section {
  return resolve(asked, where, r.sections) ?? parseHash(hash, where) ?? resolve(r.group, where, r.sections) ?? SECTIONS[0];
}
