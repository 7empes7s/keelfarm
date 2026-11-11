// Deep links (#413): one table of every page, tab, sheet and 3D place reachable by URL, in both offices. Pure: a hash
// parses to a Route, a Route formats back to its hash, and resolves against the office (floors, agents) to what opens
// it: a store overlay, a pocket tab, a 3D spot to stand at, a tour step. routeLink.ts applies it and writes the open
// overlay back to the address. Console sections (#settings/providers) and the Previews page (#previews/3/pr-12) keep
// their older hashes, owned by consoleNavRules.ts and previewGroups.ts.
import type { AgentView, RepoView } from '../../shared/types';
import { CEO_ID } from '../../shared/types';
import type { HelpTab, Overlay, PhoneTab } from './store';
import { POCKET_TABS } from './pocket/pocketData';
import { hashFor, parseHash as parseSection, sectionById, type SectionId } from './ui/consoleNavRules';
import { parsePreviewsHash, previewsHash } from './ui/previewGroups';
import { prPage } from './ui/prNav';
import { TOUR } from './ui/tourSteps';

export type Mode = 'pocket' | 'office';
type PocketTab = (typeof POCKET_TABS)[number];
type AgentTab = 'chat' | 'terminal' | 'now' | 'profile' | 'setup';
type Sheet = 'usage' | 'notices' | 'elevator' | 'catalogue' | 'floor-list' | 'sound';
type Place = 'manager' | 'ceo' | 'maproom' | 'lobby' | 'screens';

export type Route =
  | { to: 'tab'; tab: PocketTab }
  | { to: 'console'; section: SectionId }
  | { to: 'previews'; floor: number | null; pr: number | null }
  | { to: 'kanban' | 'app' | 'decor'; floor: number }
  | { to: 'agent'; name: string; tab: AgentTab }
  | { to: 'pr' | 'issue'; floor: number; number: number }
  | { to: Sheet }
  | { to: 'phone'; tab: PhoneTab }
  | { to: 'help'; tab: HelpTab }
  | { to: 'tour'; step: string }
  | { to: '3d'; place: 'floor' | 'whiteboard'; floor: number }
  | { to: '3d'; place: 'desk'; name: string }
  | { to: '3d'; place: Place };

const AGENT_TABS: readonly AgentTab[] = ['chat', 'terminal', 'now', 'profile', 'setup'];
const SHEETS: readonly Sheet[] = ['usage', 'notices', 'elevator', 'catalogue', 'floor-list', 'sound'];
const PHONE_TABS: readonly PhoneTab[] = ['chat', 'hires', 'company', 'games'];
const HELP_TABS: readonly HelpTab[] = ['office', 'controls'];
const PLACES: readonly Place[] = ['manager', 'ceo', 'maproom', 'lobby', 'screens'];
const FLOOR_VIEWS = ['kanban', 'app', 'decor'] as const;

