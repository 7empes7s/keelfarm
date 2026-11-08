// The floor themes' props as cheap toon models (#370): primitives merged into one vertex-coloured geometry each
// (decor/parts.ts), built once, so a prop is one draw call and a repeated one a single InstancedMesh. Each stands in
// its own frame like the decorations' models: the floor at y 0, its front to +z, its middle at the origin. Screens and
// signs are planes drawn on top (scenes.tsx).

import { shade } from '../materials';
import { ball, box, cone, cyl, model, type Part } from '../decor/parts';

const INK = '#1f1d2b';

/** A low TV cabinet with a big TV on it and a console beside the TV (its screen at TV_SCREEN). */
export const TV_SCREEN = { w: 1.5, h: 0.82, y: 1.0, z: 0.05 };
export const tvModel = () =>
  model('theme:tv', () => [
    box(1.9, 0.45, 0.5, '#2a2140', [0, 0.225, 0]),
    box(1.86, 0.03, 0.46, '#3d3160', [0, 0.46, 0]),
    box(0.18, 0.1, 0.22, '#1b1b2f', [0, 0.52, 0.02]),
    box(1.6, 0.92, 0.07, INK, [0, TV_SCREEN.y, 0]),
    box(0.4, 0.06, 0.3, '#f8f9fa', [0.62, 0.5, 0.05]), // the console
    box(0.36, 0.015, 0.26, '#b14cff', [0.62, 0.535, 0.05]),
    box(0.12, 0.04, 0.08, '#2de2e6', [-0.6, 0.48, 0.15]), // a controller
  ]);

/** A shelf of collectible figurines. */
export const figurinesModel = () =>
  model('theme:figurines', () => {
    const wood = '#2a2140';
    const parts: Part[] = [box(0.8, 0.04, 0.42, wood, [0, 0.02, 0]), box(0.04, 1.6, 0.42, wood, [-0.38, 0.8, 0]), box(0.04, 1.6, 0.42, wood, [0.38, 0.8, 0]), box(0.8, 0.03, 0.04, wood, [0, 1.585, -0.19])];
    const colors = ['#ff3cac', '#2de2e6', '#ffd166', '#b14cff', '#7CFFB2', '#ff9f1c'];
    for (let s = 0; s < 3; s++) {
      const y = 0.45 + s * 0.5;
      parts.push(box(0.72, 0.03, 0.38, shade(wood, 0.1), [0, y, 0]));
      for (let i = 0; i < 3; i++) {
        const c = colors[(s * 3 + i) % colors.length];
        const x = -0.22 + i * 0.22;
        parts.push(cyl(0.06, 0.07, 0.16, c, [x, y + 0.095, 0.02]), ball(0.06, c, [x, y + 0.23, 0.02]));
        if ((s + i) % 2) parts.push(cone(0.03, 0.08, c, [x, y + 0.31, 0.02]));
      }
    }
    return parts;
  });

/** A racing-style gaming chair, in the studio's neon. */
export const gamingChairModel = () =>
  model('theme:gaming-chair', () => [
    cyl(0.3, 0.3, 0.04, '#2b2d42', [0, 0.04, 0]),
    cyl(0.04, 0.04, 0.4, '#495057', [0, 0.24, 0]),
    box(0.56, 0.1, 0.52, '#1b1b2f', [0, 0.47, 0]),
    box(0.56, 0.78, 0.12, '#1b1b2f', [0, 0.9, -0.24]),
    box(0.14, 0.7, 0.13, '#b14cff', [-0.17, 0.92, -0.23]),
    box(0.14, 0.7, 0.13, '#b14cff', [0.17, 0.92, -0.23]),
    box(0.34, 0.14, 0.13, '#2de2e6', [0, 1.17, -0.22]),
    box(0.06, 0.22, 0.4, '#2b2d42', [-0.3, 0.62, 0]),
    box(0.06, 0.22, 0.4, '#2b2d42', [0.3, 0.62, 0]),
  ]);

