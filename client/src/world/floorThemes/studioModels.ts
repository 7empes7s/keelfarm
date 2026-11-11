// The second batch of floor themes' props (#371) as cheap toon models, like themeModels.ts: primitives merged into one
// vertex-coloured geometry each, built once, in their own frame (the floor at y 0, the front to +z, the middle at the
// origin). Screens, glass and lights are drawn on top by studioScenes.tsx at the positions exported here.

import { shade } from '../materials';
import { ball, box, cone, cyl, model, torus, type Part } from '../decor/parts';

const OAK = '#e3c08d';
const STEEL = '#adb5bd';
const DARK = '#1b1d24';

// ---------- design studio ----------

/** One drafting table: a tilted white top on oak trestles, a stool, a lamp clamped on. */
function draftingTable(x: number): Part[] {
  return [
    box(0.06, 0.82, 0.6, OAK, [x - 0.4, 0.41, -0.1]),
    box(0.06, 0.82, 0.6, OAK, [x + 0.4, 0.41, -0.1]),
    box(0.86, 0.05, 0.06, OAK, [x, 0.25, -0.1]),
    box(0.9, 0.03, 0.66, '#fbfaf7', [x, 0.92, -0.12], [0.32, 0, 0]),
    box(0.92, 0.035, 0.03, OAK, [x, 0.8, 0.2]),
    box(0.4, 0.004, 0.3, '#cfe8ff', [x - 0.1, 0.94, -0.1], [0.32, 0, 0]), // a sheet of blueprint
    cyl(0.18, 0.18, 0.04, '#ffd6a5', [x, 0.66, 0.38]), // the stool
    cyl(0.025, 0.025, 0.64, STEEL, [x, 0.33, 0.38]),
    cyl(0.16, 0.16, 0.02, STEEL, [x, 0.02, 0.38]),
    cyl(0.012, 0.012, 0.5, '#ff8fab', [x + 0.42, 1.18, -0.36], [0, 0, -0.3]),
    cone(0.07, 0.1, '#ff8fab', [x + 0.32, 1.42, -0.3], [0.9, 0, 0.4]),
  ];
}

export const draftingPairModel = () => model('theme:drafting-pair', () => [...draftingTable(-0.52), ...draftingTable(0.52)]);

/** An oak shelf of material samples: fabric rolls, paint tins and tile chips. */
export const materialShelfModel = () =>
  model('theme:material-shelf', () => {
    const parts: Part[] = [box(2.0, 0.04, 0.46, OAK, [0, 0.02, 0]), box(0.05, 1.8, 0.46, OAK, [-0.98, 0.9, 0]), box(0.05, 1.8, 0.46, OAK, [0.98, 0.9, 0]), box(0.05, 1.8, 0.46, OAK, [0, 0.9, 0])];
    const pastel = ['#ff8fab', '#ffd6a5', '#bde0fe', '#cdb4db', '#b9fbc0', '#fde4cf', '#a2d2ff', '#ffc8dd'];
    for (let s = 0; s < 3; s++) {
      const y = 0.55 + s * 0.6;
      parts.push(box(1.96, 0.03, 0.44, shade(OAK, -0.06), [0, y, 0]));
      for (let i = 0; i < 4; i++) {
        const c = pastel[(s * 4 + i) % pastel.length];
        const x = -0.78 + i * 0.26 + (i > 1 ? 0.48 : 0);
        if (s === 0) parts.push(cyl(0.08, 0.08, 0.38, c, [x, y + 0.1, 0], [Math.PI / 2, 0, 0])); // fabric rolls
        else if (s === 1) parts.push(cyl(0.08, 0.08, 0.13, c, [x, y + 0.08, 0.04]), cyl(0.081, 0.081, 0.02, STEEL, [x, y + 0.15, 0.04])); // paint tins
        else parts.push(box(0.2, 0.26, 0.02, c, [x, y + 0.15, -0.1], [-0.12, 0, 0])); // tile chips
      }
    }
    return parts;
  });

