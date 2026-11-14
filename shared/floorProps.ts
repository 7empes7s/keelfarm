// A floor's project props (#536): the 3D things that show what its team builds, beside its theme (floorThemes.ts). A
// backup vault for a backup product, a ballot box for civic tech, a blueprint table for this office, a camera rig
// for a video studio. Picked from the floor's profile (its name, description, summary and mission) and use case, unless
// the manager picks a set by hand (PersistedRepo.props). Pure; the client draws them (client/src/world/projectProps/).
import type { FloorTheme } from './floorThemes.ts';
import type { UseCase } from './types/setup.ts';

// New sets go at the end: the demo gives floor N the Nth.
export const PROP_SETS = ['vault', 'civic', 'workshop', 'broadcast', 'devices', 'servers', 'arcade'] as const;
export type PropSet = (typeof PROP_SETS)[number];

/** For Floor settings' cards: a short name and what's in it. */
export const PROP_SET_INFO: Record<PropSet, { name: string; blurb: string }> = {
  vault: { name: 'Backup vault', blurb: 'A vault door, backup shelves, security cameras and a tenant status screen' },
  civic: { name: 'Town hall', blurb: 'A ballot box, a town-hall noticeboard and a map poster' },
  workshop: { name: 'Workshop', blurb: 'A blueprint table with a mini building and a robot assembly bench' },
  broadcast: { name: 'Video studio', blurb: 'A camera on a tripod, a ring light, phone editing bays, a live wall and a launch countdown' },
  devices: { name: 'Device lab', blurb: 'A test wall of phones and tablets and a wireframe board' },
  servers: { name: 'Server room', blurb: 'A server rack, a terminal wall and a network patch panel' },
  arcade: { name: 'Playtest corner', blurb: 'An arcade cabinet, a controller stand and a level map' },
};

/** What a floor is about, as RepoView has it. */
export interface FloorProfile {
  fullName: string;
  description?: string;
  summary?: string;
  mission?: string;
  useCase?: UseCase | null;
}

/** Words in a floor's profile that say what it builds, first match wins (checked before its use case). */
const WORDS: [PropSet, RegExp][] = [
  ['vault', /\b(backups?|restores?|disaster recovery|vault|snapshots?|m365|entra|tenants?)\b/i],
  ['civic', /\b(civic|democra\w*|votes?|voting|ballots?|elections?|petitions?|councils?|citizens?)\b/i],
  ['broadcast', /\b(videos?|clips?|stream\w*|podcasts?|reels?|shorts|broadcast\w*)\b/i],
  ['workshop', /\b(agents?|swarm|orchestrat\w*|cubefarm|keelfarm|robots?)\b/i],
];

const USE_CASE_SET: Record<UseCase, PropSet> = {
  video: 'broadcast',
  'game-3d': 'arcade',
  api: 'servers',
  'cli-library': 'servers',
  ops: 'servers',
  research: 'servers',
  'web-app': 'devices',
  'static-site': 'devices',
  mobile: 'devices',
  design: 'devices',
  marketing: 'devices',
  agency: 'civic',
};

/** The set a floor's profile picks: the words it uses, else its use case's default, else the device lab. */
export function propSetFor(p: FloorProfile): PropSet {
  const text = [p.fullName.split('/')[1] ?? p.fullName, p.description, p.summary, p.mission].filter(Boolean).join(' \n ');
  return WORDS.find(([, re]) => re.test(text))?.[0] ?? (p.useCase ? USE_CASE_SET[p.useCase] : 'devices');
}

/** A floor's set: the manager's pick, else its profile's. */
export const floorPropSet = (p: FloorProfile & { props?: PropSet | null }): PropSet => p.props ?? propSetFor(p);

const isPropSet = (raw: unknown): raw is PropSet => PROP_SETS.includes(raw as PropSet);

/** A floor's set as stored: anything unknown is no pick (the profile picks). */
export const propSetOf = (raw: unknown): PropSet | undefined => (isPropSet(raw) ? raw : undefined);

/** A pick from a request: a set, or 'auto' / null to let the profile pick again. Throws a message the manager can act on. */
export function cleanPropSet(raw: unknown): PropSet | undefined {
  if (raw === null || raw === 'auto') return undefined;
  if (isPropSet(raw)) return raw;
  throw new Error(`props must be auto or one of ${PROP_SETS.join(', ')}`);
}

// ---------- desk tools ----------

/** The tool on every working desk, matching the stack: a pad for games, a green terminal for APIs, a tablet for design… */
export type DeskTool = 'controller' | 'terminal' | 'tablet' | 'phone' | 'camera' | 'notebook';

const USE_CASE_TOOL: Record<UseCase, DeskTool> = {
  'game-3d': 'controller',
  api: 'terminal',
  'cli-library': 'terminal',
  ops: 'terminal',
  research: 'notebook',
  design: 'tablet',
  marketing: 'tablet',
  video: 'camera',
  mobile: 'phone',
  'web-app': 'phone',
  'static-site': 'phone',
  agency: 'notebook',
};
const SET_TOOL: Record<PropSet, DeskTool> = { vault: 'terminal', civic: 'notebook', workshop: 'terminal', broadcast: 'camera', devices: 'phone', servers: 'terminal', arcade: 'controller' };

/** The themes whose desks always carry their tool, so the floor reads as the theme at a glance (#570). */
const THEME_TOOL: Partial<Record<FloorTheme, DeskTool>> = { 'game-studio': 'controller', 'media-studio': 'camera', newsroom: 'notebook' };

/** A floor's desk tool: its theme's when it has one, else from its use case when it has one, else from its prop set. */
export const deskToolFor = (useCase: UseCase | null | undefined, set: PropSet, theme?: FloorTheme): DeskTool => (theme && THEME_TOOL[theme]) ?? (useCase ? USE_CASE_TOOL[useCase] : SET_TOOL[set]);
