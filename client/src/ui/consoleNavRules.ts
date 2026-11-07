// The manager's console's map (#102): five top tabs, each a group of sections shown one at a time under a row of their tabs
// (a list you tap into on a phone), deep links like #settings/cloud-agents, the last section each tab showed, and the
// search over every setting's label. Pure; ConsoleNav.tsx draws it.
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
  | 'tools'
  | 'history'
  | 'daily-log'
  | 'timelapse'
  | 'agents'
  | 'projects'
  | 'runtime'
  | 'office'
  | 'profile'
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
  icon: string;
  label: string;
}

export interface Section {
  id: SectionId;
  group: GroupId;
  icon: string;
  label: string;
  /** Only in the 3D office's console, or only on a phone. */
  only?: 'office' | 'pocket';
  /** The labels of the settings and parts inside, for the search. */
  find: string[];
}

export const GROUPS: Group[] = [
  { id: 'work', icon: '🏢', label: 'Work' },
  { id: 'company', icon: '🛰️', label: 'Company' },
  { id: 'ceo', icon: '🧠', label: 'CEO' },
  { id: 'history', icon: '📜', label: 'History' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];

export const SECTIONS: Section[] = [
  { id: 'floors', group: 'work', icon: '🏢', label: 'Floors & repos', find: ['Office update', 'Update automatically', 'Floor colour', 'Auto-assign issues', 'Auto-merge', 'Browser testing', 'App preview', 'Add a project', 'Sync the folder', 'Disconnect', 'Practices'] },
  { id: 'issues', group: 'work', icon: '📝', label: 'Issues', only: 'office', find: ['File a new issue', 'Open issues', 'Assign', 'Close as not planned'] },
  { id: 'team', group: 'work', icon: '👩‍💻', label: 'Team', find: ['Add an agent', 'Model', 'Effort', 'Coding agent', 'Look', 'Terminal', 'Let go', 'Team stats'] },
  { id: 'ops', group: 'company', icon: '🛰️', label: 'Mission control', find: ['Claude usage', 'Needs you', 'Office doctor', 'The numbers', 'Where the plan goes', 'Costs', 'Experiments', 'Server health', 'Test lab'] },
  { id: 'charter', group: 'company', icon: '🎯', label: 'Charter', find: ['Mission', 'Objectives', 'Standards', 'Non-goals', 'Current focus', 'Proposal'] },
  { id: 'map', group: 'company', icon: '🗺️', label: 'Memory map', find: ['Search the map', 'Local graph', 'Colour by', 'Replay how the map grew', 'Hottest files', 'No objective'] },
  { id: 'ceo', group: 'ceo', icon: '🧠', label: 'The CEO', find: ['Message the CEO', 'CEO model', 'CEO effort', 'Review the company now', 'Standing mandates', 'Team changes', 'Project briefs', 'QA brief', 'Playbook'] },
  { id: 'ceo-settings', group: 'ceo', icon: '🎛️', label: 'CEO settings', find: ['Team changes from the CEO', 'I approve each one', 'Apply straight away', 'Company review every', 'Research time budget', 'Follow-ups', 'Staying awake, waits and consults'] },
  { id: 'tools', group: 'ceo', icon: '🧰', label: 'Tools & skills', find: ['Plugins', 'Skills', 'MCP servers', 'Switches for', 'Lean sessions'] },
  { id: 'history', group: 'history', icon: '📜', label: 'Sessions', find: ['Session history', 'Transcripts', 'Daily log entries'] },
  { id: 'daily-log', group: 'history', icon: '🗂️', label: 'Daily log', find: ['Daily log folder', 'Keep transcripts for', 'History storage'] },
  { id: 'timelapse', group: 'history', icon: '📼', label: 'Time-lapse', only: 'office', find: ['Replay the day', 'Since I was last here'] },
  { id: 'agents', group: 'settings', icon: '🧑‍💻', label: 'Agents', find: ['Default coding agent', 'Default model', 'Default effort', 'Effort per kind of task', 'Session limit', 'Memory kept free', 'Most memory per session', 'Lab browser jobs at once', 'Lab heavy runs at once', 'Sessions while pacing', 'Most agents per floor'] },
  { id: 'projects', group: 'settings', icon: '🏗️', label: 'Every project', find: ['Version control', "Every project's playbook"] },
  { id: 'runtime', group: 'settings', icon: '⌨️', label: 'How agents run', find: ['Real terminals', 'Agent SDK', 'Chat mode'] },
  { id: 'office', group: 'settings', icon: '🏬', label: 'Company', find: ['Your name', 'Company name', "The office dog's name", 'Projects folder', 'Free idle desks after', 'Update the office after merges settle', 'Replay the tour', "What's new"] },
  { id: 'profile', group: 'settings', icon: '👤', label: 'Profile', find: ['Your name', 'Your colour', 'Appear to others'] },
  { id: 'cloud-agents', group: 'settings', icon: '☁️', label: 'Cloud agents', find: ['Upstash Box API key', 'Where new agents work', 'Box size', "Your plan's Box limit"] },
  { id: 'voice', group: 'settings', icon: '🔊', label: 'Voice', find: ['ElevenLabs API key', 'Browser voice', 'Keep voice clips for', 'Speech to Text'] },
  { id: 'outside', group: 'settings', icon: '🌦️', label: 'Weather & world', find: ['Weather', 'Your city', 'Keep it calm', 'World events'] },
  { id: 'notifications', group: 'settings', icon: '🔔', label: 'Notifications', find: ['Push to my devices', 'Desktop notifications', 'Tell me when', 'Office address for links', 'Telegram', 'Channels'] },
  { id: 'themes', group: 'settings', icon: '🎉', label: 'Themes', find: ['Holiday themes', 'Theme to show', 'Birthday'] },
  { id: 'access', group: 'settings', icon: '♿', label: 'Accessibility', find: ['Captions', 'Caption size', 'Colour and status', 'Motion', 'UI scale', 'Readable font', 'High contrast', 'Keyboard and screen readers'] },
  { id: 'pocket', group: 'settings', icon: '📱', label: 'Pocket mode', only: 'pocket', find: ['Open the 3D office'] },
  { id: 'about', group: 'settings', icon: 'ℹ️', label: 'About this office', find: ['Version', 'Commit', 'GitHub account', "Agents' machines", 'Environment'] },
];

export type Where = 'office' | 'pocket';

const shows = (s: Section, where: Where) => !s.only || s.only === where;

export const sectionsIn = (group: GroupId, where: Where) => SECTIONS.filter((s) => s.group === group && shows(s, where));

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
  const s = section ? sectionById(section) : undefined;
  return s && s.group === group && shows(s, where) ? s : undefined;
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