/** An easel with a canvas (the canvas's picture at EASEL_CANVAS). */
export const EASEL_CANVAS = { w: 0.56, h: 0.66, y: 1.22, z: 0.06 };
export const easelModel = () =>
  model('theme:easel', () => [
    box(0.04, 1.72, 0.04, OAK, [-0.24, 0.86, 0.08], [0.14, 0, 0.12]),
    box(0.04, 1.72, 0.04, OAK, [0.24, 0.86, 0.08], [0.14, 0, -0.12]),
    box(0.04, 1.6, 0.04, OAK, [0, 0.8, -0.2], [-0.3, 0, 0]),
    box(0.62, 0.04, 0.08, OAK, [0, 0.86, 0.1]),
    box(EASEL_CANVAS.w + 0.04, EASEL_CANVAS.h + 0.04, 0.03, '#fbfaf7', [0, EASEL_CANVAS.y, 0.035], [-0.14, 0, 0]),
  ]);

/** An arc floor lamp: a marble foot, a brass arc and a pastel shade (its bulb's glow at ARC_BULB). */
export const ARC_BULB = { y: 1.62, z: 0.22 };
export const arcLampModel = () =>
  model('theme:arc-lamp', () => [
    cyl(0.18, 0.2, 0.08, '#f1ede6', [0, 0.04, -0.12]),
    cyl(0.018, 0.018, 1.82, '#d4a373', [0, 0.95, -0.12]),
    cyl(0.018, 0.018, 0.42, '#d4a373', [0, 1.86, 0.06], [Math.PI / 2, 0, 0]),
    cone(0.2, 0.2, '#ffc8dd', [0, ARC_BULB.y + 0.12, ARC_BULB.z]),
  ]);

/** A rug of colour swatches: a grid of pastel tiles in an oak-coloured border, w x d. */
export const swatchRugModel = (w: number, d: number) =>
  model(`theme:swatch-rug:${w}x${d}`, () => {
    const parts: Part[] = [box(w, 0.008, d, '#d8b98c', [0, 0.004, 0])];
    const colors = ['#ff8fab', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'];
    const cols = 6;
    const rows = 4;
    const tw = (w - 0.3) / cols;
    const td = (d - 0.3) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) parts.push(box(tw - 0.04, 0.012, td - 0.04, colors[(r * 3 + c) % colors.length], [-w / 2 + 0.15 + tw * (c + 0.5), 0.007, -d / 2 + 0.15 + td * (r + 0.5)]));
    return parts;
  });

/** Pendant lamps over the desks: a cord and a pastel dome (the bulb's glow drawn below it). */
export const pendantModel = () => model('theme:pendant', () => [cyl(0.008, 0.008, 0.9, '#3d3d3d', [0, 0.45, 0]), cone(0.22, 0.2, '#ffc8dd', [0, -0.05, 0]), ball(0.05, '#fff3d6', [0, -0.15, 0])]);

// ---------- media studio ----------

/** An editing bay: a dark desk, two monitors (their screens at BAY_SCREENS), speakers, a jog wheel and a chair. */
export const BAY_SCREENS = { w: 0.74, h: 0.42, y: 1.2, x: [-0.4, 0.4], z: -0.18, rotY: [0.16, -0.16] };
export const editBayModel = () =>
  model('theme:edit-bay', () => [
    box(2.1, 0.05, 0.75, '#2b2d36', [0, 0.74, -0.25]),
    box(0.05, 0.72, 0.7, DARK, [-1.0, 0.37, -0.25]),
    box(0.05, 0.72, 0.7, DARK, [1.0, 0.37, -0.25]),
    ...BAY_SCREENS.x.map((x, i) => box(BAY_SCREENS.w + 0.06, BAY_SCREENS.h + 0.06, 0.04, DARK, [x, BAY_SCREENS.y, BAY_SCREENS.z - 0.025], [0, BAY_SCREENS.rotY[i], 0])),
    box(0.06, 0.38, 0.06, STEEL, [0, 0.95, -0.3]),
    box(0.16, 0.26, 0.16, '#3d3f4a', [-0.92, 0.9, -0.38]),
    box(0.16, 0.26, 0.16, '#3d3f4a', [0.92, 0.9, -0.38]),
    cyl(0.05, 0.05, 0.02, '#e5e5e5', [-0.92, 0.94, -0.29], [Math.PI / 2, 0, 0]),
    cyl(0.05, 0.05, 0.02, '#e5e5e5', [0.92, 0.94, -0.29], [Math.PI / 2, 0, 0]),
    box(0.46, 0.02, 0.16, '#e5e5e5', [-0.12, 0.775, -0.02]),
    cyl(0.07, 0.07, 0.03, '#ff4d6d', [0.3, 0.785, -0.02]), // the jog wheel
    box(0.56, 0.1, 0.52, '#ff4d6d', [0, 0.47, 0.35]),
    box(0.56, 0.6, 0.1, '#2b2d36', [0, 0.84, 0.58]),
    cyl(0.04, 0.04, 0.4, '#495057', [0, 0.22, 0.35]),
    cyl(0.28, 0.28, 0.04, '#495057', [0, 0.03, 0.35]),
  ]);

