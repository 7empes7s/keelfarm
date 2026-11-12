// Floor themes (#370): what a floor in the 3D office is dressed as, so a game studio looks nothing like a trading desk.
// The id lives on the floor (PersistedRepo.theme, RepoView.theme); the look itself is client data
// (client/src/world/floorThemes/packs.ts). Unknown or missing ids are the plain office, so old floors stay as they were.
// A floor's confirmed use case picks its theme (#528) until the manager picks one by hand (PersistedRepo.themeByHand).
import type { UseCase } from './types/setup.ts';

// New themes go at the end: the demo dresses floor N in the Nth (`--floors 8` shows them all).
export const FLOOR_THEMES = ['office', 'game-studio', 'trading', 'design-studio', 'media-studio', 'research-lab', 'ops-control', 'newsroom'] as const;
export type FloorTheme = (typeof FLOOR_THEMES)[number];

/**
 * For the settings' theme cards and the lobby's directory (#371): a short name, a line on the mood, the colours of its
 * preview swatch (walls, floor, accent) and the glyph the directory draws by the floor.
 */
export const FLOOR_THEME_INFO: Record<FloorTheme, { name: string; blurb: string; swatch: [string, string, string]; glyph: string }> = {
  office: { name: 'Office', blurb: 'The bright, warm coding office', swatch: ['#fbf3e4', '#d9b48a', '#3a86ff'], glyph: '💻' },
  'game-studio': { name: 'Game studio', blurb: 'Bright with neon accents: arcade cabinets, a console lounge and a Playtest screen', swatch: ['#f1ecfb', '#d9d4ec', '#b14cff'], glyph: '🕹️' },
  trading: { name: 'Trading floor', blurb: 'Bright and glassy, tickers, charts and world clocks', swatch: ['#e9eef5', '#1f3b5c', '#19c37d'], glyph: '📈' },
  'design-studio': { name: 'Design studio', blurb: 'Warm daylight, oak and pastels, a mood board and a gallery of the latest screens', swatch: ['#f6e7ea', '#e3c9a0', '#ff8fab'], glyph: '🎨' },
  'media-studio': { name: 'Video studio', blurb: 'Editing bays, cameras on tripods, softboxes, a green screen and an ON AIR light', swatch: ['#f2eff3', '#d8d6de', '#ff4d6d'], glyph: '🎬' },
  'research-lab': { name: 'Research lab', blurb: 'Cool blue, blinking server racks, equations and a QA pass-rate curve', swatch: ['#e6eef8', '#c9d6e3', '#3d8bff'], glyph: '🔬' },
  'ops-control': { name: 'Ops control room', blurb: 'A control room: consoles, status walls, an alert beacon and a big clock', swatch: ['#e9edf2', '#cfd5de', '#22e39b'], glyph: '🛰️' },
  newsroom: { name: 'Newsroom', blurb: 'An anchor desk, a wall of TVs with a headline ticker, story cards and newspaper stacks', swatch: ['#f7f4ee', '#d7d2c8', '#d7263d'], glyph: '📰' },
};

const isFloorTheme = (raw: unknown): raw is FloorTheme => FLOOR_THEMES.includes(raw as FloorTheme);

/** A floor's theme as stored: anything unknown (missing, old, corrupt) is the plain office. */
export const floorThemeOf = (raw: unknown): FloorTheme => (isFloorTheme(raw) ? raw : 'office');

/** A theme from a request: throws a message the manager or the CEO can act on when it isn't one. */
export function cleanFloorTheme(raw: unknown): FloorTheme {
  if (isFloorTheme(raw)) return raw;
  throw new Error(`theme must be one of ${FLOOR_THEMES.join(', ')}`);
}

// ---------- from the use case (#528) ----------

/** The theme a use case dresses its floor in; use cases without a look of their own get the office. */
const USE_CASE_THEME: Partial<Record<UseCase, FloorTheme>> = { video: 'media-studio', 'game-3d': 'game-studio', design: 'design-studio', research: 'research-lab', ops: 'ops-control', marketing: 'newsroom' };

/** What a floor says it's about (PersistedRepo): a news site or a blog is a newsroom whatever it's built with (#570). */
interface FloorWords {
  fullName?: string;
  description?: string;
  summary?: string;
  mission?: string;
}
const NEWS_WORDS = /\b(news\w*|editorial|editors?|blogs?|blogging|magazines?|journalis\w*|headlines?)\b/i;

/** A use case's theme; one without a look of its own gets the newsroom when the floor's words are about news, else the office. */
export function themeForUseCase(useCase: UseCase, floor: FloorWords = {}): FloorTheme {
  const own = USE_CASE_THEME[useCase];
  if (own) return own;
  const words = [floor.fullName?.split('/')[1], floor.description, floor.summary, floor.mission].filter(Boolean).join(' \n ');
  return NEWS_WORDS.test(words) ? 'newsroom' : 'office';
}

interface ThemedFloor extends FloorWords {
  theme?: FloorTheme;
  themeByHand?: boolean; // undefined: saved before #528
  setup?: { useCase: UseCase | null; guessed: boolean };
}

/** A floor's theme once its use case is set: it follows the use case unless the manager picked one by hand. */
export const themeAfterUseCase = (f: ThemedFloor, useCase: UseCase): FloorTheme | undefined => (f.themeByHand ? f.theme : themeForUseCase(useCase, f));

/**
 * Once, for floors saved before #528: a theme already saved was the manager's pick (only their picker saved one), and a
 * floor never themed gets its confirmed use case's theme. A guessed use case leaves it as it is.
 */
export function upgradeFloorTheme(f: ThemedFloor): { theme?: FloorTheme; themeByHand: boolean } {
  if (f.themeByHand !== undefined) return { theme: f.theme, themeByHand: f.themeByHand };
  if (f.theme !== undefined) return { theme: f.theme, themeByHand: true };
  const u = f.setup && !f.setup.guessed ? f.setup.useCase : null;
  return { theme: u ? themeForUseCase(u, f) : undefined, themeByHand: false };
}
