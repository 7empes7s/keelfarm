// Floor themes (#370): what a floor in the 3D office is dressed as, so a game studio looks nothing like a trading desk.
// The id lives on the floor (PersistedRepo.theme, RepoView.theme); the look itself is client data
// (client/src/world/floorThemes/packs.ts). Unknown or missing ids are the plain office, so old floors stay as they were.
// A floor's confirmed use case picks its theme (#528) until the manager picks one by hand (PersistedRepo.themeByHand).
import type { UseCase } from './types/setup.ts';

// New themes go at the end: the demo dresses floor N in the Nth (`--floors 7` shows them all).
export const FLOOR_THEMES = ['office', 'game-studio', 'trading', 'design-studio', 'media-studio', 'research-lab', 'ops-control'] as const;
export type FloorTheme = (typeof FLOOR_THEMES)[number];

/**
 * For the settings' theme cards and the lobby's directory (#371): a short name, a line on the mood, the colours of its
 * preview swatch (walls, floor, accent) and the glyph the directory draws by the floor.
 */
export const FLOOR_THEME_INFO: Record<FloorTheme, { name: string; blurb: string; swatch: [string, string, string]; glyph: string }> = {
  office: { name: 'Office', blurb: 'The bright, warm coding office', swatch: ['#fbf3e4', '#d9b48a', '#3a86ff'], glyph: '💻' },
  'game-studio': { name: 'Game studio', blurb: 'Dim and moody, neon, arcades and a Playtest screen', swatch: ['#241c3a', '#b14cff', '#2de2e6'], glyph: '🕹️' },
  trading: { name: 'Trading floor', blurb: 'Bright and glassy, tickers, charts and world clocks', swatch: ['#e9eef5', '#1f3b5c', '#19c37d'], glyph: '📈' },
  'design-studio': { name: 'Design studio', blurb: 'Warm daylight, oak and pastels, a mood board and a gallery of the latest screens', swatch: ['#f6e7ea', '#e3c9a0', '#ff8fab'], glyph: '🎨' },
  'media-studio': { name: 'Media studio', blurb: 'Editing bays, ring lights, a green screen and an ON AIR light', swatch: ['#2b2d36', '#3d3f4a', '#ff4d6d'], glyph: '🎬' },
  'research-lab': { name: 'Research lab', blurb: 'Cool blue, blinking server racks, equations and a QA pass-rate curve', swatch: ['#dde9f7', '#9fb3c8', '#3d8bff'], glyph: '🔬' },
  'ops-control': { name: 'Ops control room', blurb: 'A dark control room: status walls, an alert beacon and a big clock', swatch: ['#11161f', '#1f2733', '#22e39b'], glyph: '🛰️' },
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
const USE_CASE_THEME: Partial<Record<UseCase, FloorTheme>> = { video: 'media-studio', 'game-3d': 'game-studio', design: 'design-studio', research: 'research-lab', ops: 'ops-control' };

export const themeForUseCase = (useCase: UseCase): FloorTheme => USE_CASE_THEME[useCase] ?? 'office';

interface ThemedFloor {
  theme?: FloorTheme;
  themeByHand?: boolean; // undefined: saved before #528
  setup?: { useCase: UseCase | null; guessed: boolean };
}

/** A floor's theme once its use case is set: it follows the use case unless the manager picked one by hand. */
export const themeAfterUseCase = (f: ThemedFloor, useCase: UseCase): FloorTheme | undefined => (f.themeByHand ? f.theme : themeForUseCase(useCase));

/**
 * Once, for floors saved before #528: a theme already saved was the manager's pick (only their picker saved one), and a
 * floor never themed gets its confirmed use case's theme. A guessed use case leaves it as it is.
 */
export function upgradeFloorTheme(f: ThemedFloor): { theme?: FloorTheme; themeByHand: boolean } {
  if (f.themeByHand !== undefined) return { theme: f.theme, themeByHand: f.themeByHand };
  if (f.theme !== undefined) return { theme: f.theme, themeByHand: true };
  const u = f.setup && !f.setup.guessed ? f.setup.useCase : null;
  return { theme: u ? themeForUseCase(u) : undefined, themeByHand: false };
}
