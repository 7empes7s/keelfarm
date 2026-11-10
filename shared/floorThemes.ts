// Floor themes (#370): what a floor in the 3D office is dressed as, so a game studio looks nothing like a trading desk.
// The id lives on the floor (PersistedRepo.theme, RepoView.theme); the look itself is client data
// (client/src/world/floorThemes/packs.ts). Unknown or missing ids are the plain office, so old floors stay as they were.

export const FLOOR_THEMES = ['office', 'game-studio', 'trading'] as const;
export type FloorTheme = (typeof FLOOR_THEMES)[number];

/** For the settings' theme cards: a short name, a line on the mood, and the colours of its preview swatch. */
export const FLOOR_THEME_INFO: Record<FloorTheme, { name: string; blurb: string; swatch: [string, string, string] }> = {
  office: { name: 'Office', blurb: 'The bright, warm coding office', swatch: ['#fbf3e4', '#d9b48a', '#3a86ff'] },
  'game-studio': { name: 'Game studio', blurb: 'Dim and moody, neon, arcades and a Playtest screen', swatch: ['#241c3a', '#b14cff', '#2de2e6'] },
  trading: { name: 'Trading floor', blurb: 'Bright and glassy, tickers, charts and world clocks', swatch: ['#e9eef5', '#1f3b5c', '#19c37d'] },
};

const isFloorTheme = (raw: unknown): raw is FloorTheme => FLOOR_THEMES.includes(raw as FloorTheme);

/** A floor's theme as stored: anything unknown (missing, old, corrupt) is the plain office. */
export const floorThemeOf = (raw: unknown): FloorTheme => (isFloorTheme(raw) ? raw : 'office');

/** A theme from a request: throws a message the manager or the CEO can act on when it isn't one. */
export function cleanFloorTheme(raw: unknown): FloorTheme {
  if (isFloorTheme(raw)) return raw;
  throw new Error(`theme must be one of ${FLOOR_THEMES.join(', ')}`);
}
