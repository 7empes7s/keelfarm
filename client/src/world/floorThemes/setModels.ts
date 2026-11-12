// The themes' big set pieces and the newsroom's props (#570) as cheap toon models, like themeModels.ts: primitives
// merged into one vertex-coloured geometry each, in their own frame (the floor at y 0, the front to +z, the middle at
// the origin). Screens, softbox faces and signs are planes drawn on top (setScenes.tsx), at the spots exported here.

import { ball, box, cyl, model, type Part } from '../decor/parts';

const INK = '#1f1d2b';

/** A tripod's three legs and its column, up to `h`. */
const tripod = (x: number, z: number, h: number, color = '#343a40'): Part[] => [
  ...[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((a) => cyl(0.018, 0.018, h * 0.95, color, [x + Math.sin(a) * 0.16, h * 0.46, z + Math.cos(a) * 0.16], [-Math.cos(a) * 0.33, 0, Math.sin(a) * 0.33])),
  cyl(0.025, 0.025, 0.25, color, [x, h - 0.08, z]),
];

// ---------- the game studio's console lounge ----------

/** The lounge's TV picture, in its frame. */
export const LOUNGE_TV = { w: 1.5, h: 0.84, y: 1.05, z: -0.42 };

/** A TV on a low cabinet at the back, two beanbags in front and a little table of controllers between them. */
export const gameLoungeModel = () =>
  model('set:game-lounge', () => [
    box(1.8, 0.5, 0.42, '#2a2140', [0, 0.25, -0.42]),
    box(1.6, 0.92, 0.07, INK, [0, LOUNGE_TV.y, -0.46]),
    box(0.16, 0.12, 0.2, INK, [0, 0.56, -0.46]),
    box(0.42, 0.07, 0.3, '#f8f9fa', [0.62, 0.535, -0.38]), // the console
    box(0.38, 0.015, 0.26, '#b14cff', [0.62, 0.575, -0.38]),
    ball(0.4, '#b14cff', [-0.66, 0.26, 0.3], [1, 0.62, 1]),
    ball(0.4, '#2de2e6', [0.66, 0.26, 0.3], [1, 0.62, 1]),
    box(0.46, 0.3, 0.34, '#f1ecfb', [0, 0.15, 0.35]),
    box(0.14, 0.04, 0.09, '#ff3cac', [-0.1, 0.32, 0.33]),
    box(0.14, 0.04, 0.09, '#2de2e6', [0.1, 0.32, 0.38]),
  ]);

// ---------- the video studio's shooting set ----------

/** The softboxes' glowing faces, either side of the stool, turned in toward it. */
export const SET_SOFTBOX = { x: [-0.95, 0.95], y: 1.55, z: 0.0, w: 0.5, h: 0.4, rotY: [0.6, -0.6] };
/** The cameras' red tally lights. */
export const SET_TALLY = [
  { x: -0.45, y: 1.48, z: 0.46 },
  { x: 0.5, y: 1.42, z: 0.5 },
];

/** A white paper backdrop on two stands with a stool in front, a softbox each side and two cameras on tripods facing it. */
export const cameraSetModel = () =>
  model('set:camera-set', () => {
    const parts: Part[] = [
      cyl(0.02, 0.02, 2.0, '#495057', [-1.1, 1.0, -0.56]),
      cyl(0.02, 0.02, 2.0, '#495057', [1.1, 1.0, -0.56]),
      cyl(0.05, 0.05, 2.24, '#e9ecef', [0, 1.96, -0.56], [0, 0, Math.PI / 2]),
      box(2.1, 1.92, 0.02, '#fdfdfd', [0, 1.0, -0.6]),
      box(2.1, 0.02, 0.45, '#fdfdfd', [0, 0.01, -0.36]),
      cyl(0.17, 0.17, 0.05, '#ff4d6d', [0, 0.62, -0.25]),
      cyl(0.02, 0.02, 0.6, '#adb5bd', [0, 0.3, -0.25]),
    ];
    SET_SOFTBOX.x.forEach((x, i) => {
      parts.push(...tripod(x, SET_SOFTBOX.z, 1.4), box(0.56, 0.46, 0.3, INK, [x - Math.sin(SET_SOFTBOX.rotY[i]) * 0.17, SET_SOFTBOX.y, SET_SOFTBOX.z - Math.cos(SET_SOFTBOX.rotY[i]) * 0.17], [0, SET_SOFTBOX.rotY[i], 0]));
    });
    for (const t of SET_TALLY) {
      const h = t.y - 0.08;
      parts.push(...tripod(t.x, t.z, h), box(0.26, 0.2, 0.36, INK, [t.x, h + 0.08, t.z]), cyl(0.07, 0.08, 0.16, '#495057', [t.x, h + 0.08, t.z - 0.24], [Math.PI / 2, 0, 0]));
    }
    return parts;
  });

// ---------- the newsroom ----------

/** The anchor desk's backdrop screen and the logo on the desk's front, in its frame. */
export const ANCHOR_SCREEN = { w: 2.16, h: 1.12, y: 1.66, z: -0.555 };
export const ANCHOR_LOGO = { w: 1.5, h: 0.4, y: 0.52, z: 0.456 };

/** A news anchor's desk facing the room, two chairs behind it and a big backdrop screen. */
export const anchorDeskModel = () =>
  model('set:anchor-desk', () => [
    box(2.4, 2.3, 0.08, '#10213a', [0, 1.15, -0.61]),
    box(2.4, 0.08, 0.1, '#d7263d', [0, 0.98, -0.6]),
    ...[-0.5, 0.5].flatMap((x) => [cyl(0.03, 0.03, 0.5, '#495057', [x, 0.25, -0.15]), box(0.5, 0.1, 0.46, '#2b2d42', [x, 0.52, -0.15]), box(0.5, 0.7, 0.1, '#2b2d42', [x, 0.92, -0.35])]),
    box(2.1, 0.86, 0.5, '#d7263d', [0, 0.43, 0.2]),
    box(2.26, 0.05, 0.66, '#f8f9fa', [0, 0.885, 0.17]),
    box(0.06, 0.18, 0.06, INK, [-0.5, 1.0, 0.1]), // microphones
    box(0.06, 0.18, 0.06, INK, [0.5, 1.0, 0.1]),
    box(0.3, 0.02, 0.22, '#f1efe8', [0.15, 0.92, 0.22]), // the script
  ]);

/** The story board's faces (front and back), in its frame. */
export const STORY_FACE = { w: 2.1, h: 1.12, y: 1.28, z: 0.04 };

/** A whiteboard on wheels, both faces covered in story cards. */
export const storyBoardModel = () =>
  model('set:story-board', () => [
    box(2.24, 1.24, 0.06, '#adb5bd', [0, STORY_FACE.y, 0]),
    ...[-1.02, 1.02].flatMap((x) => [box(0.05, 1.9, 0.05, '#868e96', [x, 0.95, 0]), box(0.08, 0.05, 0.56, '#868e96', [x, 0.06, 0])]),
    box(2.0, 0.04, 0.12, '#868e96', [0, 0.62, 0.06]), // the marker tray
  ]);

/** Bundled newspapers in two stacks, the top one fanned open. */
export const paperStackModel = () =>
  model('set:paper-stack', () => {
    const parts: Part[] = [];
    for (let i = 0; i < 9; i++) parts.push(box(0.3, 0.09, 0.4, i % 2 ? '#d9d4c7' : '#f1efe8', [-0.17, 0.045 + i * 0.1, 0], [0, ((i * 37) % 9) * 0.03 - 0.12, 0]));
    for (let i = 0; i < 5; i++) parts.push(box(0.3, 0.09, 0.4, i % 2 ? '#f1efe8' : '#d9d4c7', [0.18, 0.045 + i * 0.1, 0.02], [0, ((i * 53) % 7) * 0.04 - 0.12, 0]));
    parts.push(box(0.44, 0.01, 0.36, '#f8f9fa', [0.18, 0.51, 0.02], [0, 0.3, 0]), box(0.12, 0.012, 0.08, '#d7263d', [0.12, 0.52, 0]));
    return parts;
  });