/** Every route: its pattern, what it opens, and the offices it opens in (docs/deep-links.md lists them for QA). */
export const ROUTES: { pattern: string; about: string; modes: Mode[]; kinds: string[] }[] = [
  { pattern: '#tab/<company|chat|kanban|team|approvals>', about: "pocket mode's tab (the 3D office opens the same thing: phone chat, console, Kanban)", modes: ['pocket', 'office'], kinds: ['tab'] },
  { pattern: '#<group>/<section>', about: "a console section, e.g. #settings/providers, #company/ops (#console/… works too)", modes: ['pocket', 'office'], kinds: ['console'] },
  { pattern: '#previews[/<floor>/<main|pr-N>]', about: 'the Previews page, on a floor and channel', modes: ['pocket', 'office'], kinds: ['previews'] },
  { pattern: '#floor/<N>/kanban', about: "a floor's Kanban (3D: at its whiteboard)", modes: ['pocket', 'office'], kinds: ['kanban'] },
  { pattern: '#floor/<N>/app', about: "a floor's app preview", modes: ['pocket', 'office'], kinds: ['app'] },
  { pattern: '#floor/<N>/decor', about: "a floor's decor box", modes: ['office'], kinds: ['decor'] },
  { pattern: '#agent/<name>/<chat|terminal|now|profile|setup>', about: "an agent's window on that tab (3D: at their desk)", modes: ['pocket', 'office'], kinds: ['agent'] },
  { pattern: '#pr/<floor>/<N>', about: "a PR's page", modes: ['pocket', 'office'], kinds: ['pr'] },
  { pattern: '#issue/<floor>/<N>', about: "an issue's page", modes: ['pocket', 'office'], kinds: ['issue'] },
  { pattern: '#usage', about: "Mission control at Claude's usage", modes: ['pocket', 'office'], kinds: ['usage'] },
  { pattern: '#notices', about: 'the notification centre', modes: ['pocket', 'office'], kinds: ['notices'] },
  { pattern: '#sound', about: 'the sound settings', modes: ['pocket', 'office'], kinds: ['sound'] },
  { pattern: '#elevator', about: 'the elevator panel', modes: ['office'], kinds: ['elevator'] },
  { pattern: '#catalogue', about: "the lobby's catalogue kiosk", modes: ['office'], kinds: ['catalogue'] },
  { pattern: '#floor-list', about: 'this floor as a list', modes: ['office'], kinds: ['floor-list'] },
  { pattern: '#phone/<chat|hires|company|games>', about: 'the phone on a tab', modes: ['office'], kinds: ['phone'] },
  { pattern: '#help/<office|controls>', about: 'help on a tab', modes: ['office'], kinds: ['help'] },
  { pattern: '#tour/<step id>', about: 'one tour step (ids in client/src/ui/tourSteps.ts)', modes: ['pocket', 'office'], kinds: ['tour'] },
  { pattern: '#3d/floor/<N>[/whiteboard]', about: 'the camera on a floor, or at its whiteboard', modes: ['office'], kinds: ['3d:floor', '3d:whiteboard'] },
  { pattern: '#3d/desk/<name>', about: "the camera at an agent's desk", modes: ['office'], kinds: ['3d:desk'] },
  { pattern: '#3d/<manager|ceo|maproom|lobby|screens>', about: "the camera in the manager's or the CEO's office, the map room, the lobby or at its screens", modes: ['office'], kinds: ['3d:manager', '3d:ceo', '3d:maproom', '3d:lobby', '3d:screens'] },
];

/** A route's row in the table: its `to`, and a 3D route's place. */
export const routeKind = (r: Route) => (r.to === '3d' ? `3d:${r.place}` : r.to);

// ---------- parse and format ----------

const num = (s: string | undefined) => (s && /^\d{1,6}$/.test(s) ? Number(s) : null);
const has = <T extends string>(list: readonly T[], s: string | undefined): s is T => !!s && (list as readonly string[]).includes(s);
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** A hash (with or without its #) → its route; null for none or anything not in the table. */
export function parseRoute(hash: string): Route | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  const p = raw.split('/');
  // #console/settings/providers and #console/providers are the same section as #settings/providers
  const sectionHash = p[0] !== 'console' ? raw : p.length > 2 ? `${p[1]}/${p[2]}` : `${sectionById(p[1] ?? '')?.group}/${p[1]}`;
  const section = parseSection(sectionHash, 'office') ?? parseSection(sectionHash, 'pocket');
  if (section) return { to: 'console', section: section.id };
  const prev = parsePreviewsHash(raw);
  if (prev) return { to: 'previews', ...prev };
  const [a, b, c, d] = p;
  if (a === 'tab' && has(POCKET_TABS, b)) return { to: 'tab', tab: b };
  if (a === 'floor' && num(b) != null && has(FLOOR_VIEWS, c)) return { to: c, floor: num(b)! };
  if (a === 'agent' && b && has(AGENT_TABS, c ?? 'terminal')) return { to: 'agent', name: decode(b), tab: (c ?? 'terminal') as AgentTab };
  if ((a === 'pr' || a === 'issue') && num(b) != null && num(c) != null) return { to: a, floor: num(b)!, number: num(c)! };
  if (has(SHEETS, a) && !b) return { to: a };
  if (a === 'phone' && has(PHONE_TABS, b ?? 'chat')) return { to: 'phone', tab: (b ?? 'chat') as PhoneTab };
  if (a === 'help' && has(HELP_TABS, b ?? 'office')) return { to: 'help', tab: (b ?? 'office') as HelpTab };
  if (a === 'tour' && b && TOUR.some((e) => e.id === b)) return { to: 'tour', step: b };
  if (a === '3d') {
    if (b === 'floor' && num(c) != null && (!d || d === 'whiteboard')) return { to: '3d', place: d ? 'whiteboard' : 'floor', floor: num(c)! };
    if (b === 'desk' && c) return { to: '3d', place: 'desk', name: decode(c) };
    if (has(PLACES, b) && !c) return { to: '3d', place: b };
  }
  return null;
}