/** A green-screen corner: the curved green backdrop on its stand, a camera on a tripod facing it. */
export const greenScreenModel = () =>
  model('theme:green-screen', () => {
    const g = '#22c55e';
    const parts: Part[] = [box(2.2, 2.2, 0.04, g, [0, 1.12, -0.6]), box(2.2, 0.04, 0.5, g, [0, 0.02, -0.35]), cyl(0.15, 0.15, 2.2, g, [0, 0.12, -0.53], [0, 0, Math.PI / 2])];
    for (const x of [-1.12, 1.12]) parts.push(cyl(0.02, 0.02, 2.3, STEEL, [x, 1.15, -0.62]), cyl(0.2, 0.2, 0.02, STEEL, [x, 0.01, -0.62]));
    parts.push(cyl(0.015, 0.015, 2.28, STEEL, [0, 2.27, -0.62], [0, 0, Math.PI / 2]));
    // the camera, at the front, facing the backdrop
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(cyl(0.012, 0.012, 1.3, DARK, [Math.sin(a) * 0.16, 0.62, 0.42 + Math.cos(a) * 0.16], [Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25]));
    }
    parts.push(box(0.2, 0.2, 0.34, DARK, [0, 1.36, 0.42]), cyl(0.07, 0.07, 0.16, '#3d3f4a', [0, 1.36, 0.2], [Math.PI / 2, 0, 0]), box(0.08, 0.06, 0.04, '#ff4d6d', [0.06, 1.49, 0.5]));
    return parts;
  });

/** A ring light on a stand, with a phone in the middle (the ring's glow at RING). */
export const RING = { r: 0.24, y: 1.55, z: 0.02 };
export const ringLightModel = () =>
  model('theme:ring-light', () => [
    cyl(0.2, 0.22, 0.04, DARK, [0, 0.02, 0]),
    cyl(0.018, 0.018, RING.y - 0.25, '#495057', [0, (RING.y - 0.25) / 2, 0]),
    torus(RING.r, 0.035, '#2b2d36', [0, RING.y, 0]),
    box(0.08, 0.15, 0.015, DARK, [0, RING.y, 0.02]),
  ]);

/** A softbox on a stand: a black box with a white diffuser (its glow at SOFTBOX). */
export const SOFTBOX = { w: 0.6, h: 0.45, y: 1.45, z: 0.13 };
export const softboxModel = () =>
  model('theme:softbox', () => [
    cyl(0.2, 0.22, 0.04, DARK, [0, 0.02, 0]),
    cyl(0.018, 0.018, 1.3, '#495057', [0, 0.65, 0]),
    box(SOFTBOX.w + 0.06, SOFTBOX.h + 0.06, 0.24, DARK, [0, SOFTBOX.y, 0], [-0.15, 0, 0]),
  ]);

// ---------- research lab and ops ----------

/** A server rack, 0.7 wide: a black cabinet with blank bays (its LEDs drawn by the scene at RACK_LEDS). */
const RACK = { w: 0.7, h: 1.95, d: 0.75 };
export const RACK_LEDS = { rows: 9, cols: 3, y0: 0.35, dy: 0.17, x0: -0.22, dx: 0.06, z: RACK.d / 2 + 0.006 };
const rackParts = (x: number): Part[] => {
  const parts: Part[] = [box(RACK.w, RACK.h, RACK.d, '#16181d', [x, RACK.h / 2, 0]), box(RACK.w + 0.02, 0.04, RACK.d + 0.02, '#2b2f38', [x, RACK.h, 0])];
  for (let r = 0; r < RACK_LEDS.rows; r++) parts.push(box(RACK.w - 0.08, 0.13, 0.01, r % 3 === 1 ? '#2b2f38' : '#22252c', [x, RACK_LEDS.y0 + r * RACK_LEDS.dy, RACK.d / 2 + 0.002]));
  return parts;
};
export const serverRackModel = () => model('theme:server-rack', () => rackParts(0));
/** Where the racks of a pair stand across its front. */
export const RACK_PAIR_X = [-0.45, 0.45];
export const rackPairModel = () => model('theme:rack-pair', () => RACK_PAIR_X.flatMap(rackParts));

