// The project props' plain shapes (#536), like the themes' (floorThemes/studioModels.ts): primitives merged into one
// vertex-coloured geometry each, built once, in their own frame (the floor at y 0, the front to +z, the middle at the
// origin). Where a CC0 model stands in for part of one (glb.ts), the part here is its stand-in while it loads or if it
// fails: `base` models are the furniture a model replaces, the rest is drawn on top either way. Screens and labels
// are drawn by scene.tsx at the positions exported here. Generic shapes and plain words only: no real brands.

import { ball, box, cone, cyl, model, torus, type Part } from '../decor/parts';

const STEEL = '#adb5bd';
const DARK = '#2b2d36';
const WOOD = '#b08968';

// ---------- furniture the CC0 models replace ----------

/** A plain table: a top on four legs, w x h x d. */
export const tableBase = (w: number, h: number, d: number, color = WOOD) =>
  model(`project:table:${w}x${h}x${d}:${color}`, () => [
    box(w, 0.05, d, color, [0, h - 0.025, 0]),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.05, h - 0.05, 0.05, '#5c677d', [sx * (w / 2 - 0.06), (h - 0.05) / 2, sz * (d / 2 - 0.06)]))),
  ]);

/** A closed shelf unit with a door line down its middle. */
export const shelfBase = (w: number, h: number, d: number) =>
  model(`project:shelf:${w}x${h}x${d}`, () => [box(w, h, d, '#8d99ae', [0, h / 2, 0]), box(0.02, h - 0.1, 0.01, '#5c677d', [0, h / 2, d / 2 + 0.005])]);

// ---------- the backup vault ----------

/** The vault door's dial and wheel (their middle at VAULT.y, out at VAULT.z), drawn on a steel frame. */
const VAULT = { r: 0.58, y: 1.1, z: 0.2 };
export const vaultDoorModel = () =>
  model('project:vault-door', () => {
    const steel = '#8d99ae';
    const p: Part[] = [
      box(1.3, 2.2, 0.12, '#5c677d', [0, 1.1, -0.11]), // the frame on the wall
      cyl(VAULT.r + 0.06, VAULT.r + 0.06, 0.06, '#495057', [0, VAULT.y, 0.0], [Math.PI / 2, 0, 0], 28),
      cyl(VAULT.r, VAULT.r, 0.16, steel, [0, VAULT.y, 0.08], [Math.PI / 2, 0, 0], 28),
      torus(0.26, 0.025, '#dee2e6', [0, VAULT.y, VAULT.z]),
      cyl(0.07, 0.07, 0.08, '#dee2e6', [0, VAULT.y, VAULT.z], [Math.PI / 2, 0, 0]),
      box(0.12, 0.3, 0.12, '#495057', [0.6, VAULT.y + 0.32, 0.06]), // hinges
      box(0.12, 0.3, 0.12, '#495057', [0.6, VAULT.y - 0.32, 0.06]),
    ];
    for (let i = 0; i < 3; i++) p.push(box(0.04, 0.5, 0.03, '#dee2e6', [0, VAULT.y, VAULT.z], [0, 0, (i * Math.PI) / 3]));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      p.push(ball(0.025, '#ced4da', [Math.cos(a) * (VAULT.r - 0.07), VAULT.y + Math.sin(a) * (VAULT.r - 0.07), 0.165]));
    }
    return p;
  });

/** Backup tapes in labelled cartridges along the shelf's three shelves, and a status LED per shelf. */
export const backupTapesModel = (w: number, h: number, d: number) =>
  model(`project:tapes:${w}x${h}x${d}`, () => {
    const colors = ['#3a86ff', '#8338ec', '#06d6a0', '#ffbe0b', '#ef476f'];
    const p: Part[] = [];
    for (let s = 0; s < 3; s++) {
      const y = 0.22 + s * (h / 3.2);
      for (let i = 0; i < 9; i++) p.push(box(0.1, 0.16, 0.06, colors[(s * 3 + i) % colors.length], [-w / 2 + 0.16 + i * ((w - 0.32) / 8), y, d / 2 + 0.03]));
      p.push(ball(0.02, '#2ecc71', [w / 2 - 0.08, y + 0.14, d / 2 + 0.04]));
    }
    return p;
  });

/** A security camera on its wall bracket, looking down along +z. */
export const securityCameraModel = () =>
  model('project:security-camera', () => [
    box(0.1, 0.14, 0.04, '#dee2e6', [0, 0, -0.02]),
    box(0.04, 0.04, 0.2, '#ced4da', [0, -0.02, 0.1]),
    box(0.16, 0.12, 0.3, '#f8f9fa', [0, -0.08, 0.26], [0.35, 0, 0]),
    cyl(0.045, 0.045, 0.04, '#212529', [0, -0.14, 0.42], [Math.PI / 2 + 0.35, 0, 0]),
    ball(0.015, '#e63946', [0.05, -0.02, 0.37]),
  ]);