/** The trading floor's market statues on a plinth: a charging bull, or a bear. */
export const statueModel = (kind: 'bull' | 'bear') =>
  model(`theme:${kind}`, () => {
    const metal = kind === 'bull' ? '#d4a017' : '#7f5539';
    const dark = shade(metal, -0.2);
    const parts: Part[] = [box(1.5, 0.3, 0.8, '#2b3f5c', [0, 0.15, 0]), box(1.4, 0.04, 0.7, '#e0e6ef', [0, 0.32, 0])];
    const y = 0.34;
    for (const [lx, lz] of [
      [-0.38, -0.16],
      [-0.38, 0.16],
      [0.34, -0.16],
      [0.34, 0.16],
    ])
      parts.push(cyl(0.06, 0.05, 0.38, dark, [lx, y + 0.19, lz]));
    if (kind === 'bull') {
      parts.push(ball(0.36, metal, [0, y + 0.6, 0], [1.6, 0.85, 0.9]), ball(0.2, metal, [0.6, y + 0.58, 0], [1.1, 0.95, 0.9]));
      parts.push(cone(0.05, 0.28, '#f1e3b0', [0.66, y + 0.78, -0.14], [0.6, 0, -0.9]), cone(0.05, 0.28, '#f1e3b0', [0.66, y + 0.78, 0.14], [-0.6, 0, -0.9]));
      parts.push(cyl(0.015, 0.02, 0.4, dark, [-0.62, y + 0.62, 0], [0, 0, 1.1]));
    } else {
      parts.push(ball(0.38, metal, [0, y + 0.6, 0], [1.4, 0.95, 1]), ball(0.22, metal, [0.52, y + 0.66, 0]), ball(0.08, dark, [0.48, y + 0.86, -0.12]), ball(0.08, dark, [0.48, y + 0.86, 0.12]), ball(0.07, dark, [0.72, y + 0.62, 0]));
    }
    return parts;
  });

/** A stand of four quote screens on a post (its screens at POD_SCREENS). */
export const POD_SCREENS = { w: 0.78, h: 0.46, y: [1.05, 1.52], x: [-0.41, 0.41], z: 0.07 };
export const quotePodModel = () =>
  model('theme:quote-pod', () => [
    box(0.9, 0.06, 0.5, '#2b2d42', [0, 0.03, 0]),
    box(0.1, 0.9, 0.1, '#495057', [0, 0.48, 0]),
    box(1.74, 1.0, 0.1, '#1b263b', [0, 1.29, 0]),
  ]);

/** A tall planter in frosted glass with grass. */
export const planterModel = () =>
  model('theme:planter', () => {
    const parts: Part[] = [cyl(0.24, 0.2, 0.7, '#dfe7ef', [0, 0.35, 0]), cyl(0.245, 0.245, 0.04, '#b8c4d2', [0, 0.7, 0])];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      parts.push(cone(0.05, 0.9 + (i % 3) * 0.15, i % 2 ? '#52b788' : '#2d6a4f', [Math.cos(a) * 0.1, 1.15 + (i % 3) * 0.07, Math.sin(a) * 0.1], [Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2]));
    }
    return parts;
  });

/** A wall screen's housing (w x h), its face at z 0.04. */
export const wallScreenModel = (w: number, h: number) => model(`theme:wall-screen:${w}x${h}`, () => [box(w + 0.08, h + 0.08, 0.06, '#1b263b', [0, 0, 0.01])]);

/** A desk's extra monitor: its stand and bezel (screen 0.5 x 0.3 at z 0.021). */
export const DESK_SCREEN = { w: 0.5, h: 0.3 };
export const deskMonitorModel = () =>
  model('theme:desk-monitor', () => [
    box(0.2, 0.02, 0.14, '#3d4152', [0, -0.22, -0.02]),
    box(0.05, 0.22, 0.04, '#3d4152', [0, -0.12, -0.03]),
    box(0.56, 0.36, 0.035, '#2b2d42', [0, 0, 0]),
  ]);

/** The trading ticker's housing: a long dark box hung on two cables. */
export const tickerModel = (w: number) =>
  model(`theme:ticker:${w}`, () => [box(w + 0.2, 0.56, 0.2, '#0b0f17'), cyl(0.012, 0.012, 0.5, '#6c757d', [-w / 2 + 0.3, 0.53, 0]), cyl(0.012, 0.012, 0.5, '#6c757d', [w / 2 - 0.3, 0.53, 0])]);
