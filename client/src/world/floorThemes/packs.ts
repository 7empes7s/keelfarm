// Floor themes (#370, #371) as data: what a floor dressed as a game studio, a trading floor, a design or media
// studio, a research lab or an ops control room changes. Its mood (how bright
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
  | 'navy-rug'
  // design studio (#371)
  | 'drafting-pair'
  | 'material-shelf'
  | 'easel'
  | 'arc-lamp'
  | 'mood-board'
  | 'swatch-strip'
  | 'art-print'
  | 'swatch-rug'
  // media studio
  | 'edit-bay'
  | 'green-screen'
  | 'ring-light'
  | 'softbox'
  | 'film-posters'
  | 'waveform'
  | 'shot-list'
  | 'studio-rug'
  // research lab
  | 'rack-pair'
  | 'training-room'
  | 'server-rack'
  | 'mobile-board'
  | 'equations'
  | 'net-diagram'
  | 'lab-rug'
  // ops control room
  | 'noc-console'
  | 'ups'
  | 'network-map'
  | 'runbook'
  | 'grid-rug';

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
  wallScreen: 'playtest' | 'market' | 'gallery' | 'calendar' | 'loss' | 'noc';
  /** What a merge (or E) sounds and looks like: the gong, or a trading bell. */
  merge: 'gong' | 'bell';
  ambience: 'synth' | 'murmur' | 'hum';
  /** Song ids (jukeboxSongs.ts SONGS) that take turns with the rest of the playlist. */
  playlist: string[];
  /** The side monitors on every working desk: an engine's viewport, price charts, a design canvas, an editor's timeline, training plots or dashboards. */
  deskScreens: 'engine' | 'charts' | 'canvas' | 'timeline' | 'plots' | 'dashboards';
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
  'design-studio': {
    id: 'design-studio',
    mood: {
      light: 1.15,
      tint: '#ffe2b8',
      tintAmount: 0.28,
      grade: { shadows: '#c9a3ff', highlights: '#ffe9c7', amount: 0.14, saturation: 1.05, contrast: 1.0 },
    },
    shell: { floor: '#e3c9a0', wall: '#f6e7ea', rug: '#f7c8d0' },
    props: {
      'b-west': 'drafting-pair',
      'b-lounge': 'material-shelf',
      'b-south': 'drafting-pair',
      'f-ne': 'arc-lamp',
      'f-se': 'easel',
      'f-sw': 'arc-lamp',
      'f-west': 'easel',
      'w-west': 'mood-board',
      'w-south-w': 'art-print',
      'w-south-e': 'swatch-strip',
      'w-north-e': 'mood-board',
      'w-kitchen': 'art-print',
      'r-lounge': 'swatch-rug',
      'r-entry': 'swatch-rug',
    },
    wallScreen: 'gallery',
    merge: 'gong',
    ambience: 'murmur',
    playlist: ['pair-programming-by-the-window', 'hello-world-sunrise', 'coffee-break-bossa'],
    deskScreens: 'canvas',
  },
  'media-studio': {
    id: 'media-studio',
    mood: {
      light: 0.62,
      tint: '#ff9fb2',
      tintAmount: 0.22,
      grade: { shadows: '#3a2f5c', highlights: '#ffd0a8', amount: 0.16, saturation: 1.1, contrast: 1.1 },
    },
    shell: { floor: '#3d3f4a', wall: '#2b2d36', rug: '#1d1e25' },
    props: {
      'b-west': 'edit-bay',
      'b-lounge': 'green-screen',
      'b-south': 'edit-bay',
      'f-ne': 'ring-light',
      'f-se': 'softbox',
      'f-sw': 'ring-light',
      'f-west': 'softbox',
      'w-west': 'film-posters',
      'w-south-w': 'waveform',
      'w-south-e': 'shot-list',
      'w-north-e': 'film-posters',
      'w-kitchen': 'waveform',
      'r-lounge': 'studio-rug',
      'r-entry': 'studio-rug',
    },
    wallScreen: 'calendar',
    merge: 'gong',
    ambience: 'murmur',
    playlist: ['ship-it', 'deploy-on-a-friday', 'going-up'],
    deskScreens: 'timeline',
  },
  'research-lab': {
    id: 'research-lab',
    mood: {
      light: 0.9,
      tint: '#9cc8ff',
      tintAmount: 0.4,
      grade: { shadows: '#2f6bd8', highlights: '#d8f0ff', amount: 0.18, saturation: 0.95, contrast: 1.06 },
    },
    shell: { floor: '#9fb3c8', wall: '#dde9f7', rug: '#3b5b86' },
    props: {
      'b-west': 'rack-pair',
      'b-lounge': 'training-room',
      'b-south': 'rack-pair',
      'f-ne': 'server-rack',
      'f-se': 'server-rack',
      'f-sw': 'mobile-board',
      'f-west': 'server-rack',
      'w-west': 'equations',
      'w-south-w': 'net-diagram',
      'w-south-e': 'equations',
      'w-north-e': 'net-diagram',
      'w-kitchen': 'equations',
      'r-lounge': 'lab-rug',
      'r-entry': 'lab-rug',
    },
    wallScreen: 'loss',
    merge: 'bell',
    ambience: 'hum',
    playlist: ['stack-trace-study-session', 'full-coverage', 'deep-work'],
    deskScreens: 'plots',
  },
  'ops-control': {
    id: 'ops-control',
    mood: {
      light: 0.42,
      tint: '#3d6dff',
      tintAmount: 0.38,
      grade: { shadows: '#163a7a', highlights: '#7affc8', amount: 0.2, saturation: 1.05, contrast: 1.12 },
    },
    shell: { floor: '#1f2733', wall: '#11161f', rug: '#0b0f16' },
    props: {
      'b-west': 'noc-console',
      'b-lounge': 'rack-pair',
      'b-south': 'noc-console',
      'f-ne': 'server-rack',
      'f-se': 'ups',
      'f-sw': 'server-rack',
      'f-west': 'ups',
      'w-west': 'network-map',
      'w-south-w': 'runbook',
      'w-south-e': 'network-map',
      'w-north-e': 'runbook',
      'w-kitchen': 'network-map',
      'r-lounge': 'grid-rug',
      'r-entry': 'grid-rug',
    },
    wallScreen: 'noc',
    merge: 'bell',
    ambience: 'hum',
    playlist: ['late-night-code-review', 'refactor-rain', 'background-process'],
    deskScreens: 'dashboards',
  },
};

/** The pack for a floor's theme; null for the plain office (and anything unknown), which draws as it always has. */
export const themePack = (theme: FloorTheme | undefined | null): ThemePack | null => (theme && theme !== 'office' ? (THEME_PACKS[theme] ?? null) : null);