// ---------- the town hall ----------

/** The ballot box's VOTE label at BALLOT_LABEL, on the box's front. */
export const BALLOT_LABEL = { w: 0.5, h: 0.16, y: 0.82, z: 0.2 };
export const ballotBoxModel = () =>
  model('project:ballot-box', () => [
    box(1.2, 0.05, 0.6, WOOD, [0, 0.6, 0]),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.05, 0.6, 0.05, '#7f5539', [sx * 0.54, 0.3, sz * 0.24]))),
    box(0.5, 0.4, 0.38, '#f8f9fa', [-0.1, 0.83, 0.0]),
    box(0.52, 0.03, 0.4, '#1d3557', [-0.1, 1.04, 0.0]),
    box(0.22, 0.012, 0.03, '#212529', [-0.1, 1.056, 0.0]), // the slot
    box(0.16, 0.004, 0.22, '#ffffff', [0.38, 0.63, 0.02], [0, 0.2, 0]), // a stack of ballots
    box(0.16, 0.004, 0.22, '#f1faee', [0.38, 0.64, 0.02], [0, -0.1, 0]),
    cyl(0.012, 0.012, 0.14, '#e63946', [0.4, 0.66, -0.15], [0, 0, Math.PI / 2]), // a pencil
  ]);

/** A voting booth: three panels, a shelf and a curtain across its front. */
export const votingBoothModel = () =>
  model('project:voting-booth', () => [
    box(1.3, 1.6, 0.04, '#457b9d', [0, 1.0, -0.35]),
    box(0.04, 1.6, 0.7, '#457b9d', [-0.63, 1.0, 0]),
    box(0.04, 1.6, 0.7, '#457b9d', [0.63, 1.0, 0]),
    ...[-0.63, 0.63].flatMap((x) => [-0.35, 0.33].map((z) => box(0.04, 0.2, 0.04, STEEL, [x, 0.1, z]))),
    box(1.26, 0.04, 0.3, '#f1faee', [0, 1.02, -0.2]),
    box(1.3, 0.04, 0.04, STEEL, [0, 1.84, 0.33]),
    box(0.55, 1.35, 0.03, '#e63946', [-0.32, 1.14, 0.33]), // the curtain, half drawn
    box(0.12, 1.35, 0.03, '#c1121f', [0.5, 1.14, 0.33]),
    box(1.3, 0.16, 0.05, '#1d3557', [0, 1.92, 0.33]),
  ]);

// ---------- the workshop ----------

/** A mini building on the blueprint table, and the blueprint sheet under it (the table's top at height `top`). */
export const miniBuildingModel = (top: number) =>
  model(`project:mini-building:${top}`, () => {
    const p: Part[] = [box(1.0, 0.004, 0.55, '#3a6ea5', [0, top + 0.002, 0])];
    const floors = 4;
    for (let f = 0; f < floors; f++) {
      const y = top + 0.03 + f * 0.09;
      p.push(box(0.36, 0.08, 0.26, f % 2 ? '#fbf3e4' : '#f2e6cf', [0.1, y + 0.04, 0]));
      for (let i = 0; i < 4; i++) p.push(box(0.05, 0.035, 0.005, '#8ecae6', [-0.04 + i * 0.09, y + 0.045, 0.131]));
    }
    p.push(box(0.4, 0.02, 0.3, '#6c757d', [0.1, top + 0.03 + floors * 0.09 + 0.01, 0])); // the roof
    p.push(cyl(0.012, 0.012, 0.14, '#adb5bd', [0.22, top + 0.03 + floors * 0.09 + 0.09, 0.06]));
    p.push(box(0.02, 0.003, 0.4, '#e9ecef', [-0.36, top + 0.006, -0.06], [0, 0.4, 0])); // a ruler
    p.push(cyl(0.01, 0.01, 0.15, '#ffbe0b', [-0.3, top + 0.012, 0.15], [0, 0.8, Math.PI / 2])); // a pencil
    return p;
  });

