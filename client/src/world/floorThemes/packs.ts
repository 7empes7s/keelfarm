// Floor themes (#370, #371) as data: what a floor dressed as a game studio, a trading floor, a design or video
// studio, a research lab, an ops control room or a newsroom (#570) changes. Its mood (how bright
// the room's lights are, their tint and High's colour grade: never darker than the office, #570), its floor, wall and
// rug colours (light, the theme's colour in the accents), the sign hung over the room, its set pieces in the aisles, the
// props it puts in the decoration slots (#210) nobody has filled, the screen on the north wall, its merge sound,
// ambience and the songs its jukebox leans to. The plain office has no pack: it stays exactly as it was. Pure; the scenes that draw a
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
  | 'grid-rug'
  // set pieces (#570)
  | 'arcade-row'
  | 'game-lounge'
  | 'camera-set'
  // newsroom (#570)
  | 'anchor-desk'
  | 'story-board'
  | 'paper-stack'
  | 'front-pages'
  | 'news-rug';

/** The aisles between the desks where a theme's big set pieces stand (#570), kept clear on every floor (placement.ts). */
export type SetSpot = 'aisle-w' | 'aisle-e';

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
  /** The big sign hung over the room, facing the elevator: its words, board and letters (#570). */
  sign: { text: string; bg: string; fg: string };
  /** The theme's big signature pieces, one in each aisle (#570). */
  setPieces: Record<SetSpot, ThemeProp>;
  /** Which empty decoration slot gets which prop (an earned decoration in the slot always wins). */
  props: Record<string, ThemeProp>;
  /** What hangs on the north wall where the office's "ship it" sign is. */
  wallScreen: 'playtest' | 'market' | 'gallery' | 'calendar' | 'loss' | 'noc' | 'tv-wall';
  /** What a merge (or E) sounds and looks like: the gong, or a trading bell. */
  merge: 'gong' | 'bell';
  ambience: 'synth' | 'murmur' | 'hum';
  /** Song ids (jukeboxSongs.ts SONGS) that take turns with the rest of the playlist. */
  playlist: string[];
  /** The side monitors on every working desk: an engine's viewport, price charts, a design canvas, an editor's timeline, training plots, dashboards or a news page. */
  deskScreens: 'engine' | 'charts' | 'canvas' | 'timeline' | 'plots' | 'dashboards' | 'headlines';
}

export const THEME_PACKS: Record<ThemePack['id'], ThemePack> = {
  'game-studio': {
    id: 'game-studio',
    mood: {
      light: 1.0,
      tint: '#e6dcff',
      tintAmount: 0.12,
      grade: { shadows: '#6a4cff', highlights: '#5ff2ff', amount: 0.1, saturation: 1.12, contrast: 1.04 },
    },
    shell: { floor: '#d9d4ec', wall: '#f1ecfb', rug: '#b9a6f5' },
    sign: { text: 'GAME STUDIO', bg: '#2a1f4a', fg: '#5ff2ff' },
    setPieces: { 'aisle-w': 'arcade-row', 'aisle-e': 'game-lounge' },
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
      tintAmount: 0.14,
      grade: { shadows: '#7aa6d8', highlights: '#f2f8ff', amount: 0.15, saturation: 0.92, contrast: 1.06 },
    },
    shell: { floor: '#c9d3df', wall: '#eef3f8', rug: '#8fa6c4' },
    sign: { text: 'TRADING FLOOR', bg: '#1f3b5c', fg: '#19e08d' },
    setPieces: { 'aisle-w': 'quote-pod', 'aisle-e': 'quote-pod' },
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
      tintAmount: 0.14,
      grade: { shadows: '#c9a3ff', highlights: '#ffe9c7', amount: 0.14, saturation: 1.05, contrast: 1.0 },
    },
    shell: { floor: '#e3c9a0', wall: '#f6e7ea', rug: '#f7c8d0' },
    sign: { text: 'DESIGN STUDIO', bg: '#ff8fab', fg: '#ffffff' },
    setPieces: { 'aisle-w': 'drafting-pair', 'aisle-e': 'material-shelf' },
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
      light: 1.0,
      tint: '#ffd6de',
      tintAmount: 0.1,
      grade: { shadows: '#3a2f5c', highlights: '#ffd0a8', amount: 0.1, saturation: 1.08, contrast: 1.04 },
    },
    shell: { floor: '#d8d6de', wall: '#f2eff3', rug: '#b9b6c6' },
    sign: { text: 'VIDEO STUDIO', bg: '#16171d', fg: '#ff4d6d' },
    setPieces: { 'aisle-w': 'camera-set', 'aisle-e': 'edit-bay' },
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
      light: 1.0,
      tint: '#cfe4ff',
      tintAmount: 0.14,
      grade: { shadows: '#2f6bd8', highlights: '#d8f0ff', amount: 0.1, saturation: 0.95, contrast: 1.04 },
    },
    shell: { floor: '#c9d6e3', wall: '#e6eef8', rug: '#93b2d8' },
    sign: { text: 'RESEARCH LAB', bg: '#16243d', fg: '#7fc4ff' },
    setPieces: { 'aisle-w': 'rack-pair', 'aisle-e': 'training-room' },
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
      light: 1.0,
      tint: '#cfe0ff',
      tintAmount: 0.12,
      grade: { shadows: '#163a7a', highlights: '#7affc8', amount: 0.1, saturation: 1.05, contrast: 1.05 },
    },
    shell: { floor: '#cfd5de', wall: '#e9edf2', rug: '#a3afc0' },
    sign: { text: 'OPS CONTROL', bg: '#11161f', fg: '#22e39b' },
    setPieces: { 'aisle-w': 'noc-console', 'aisle-e': 'rack-pair' },
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
  newsroom: {
    id: 'newsroom',
    mood: {
      light: 1.05,
      tint: '#fff3e0',
      tintAmount: 0.08,
      grade: { shadows: '#2b3f5c', highlights: '#fff1dc', amount: 0.08, saturation: 1.0, contrast: 1.04 },
    },
    shell: { floor: '#d7d2c8', wall: '#f7f4ee', rug: '#c9c2b4' },
    sign: { text: 'NEWSROOM', bg: '#d7263d', fg: '#ffffff' },
    setPieces: { 'aisle-w': 'anchor-desk', 'aisle-e': 'story-board' },
    props: {
      'b-west': 'story-board',
      'b-south': 'story-board',
      'f-ne': 'paper-stack',
      'f-se': 'paper-stack',
      'f-sw': 'paper-stack',
      'f-west': 'paper-stack',
      'w-west': 'news-screen',
      'w-south-w': 'front-pages',
      'w-south-e': 'news-screen',
      'w-north-e': 'front-pages',
      'w-kitchen': 'front-pages',
      'r-lounge': 'news-rug',
      'r-entry': 'news-rug',
    },
    wallScreen: 'tv-wall',
    merge: 'bell',
    ambience: 'murmur',
    playlist: ['deep-work', 'background-process', 'coffee-break-bossa'],
    deskScreens: 'headlines',
  },
};

/** The pack for a floor's theme; null for the plain office (and anything unknown), which draws as it always has. */
export const themePack = (theme: FloorTheme | undefined | null): ThemePack | null => (theme && theme !== 'office' ? (THEME_PACKS[theme] ?? null) : null);