/** The console section a hash opens in `mode`, in any of its forms (#settings/providers, #console/providers…): pocket
 * mode starts on it, so its cold console links open natively. */
export function linkedSection(hash: string, mode: Mode): SectionId | null {
  const r = parseRoute(hash);
  const s = r?.to === 'console' ? sectionById(r.section) : undefined;
  return s && (!s.only || s.only === mode) ? s.id : null;
}

/** A route's hash: the one link for it (parseRoute(routeHash(r)) is r). */
export function routeHash(r: Route): string {
  switch (r.to) {
    case 'tab':
      return `#tab/${r.tab}`;
    case 'console':
      return hashFor(sectionById(r.section)!);
    case 'previews':
      return previewsHash(r.floor, r.pr);
    case 'kanban':
    case 'app':
    case 'decor':
      return `#floor/${r.floor}/${r.to}`;
    case 'agent':
      return `#agent/${encodeURIComponent(r.name)}/${r.tab}`;
    case 'pr':
    case 'issue':
      return `#${r.to}/${r.floor}/${r.number}`;
    case 'phone':
    case 'help':
      return `#${r.to}/${r.tab}`;
    case 'tour':
      return `#tour/${r.step}`;
    case '3d':
      if (r.place === 'floor') return `#3d/floor/${r.floor}`;
      if (r.place === 'whiteboard') return `#3d/floor/${r.floor}/whiteboard`;
      if (r.place === 'desk') return `#3d/desk/${encodeURIComponent(r.name)}`;
      return `#3d/${r.place}`;
    default:
      return `#${r.to}`;
  }
}

// ---------- what a route opens ----------

/** The office a route resolves against: the snapshot's floors and agents, and the floor you're on (3D). */
export interface World {
  repos: readonly Pick<RepoView, 'id' | 'floor' | 'pulls'>[];
  agents: Readonly<Record<string, Pick<AgentView, 'id' | 'name' | 'repoId' | 'desk' | 'role'>>>;
  floor: number;
}

/** A spot to stand at in the 3D office (world/routeStand.ts places it): a desk's, the whiteboard's, or a named one. */
export type Spot = { desk: number } | 'board' | 'elevator' | 'manager' | 'ceo' | 'reception' | 'screens';

/** Where the 3D camera goes: a floor (0: the lobby) and a spot on it. */
export interface Stand {
  floor: number;
  at: Spot;
}

export interface Target {
  /** The overlay to open (null: none, the place itself is the view). */
  overlay: Overlay | null;
  /** Pocket mode's tab to show. */
  tab?: PocketTab;
  /** 3D: where to stand first. */
  stand?: Stand;
  /** A tour step to show on its own. */
  tour?: string;
  /** Pocket mode opens this route itself on a cold load (its console and Previews links): only wait for it then. */
  native?: boolean;
  /** The selector that shows the routed view has rendered (null: nothing to wait for but the state). */
  ready: string | null;
}

const PANEL = '.panel';
const PHONE = '.phone'; // the 3D office's phone isn't a panel
const CHAT = '.pocket .phone-chat'; // the Chat tab, or the chat docked beside the pages on a wide screen

const lobby = (at: Spot): Stand => ({ floor: 0, at });

/** An agent by name (any case), or the CEO by 'ceo'. */
const agentNamed = (w: World, name: string) => {
  const n = name.toLowerCase();
  return Object.values(w.agents).find((a) => a.name.toLowerCase() === n || (n === CEO_ID && a.id === CEO_ID));
};

/** Where you stand to see an agent at work: behind their chair (the CEO's in the lobby). */
function deskStand(w: World, a: Pick<AgentView, 'id' | 'repoId' | 'desk' | 'role'>): Stand | undefined {
  if (a.role === 'ceo') return lobby('ceo');
  const floor = w.repos.find((r) => r.id === a.repoId)?.floor;
  return floor == null ? undefined : { floor, at: { desk: a.desk } };
}

const boardStand = (floor: number): Stand => ({ floor, at: 'board' });