/** The robot taking shape on the assembly bench (the bench's top at height `top`) and the arm building it. */
export const robotModel = (top: number) =>
  model(`project:robot:${top}`, () => {
    const body = '#ffb703';
    return [
      box(0.26, 0.3, 0.2, body, [-0.25, top + 0.15, 0.02]),
      box(0.2, 0.16, 0.16, '#fb8500', [-0.25, top + 0.42, 0.02]),
      ball(0.03, '#8ecae6', [-0.3, top + 0.44, 0.105]),
      ball(0.03, '#8ecae6', [-0.2, top + 0.44, 0.105]),
      cyl(0.008, 0.008, 0.1, STEEL, [-0.25, top + 0.55, 0.02]),
      ball(0.022, '#e63946', [-0.25, top + 0.61, 0.02]),
      box(0.07, 0.22, 0.07, STEEL, [-0.05, top + 0.1, 0.02], [0, 0, 0.5]), // an arm still to fit
      cyl(0.1, 0.12, 0.08, DARK, [0.38, top + 0.04, -0.1]), // the assembly arm
      box(0.07, 0.5, 0.07, '#ff6b35', [0.38, top + 0.32, -0.1], [0, 0, 0.35]),
      ball(0.05, DARK, [0.29, top + 0.55, -0.1]),
      box(0.36, 0.06, 0.06, '#ff6b35', [0.13, top + 0.6, -0.06], [0, 0.2, -0.25]),
      cone(0.04, 0.08, DARK, [-0.05, top + 0.53, -0.02], [0, 0, Math.PI]),
      box(0.18, 0.06, 0.12, '#adb5bd', [0.45, top + 0.03, 0.18]), // a box of parts
    ];
  });

// ---------- the video studio ----------

/** The camera on its tripod (left) and the ring light (right, its ring's middle at RIG_RING). */
export const RIG_RING = { x: 0.38, y: 1.5, r: 0.24, z: 0.05 };
export const cameraRigModel = () =>
  model('project:camera-rig', () => {
    const p: Part[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      p.push(cyl(0.015, 0.015, 1.4, DARK, [-0.3 + Math.cos(a) * 0.18, 0.68, Math.sin(a) * 0.18], [Math.sin(a) * 0.26, 0, -Math.cos(a) * 0.26]));
    }
    p.push(cyl(0.03, 0.03, 0.12, DARK, [-0.3, 1.38, 0]));
    p.push(box(0.26, 0.17, 0.14, '#343a40', [-0.3, 1.52, 0]));
    p.push(cyl(0.06, 0.07, 0.16, '#212529', [-0.3, 1.52, 0.14], [Math.PI / 2, 0, 0]));
    p.push(ball(0.018, '#e63946', [-0.2, 1.62, 0.07]));
    p.push(cyl(0.16, 0.18, 0.03, DARK, [RIG_RING.x, 0.015, 0]));
    p.push(cyl(0.014, 0.014, RIG_RING.y - RIG_RING.r, '#495057', [RIG_RING.x, (RIG_RING.y - RIG_RING.r) / 2, 0]));
    p.push(torus(RIG_RING.r, 0.035, '#343a40', [RIG_RING.x, RIG_RING.y, 0]));
    p.push(box(0.07, 0.13, 0.01, '#212529', [RIG_RING.x, RIG_RING.y, 0.01])); // a phone in the ring
    return p;
  });

/** The editing bay's phones standing on the desk (its top at height `top`): 9:16 screens at PHONES. */
export const PHONES = { w: 0.2, h: 0.36, x: [-0.42, 0, 0.42], rotY: [0.25, 0, -0.25] };
export const phoneStandsModel = (top: number) =>
  model(`project:phone-stands:${top}`, () =>
    PHONES.x.flatMap((x, i) => [
      box(PHONES.w + 0.03, PHONES.h + 0.03, 0.025, '#212529', [x, top + 0.08 + PHONES.h / 2, -0.1], [-0.1, PHONES.rotY[i], 0]),
      box(0.06, 0.08, 0.1, '#495057', [x, top + 0.04, -0.08]),
    ]),
  );

// ---------- the device lab, the server room and the playtest corner ----------

/** Phones and tablets lying on the device table (its top at height `top`), their screens at DEVICES. */
export const DEVICES = [
  { x: -0.45, z: 0.05, w: 0.14, d: 0.26, rotY: 0.2 },
  { x: -0.2, z: -0.05, w: 0.14, d: 0.26, rotY: -0.1 },
  { x: 0.2, z: 0.0, w: 0.34, d: 0.24, rotY: 0.08 },
  { x: 0.5, z: -0.1, w: 0.14, d: 0.26, rotY: -0.25 },
];
export const devicesModel = (top: number) => model(`project:devices:${top}`, () => DEVICES.map((v) => box(v.w + 0.02, 0.012, v.d + 0.02, '#343a40', [v.x, top + 0.006, v.z], [0, v.rotY, 0])));

