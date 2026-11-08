// Floor themes (#370) as data: what a floor dressed as a game studio or a trading floor changes. Its mood (how bright
// the room's lights are, their tint and High's colour grade), its floor, wall and rug colours, the props it puts in
// the decoration slots (#210) nobody has filled, the screen on the north wall, its merge sound, ambience and the
// songs its jukebox leans to. The plain office has no pack: it stays exactly as it was. Pure; the scenes that draw a
// pack are in the lazy chunk (scenes.tsx).

import type { FloorTheme } from '../../../../shared/floorThemes';

/** A theme's own props. Floor and big slots' props stand on the floor; wall ones hang; rugs lie flat. */
export type ThemeProp =
  // game studio
  | 'arcade'
  | 'arcade-pair'
  | 'tv-console'
  | 'figurines'
  | 'gaming-chair'
  | 'neon-pad'
  | 'neon-gg'
  | 'posters'
  | 'level-sketch'
  | 'neon-rug'
  // trading floor
  | 'bull'
  | 'bear'
  | 'quote-pod'
  | 'tall-planter'
  | 'chart-screen'
  | 'news-screen'
  | 'navy-rug';

/** The room's light: `light` scales the sky light and the ambient (1 = as the time of day has it), mixed toward `tint`. */
export interface FloorMood {
  light: number;
  tint: string;
  tintAmount: number;
  /** High's colour grade on top of the time of day's: tints (luminance-neutral-ish multipliers) and 1 = unchanged. */
  grade: { shadows: string; highlights: string; amount: number; saturation: number; contrast: number };
}

export interface ThemePack {
  id: Exclude<FloorTheme, 'office'>;
  mood: FloorMood;
  shell: { floor: string; wall: string; rug: string };
  /** Which empty decoration slot gets which prop (an earned decoration in the slot always wins). */
  props: Record<string, ThemeProp>;
  /** What hangs on the north wall where the office's "ship it" sign is. */
  wallScreen: 'playtest' | 'market';
  /** What a merge (or E) sounds and looks like: the gong, or a trading bell. */
  merge: 'gong' | 'bell';
  ambience: 'synth' | 'murmur';
  /** Song ids (jukeboxSongs.ts SONGS) that take turns with the rest of the playlist. */
  playlist: string[];
  /** The side monitors on every working desk: an engine's viewport, or price charts. */
  deskScreens: 'engine' | 'charts';
}

export const THEME_PACKS: Record<ThemePack['id'], ThemePack> = {
  'game-studio': {
    id: 'game-studio',
    mood: {
      light: 0.55,
      tint: '#7b5cff',
      tintAmount: 0.35,
      grade: { shadows: '#6a4cff', highlights: '#5ff2ff', amount: 0.18, saturation: 1.12, contrast: 1.08 },
    },
    shell: { floor: '#3a3150', wall: '#4a4266', rug: '#2a2140' },
    props: {
      'b-west': 'arcade-pair',
      'b-lounge': 'tv-console',
      'b-south': 'arcade-pair',
      'f-ne': 'arcade',
      'f-se': 'figurines',
      'f-sw': 'gaming-chair',
      'f-west': 'figurines',
      'w-west': 'neon-pad',
      'w-south-w': 'posters',
      'w-south-e': 'level-sketch',
      'w-north-e': 'posters',
      'w-kitchen': 'neon-gg',
      'r-lounge': 'neon-rug',
      'r-entry': 'neon-rug',
    },
    wallScreen: 'playtest',
    merge: 'gong',
    ambience: 'synth',
    playlist: ['going-up', 'it-compiles', 'late-night-code-review'],
    deskScreens: 'engine',
  },
  trading: {
    id: 'trading',
    mood: {
      light: 1.12,
      tint: '#d6e8ff',
      tintAmount: 0.3,
      grade: { shadows: '#7aa6d8', highlights: '#f2f8ff', amount: 0.15, saturation: 0.92, contrast: 1.06 },
    },
    shell: { floor: '#c9d3df', wall: '#eef3f8', rug: '#2b3f5c' },
    props: {
      'b-west': 'bear',
      'b-lounge': 'quote-pod',
      'b-south': 'bull',
      'f-ne': 'tall-planter',
      'f-se': 'tall-planter',
      'f-sw': 'tall-planter',
      'f-west': 'tall-planter',
      'w-west': 'chart-screen',
      'w-south-w': 'news-screen',
      'w-south-e': 'chart-screen',
      'w-north-e': 'news-screen',
      'w-kitchen': 'chart-screen',
      'r-lounge': 'navy-rug',
      'r-entry': 'navy-rug',
    },
    wallScreen: 'market',
    merge: 'bell',
    ambience: 'murmur',
    playlist: ['green-checks-groove', 'background-process', 'deep-work'],
    deskScreens: 'charts',
  },
};

/** The pack for a floor's theme; null for the plain office (and anything unknown), which draws as it always has. */
export const themePack = (theme: FloorTheme | undefined | null): ThemePack | null => (theme && theme !== 'office' ? (THEME_PACKS[theme] ?? null) : null);