/** A glass-walled training room's frame and its GPU rig inside (the glass panes drawn by the scene, TRAINING_GLASS). */
export const TRAINING_GLASS = { w: 2.3, d: 1.35, h: 2.3 };
export const trainingRoomModel = () =>
  model('theme:training-room', () => {
    const { w, d, h } = TRAINING_GLASS;
    const parts: Part[] = [box(w, 0.04, d, '#c9d6e6', [0, 0.02, 0]), box(w, 0.06, d, '#c9d6e6', [0, h, 0])];
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) parts.push(box(0.05, h, 0.05, '#e9eef5', [x, h / 2, z]));
    parts.push(...rackParts(-0.5), box(0.9, 0.05, 0.6, '#e9eef5', [0.55, 0.74, -0.2]), box(0.06, 0.72, 0.06, STEEL, [0.55, 0.37, -0.2]), box(0.6, 0.38, 0.04, DARK, [0.55, 1.05, -0.4]));
    return parts;
  });

/** A whiteboard on wheels (its equations drawn by the scene at BOARD_FACE). */
export const BOARD_FACE = { w: 0.84, h: 0.84, y: 1.3, z: 0.03 };
export const mobileBoardModel = () =>
  model('theme:mobile-board', () => [
    box(BOARD_FACE.w + 0.06, BOARD_FACE.h + 0.06, 0.04, '#dfe6ee', [0, BOARD_FACE.y, 0]),
    box(0.04, 1.4, 0.04, STEEL, [-0.44, 0.75, 0]),
    box(0.04, 1.4, 0.04, STEEL, [0.44, 0.75, 0]),
    box(0.04, 0.04, 0.46, STEEL, [-0.44, 0.06, 0]),
    box(0.04, 0.04, 0.46, STEEL, [0.44, 0.06, 0]),
    box(0.8, 0.03, 0.08, STEEL, [0, BOARD_FACE.y - BOARD_FACE.h / 2 - 0.06, 0.05]),
  ]);

/** An ops console: a curved dark desk with three monitors (their screens at CONSOLE_SCREENS) and a chair. */
export const CONSOLE_SCREENS = { w: 0.62, h: 0.36, y: 1.18, x: [-0.68, 0, 0.68], z: [-0.26, -0.36, -0.26], rotY: [0.35, 0, -0.35] };
export const nocConsoleModel = () =>
  model('theme:noc-console', () => [
    box(1.0, 0.05, 0.7, '#2b3340', [-0.62, 0.74, -0.22], [0, 0.3, 0]),
    box(0.8, 0.05, 0.7, '#2b3340', [0, 0.74, -0.3]),
    box(1.0, 0.05, 0.7, '#2b3340', [0.62, 0.74, -0.22], [0, -0.3, 0]),
    box(2.0, 0.7, 0.05, '#151a22', [0, 0.36, -0.6]),
    ...CONSOLE_SCREENS.x.map((x, i) => box(CONSOLE_SCREENS.w + 0.05, CONSOLE_SCREENS.h + 0.05, 0.035, DARK, [x, CONSOLE_SCREENS.y, CONSOLE_SCREENS.z[i] - 0.022], [0, CONSOLE_SCREENS.rotY[i], 0])),
    box(0.5, 0.02, 0.16, '#3d4452', [0, 0.775, -0.1]),
    box(0.56, 0.1, 0.52, '#2b3340', [0, 0.47, 0.32]),
    box(0.56, 0.62, 0.1, '#151a22', [0, 0.84, 0.56]),
    cyl(0.04, 0.04, 0.4, '#495057', [0, 0.22, 0.32]),
    cyl(0.28, 0.28, 0.04, '#495057', [0, 0.03, 0.32]),
  ]);

/** A UPS cabinet: squat, grey, with a status panel. */
export const upsModel = () =>
  model('theme:ups', () => [box(0.56, 1.15, 0.7, '#2b2f38', [0, 0.575, 0]), box(0.3, 0.16, 0.01, '#0b0f16', [0, 0.95, 0.356]), box(0.12, 0.03, 0.01, '#22e39b', [-0.06, 0.95, 0.362]), box(0.46, 0.5, 0.01, '#22252c', [0, 0.4, 0.356])]);

/** The ops room's alert beacon: a squat base and a red dome (lit and spun by the scene). */
export const beaconBaseModel = () => model('theme:beacon', () => [cyl(0.13, 0.15, 0.08, '#2b2f38', [0, 0.04, 0])]);