/** A low cabinet of network kit: patch panels with coloured cables, a switch's lights on top. */
export const patchPanelModel = () =>
  model('project:patch-panel', () => {
    const p: Part[] = [box(1.2, 1.0, 0.6, '#343a40', [0, 0.5, 0])];
    const cable = ['#3a86ff', '#ffbe0b', '#06d6a0', '#ef476f'];
    for (let r = 0; r < 4; r++) {
      const y = 0.25 + r * 0.2;
      p.push(box(1.08, 0.12, 0.02, '#212529', [0, y, 0.305]));
      for (let i = 0; i < 12; i++) p.push(box(0.04, 0.03, 0.03, cable[(i + r) % cable.length], [-0.48 + i * 0.087, y, 0.32]));
    }
    p.push(box(1.0, 0.06, 0.4, '#495057', [0, 1.03, 0]));
    return p;
  });

/** A plinth with a game controller on top. */
export const controllerStandModel = () =>
  model('project:controller-stand', () => [
    box(1.2, 0.9, 0.6, '#3c096c', [0, 0.45, 0]),
    box(1.24, 0.04, 0.64, '#c77dff', [0, 0.92, 0]),
    ...padParts([0, 0.94, 0], 1.6),
  ]);

/** A generic game controller, `s` times desk size, lying at `at`. */
function padParts(at: [number, number, number], s: number): Part[] {
  const [x, y, z] = at;
  return [
    box(0.16 * s, 0.03 * s, 0.07 * s, '#495057', [x, y + 0.015 * s, z]),
    ball(0.045 * s, '#495057', [x - 0.07 * s, y + 0.015 * s, z + 0.02 * s], [1, 0.5, 1]),
    ball(0.045 * s, '#495057', [x + 0.07 * s, y + 0.015 * s, z + 0.02 * s], [1, 0.5, 1]),
    ball(0.012 * s, '#06d6a0', [x + 0.05 * s, y + 0.033 * s, z]),
    ball(0.012 * s, '#ef476f', [x + 0.075 * s, y + 0.033 * s, z + 0.01 * s]),
    box(0.035 * s, 0.01 * s, 0.012 * s, '#212529', [x - 0.06 * s, y + 0.032 * s, z]),
    box(0.012 * s, 0.01 * s, 0.035 * s, '#212529', [x - 0.06 * s, y + 0.032 * s, z]),
  ];
}

// ---------- desk tools ----------

/** The tool on a working desk, standing on its top (y 0 here), in the desk's frame. The screens of the terminal,
 *  tablet and phone are drawn by scene.tsx at TOOL_SCREEN. */
export const TOOL_SCREEN = { terminal: { w: 0.2, h: 0.14, y: 0.12, z: 0.028, tilt: -0.1 }, tablet: { w: 0.22, h: 0.15 }, phone: { w: 0.06, h: 0.11 } };
export const toolModel = (tool: 'controller' | 'terminal' | 'tablet' | 'phone' | 'camera' | 'notebook') =>
  model(`project:tool:${tool}`, () => {
    switch (tool) {
      case 'controller':
        return padParts([0, 0, 0], 1);
      case 'terminal':
        return [box(0.24, 0.18, 0.05, '#212529', [0, 0.12, 0], [-0.1, 0, 0]), box(0.08, 0.03, 0.08, '#343a40', [0, 0.015, -0.01])];
      case 'tablet':
        return [box(0.26, 0.012, 0.19, '#343a40', [0, 0.006, 0]), cyl(0.005, 0.005, 0.16, '#adb5bd', [0.16, 0.006, 0], [Math.PI / 2, 0, 0])];
      case 'phone':
        return [box(0.04, 0.05, 0.04, '#495057', [0, 0.025, -0.02]), box(0.07, 0.13, 0.01, '#212529', [0, 0.1, 0], [-0.25, 0, 0])];
      case 'camera':
        return [box(0.14, 0.09, 0.07, '#343a40', [0, 0.045, 0]), cyl(0.035, 0.04, 0.07, '#212529', [0, 0.045, 0.07], [Math.PI / 2, 0, 0]), box(0.04, 0.02, 0.03, '#495057', [-0.03, 0.1, 0])];
      default:
        return [box(0.17, 0.02, 0.23, '#264653', [0, 0.01, 0]), box(0.15, 0.004, 0.21, '#f1faee', [0.005, 0.022, 0]), cyl(0.006, 0.006, 0.14, '#e76f51', [0.11, 0.008, 0], [Math.PI / 2, 0, 0])];
    }
  });