/** What opening `r` in `mode` shows, or null when it can't there (no such floor, agent or step, or a 3D-only place on a phone). */
export function routeTarget(r: Route, w: World, mode: Mode): Target | null {
  const office = mode === 'office';
  const repoAt = (floor: number) => w.repos.find((x) => x.floor === floor);
  switch (r.to) {
    case 'tab': {
      if (!office) return { overlay: null, tab: r.tab, ready: r.tab === 'chat' ? CHAT : `.pk-main[data-tab="${r.tab}"]` };
      if (r.tab === 'chat') return { overlay: { kind: 'phone', tab: 'chat' }, ready: PHONE };
      if (r.tab === 'approvals') return { overlay: { kind: 'phone', tab: 'hires' }, ready: PHONE };
      if (r.tab === 'kanban') {
        const repo = repoAt(w.floor) ?? w.repos[0];
        return repo ? { overlay: { kind: 'kanban', repoId: repo.id }, stand: boardStand(repo.floor), ready: PANEL } : null;
      }
      return { overlay: { kind: 'manager', tab: r.tab === 'team' ? 'team' : 'ops' }, ready: PANEL };
    }
    case 'console': {
      const section = sectionById(r.section);
      if (!section || (section.only && section.only !== mode)) return null;
      return { overlay: { kind: 'manager', tab: r.section }, native: !office, ready: office ? PANEL : '.pk-settings' };
    }
    case 'previews': {
      const repo = r.floor == null ? undefined : repoAt(r.floor);
      if (r.floor != null && !repo) return null;
      return { overlay: { kind: 'previews', repoId: repo?.id, pr: repo ? r.pr : null }, native: !office, ready: PANEL };
    }
    case 'kanban':
    case 'app':
    case 'decor': {
      const repo = repoAt(r.floor);
      if (!repo || (r.to === 'decor' && !office)) return null;
      if (r.to === 'app') return { overlay: { kind: 'app', repoId: repo.id, pr: null }, ready: PANEL };
      if (!office) return { overlay: { kind: 'kanban', repoId: repo.id }, ready: '.pk-main[data-tab="kanban"]' }; // pocket mode shows it as its Kanban tab
      return { overlay: r.to === 'kanban' ? { kind: 'kanban', repoId: repo.id } : { kind: 'decor-box', repoId: repo.id }, stand: r.to === 'kanban' ? boardStand(r.floor) : undefined, ready: PANEL };
    }
    case 'agent': {
      const a = agentNamed(w, r.name);
      if (!a) return null;
      if (!office && a.id === CEO_ID) return { overlay: null, tab: 'chat', ready: CHAT };
      const view = r.tab === 'chat' || r.tab === 'terminal' ? r.tab : undefined;
      const details = view ? undefined : (r.tab as 'now' | 'profile' | 'setup');
      return { overlay: { kind: 'terminal', agentId: a.id, view, details }, stand: office ? deskStand(w, a) : undefined, ready: PANEL };
    }
    case 'pr':
    case 'issue': {
      const repo = repoAt(r.floor);
      if (!repo) return null;
      const overlay = (r.to === 'pr' ? prPage(repo, r.number) : null) ?? { kind: 'card', repoId: repo.id, key: `${r.to === 'pr' ? 'pr' : 'i'}-${r.number}`, number: r.number, pr: r.to === 'pr' };
      return { overlay, ready: PANEL };
    }
    case 'usage':
      return { overlay: { kind: 'manager', tab: 'ops', card: 'usage' }, ready: office ? PANEL : '.pk-settings' };
    case 'notices':
      return { overlay: { kind: 'notices' }, ready: PANEL };
    case 'sound':
      return { overlay: office ? { kind: 'help', tab: 'office' } : { kind: 'manager', tab: 'voice' }, ready: office ? PANEL : '.pk-settings' };
    case 'elevator':
    case 'catalogue':
    case 'floor-list':
      if (!office) return null;
      return { overlay: r.to === 'floor-list' ? { kind: 'floorList' } : { kind: r.to }, stand: r.to === 'catalogue' ? lobby('reception') : undefined, ready: PANEL };
    case 'phone':
      return office ? { overlay: { kind: 'phone', tab: r.tab }, ready: PHONE } : null;
    case 'help':
      return office ? { overlay: { kind: 'help', tab: r.tab }, ready: PANEL } : null;
    case 'tour':
      return { overlay: null, tour: r.step, ready: '.tour' };
    case '3d': {
      if (!office) return null;
      if (r.place === 'floor' || r.place === 'whiteboard') {
        if (r.floor !== 0 && !repoAt(r.floor)) return null;
        return { overlay: null, stand: r.place === 'whiteboard' ? boardStand(r.floor) : { floor: r.floor, at: 'elevator' }, ready: null };
      }
      if (r.place === 'desk') {
        const a = agentNamed(w, r.name);
        const stand = a && deskStand(w, a);
        return stand ? { overlay: null, stand, ready: null } : null;
      }
      if (r.place === 'maproom') return { overlay: { kind: 'mapRoom' }, stand: lobby('ceo'), ready: '.map-room' };
      return { overlay: null, stand: lobby(r.place === 'lobby' ? 'elevator' : r.place), ready: null };
    }
  }
}

// ---------- the open overlay as a link ----------

/** The routes an open overlay writes to the address in each office: pocket mode shows the others as its tabs and console. */
const WRITES: Record<Mode, readonly Route['to'][]> = {
  office: ['agent', 'kanban', 'app', 'decor', 'pr', 'issue', 'phone', 'help', 'notices', 'elevator', 'catalogue', 'floor-list', '3d'],
  pocket: ['agent', 'pr', 'issue', 'notices', 'app'],
};

/** The route of what's open, for the address; null when it has no link of its own here (console and Previews write theirs). */
export function overlayRoute(o: Overlay | null, w: World, mode: Mode): Route | null {
  const r = overlayToRoute(o, w);
  return r && WRITES[mode].includes(r.to) ? r : null;
}

/** True for a hash an overlay writes here (closing it clears that); the console's, Previews', tabs' and places' aren't. */
export function ownsHash(hash: string, mode: Mode): boolean {
  const r = parseRoute(hash);
  return !!r && WRITES[mode].includes(r.to) && (r.to !== '3d' || r.place === 'maproom');
}

function overlayToRoute(o: Overlay | null, w: World): Route | null {
  if (!o) return null;
  const floorOf = (repoId: string | undefined) => w.repos.find((r) => r.id === repoId)?.floor;
  switch (o.kind) {
    case 'terminal': {
      const a = w.agents[o.agentId];
      return a ? { to: 'agent', name: a.id === CEO_ID ? CEO_ID : a.name, tab: o.details ?? o.view ?? 'terminal' } : null;
    }
    case 'kanban':
    case 'app':
    case 'decor-box': {
      const floor = floorOf(o.repoId);
      return floor == null ? null : { to: o.kind === 'decor-box' ? 'decor' : o.kind, floor };
    }
    case 'card': {
      const floor = floorOf(o.repoId);
      return floor == null ? null : { to: o.pr ? 'pr' : 'issue', floor, number: o.number };
    }
    case 'phone':
      return { to: 'phone', tab: o.tab ?? 'chat' };
    case 'help':
      return { to: 'help', tab: o.tab ?? 'office' };
    case 'notices':
    case 'elevator':
    case 'catalogue':
      return { to: o.kind };
    case 'floorList':
      return { to: 'floor-list' };
    case 'mapRoom':
      return { to: '3d', place: 'maproom' };
    default:
      return null;
  }
}

/** A real link for every route in the table, from this office's floors and agents (QA's list; the e2e walks it). */
export function sampleLinks(w: World, mode: Mode): string[] {
  const repo = [...w.repos].sort((a, b) => a.floor - b.floor)[0];
  const agent = Object.values(w.agents).find((a) => a.id !== CEO_ID && w.repos.some((r) => r.id === a.repoId));
  const pr = repo?.pulls[0]?.number;
  const routes: (Route | null)[] = [
    ...POCKET_TABS.map((tab): Route => ({ to: 'tab', tab })),
    { to: 'console', section: 'providers' },
    { to: 'console', section: 'ops' },
    { to: 'previews', floor: null, pr: null },
    repo ? { to: 'kanban', floor: repo.floor } : null,
    repo ? { to: 'app', floor: repo.floor } : null,
    repo ? { to: 'decor', floor: repo.floor } : null,
    ...(agent ? AGENT_TABS.map((tab): Route => ({ to: 'agent', name: agent.name, tab })) : []),
    repo && pr != null ? { to: 'pr', floor: repo.floor, number: pr } : null,
    repo ? { to: 'issue', floor: repo.floor, number: 1 } : null,
    ...SHEETS.map((s): Route => ({ to: s })),
    { to: 'phone', tab: 'hires' },
    { to: 'help', tab: 'controls' },
    { to: 'tour', step: TOUR[0].id },
    repo ? { to: '3d', place: 'floor', floor: repo.floor } : null,
    repo ? { to: '3d', place: 'whiteboard', floor: repo.floor } : null,
    agent ? { to: '3d', place: 'desk', name: agent.name } : null,
    ...PLACES.map((place): Route => ({ to: '3d', place })),
  ];
  return routes.filter((r): r is Route => !!r && !!routeTarget(r, w, mode)).map(routeHash);
}
