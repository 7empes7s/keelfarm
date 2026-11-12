// Where a floor's project props stand (#536): a few spots of their own on every office floor, apart from the
// decoration slots the themes and earned decorations use, so a floor keeps everything it has and gains its project's
// things. The floor spots are always kept clear by the walkways (roombaBrain.ts), whatever stands there, so people
// and the roomba plan round them on every floor alike. Pure; tested in projectProps.test.ts.

import { HALF_D, HALF_W, rect, type Rect } from '../layout';
import { deskToolFor, floorPropSet, type DeskTool, type FloorProfile, type PropSet } from '../../../../shared/floorProps';
import type { UseCase } from '../../../../shared/types';

const FACE = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };

export interface ProjectSpot {
  /** The middle of its footprint (floor spots) or of its face (wall spots), facing rotY. */
  x: number;
  y: number;
  z: number;
  rotY: number;
  w: number;
  /** Floor spots: front to back. Wall spots: how tall. */
  d: number;
  /** Floor spots: how tall what stands there may be (a picture hangs above some). */
  maxH: number;
  kind: 'floor' | 'wall';
}

const DEPTH = 0.8;
const onSouth = (x: number, w: number, maxH: number): ProjectSpot => ({ x, y: 0, z: HALF_D - DEPTH / 2 - 0.05, rotY: FACE.north, w, d: DEPTH, maxH, kind: 'floor' });
// clear of the app screen's housing on the north wall
const onNorth = (x: number, w: number, maxH: number): ProjectSpot => ({ x, y: 0, z: -HALF_D + DEPTH / 2 + 0.16, rotY: FACE.south, w, d: DEPTH, maxH, kind: 'floor' });

/**
 * The spots: two tall ones on the south wall (west of the trophy shelf, east of the team sign's picture), two low ones
 * on the north wall (under the app screen, and under the north-east picture past the roomba's dock), three pictures' worth of free wall, and the
 * board screen on the east wall above its middle desk.
 */
export const PROJECT_SPOTS = {
  'south-w': onSouth(-8.2, 1.4, 3),
  'south-e': onSouth(10.6, 1.6, 3),
  'north-e': onNorth(14.05, 1.2, 1.5),
  'north-w': onNorth(-14.2, 1.6, 1.25),
  'wall-north': { x: -11.2, y: 2.4, z: -HALF_D + 0.03, rotY: FACE.south, w: 1.3, d: 0.9, maxH: 0, kind: 'wall' },
  'wall-east': { x: HALF_W - 0.03, y: 2.4, z: -5, rotY: FACE.west, w: 1.4, d: 0.9, maxH: 0, kind: 'wall' },
  'wall-south': { x: -13.8, y: 2.45, z: HALF_D - 0.03, rotY: FACE.north, w: 2, d: 1, maxH: 0, kind: 'wall' },
  board: { x: HALF_W - 0.03, y: 2.3, z: 1.4, rotY: FACE.west, w: 2.1, d: 1.2, maxH: 0, kind: 'wall' },
} satisfies Record<string, ProjectSpot>;
export type SpotId = keyof typeof PROJECT_SPOTS;

/** The security cameras' corners, high on the walls, looking into the room. */
export const CAMERA_CORNERS: { x: number; y: number; z: number; rotY: number }[] = [
  { x: -HALF_W + 0.25, y: 3.2, z: -HALF_D + 0.25, rotY: Math.PI / 4 },
  { x: HALF_W - 0.25, y: 3.2, z: HALF_D - 0.25, rotY: Math.PI + Math.PI / 4 },
];

// ---------- the props ----------

/** A project's own things. Floor ones stand in a floor spot; wall ones hang in a wall spot. */
export type ProjectItem =
  | 'vault-door'
  | 'backup-shelf'
  | 'tenant-screen'
  | 'ballot-box'
  | 'voting-booth'
  | 'noticeboard'
  | 'map-poster'
  | 'blueprint-table'
  | 'robot-bench'
  | 'blueprint-poster'
  | 'camera-rig'
  | 'phone-bay'
  | 'live-wall'
  | 'countdown'
  | 'clips-counter'
  | 'device-table'
  | 'wireframes'
  | 'server-rack'
  | 'patch-panel'
  | 'terminal-wall'
  | 'arcade'
  | 'controller-stand'
  | 'level-map';

/** A floor item's size in its own frame (w across its front, d front to back, h tall); wall items fill their spot. */
export const ITEM_SIZE: Partial<Record<ProjectItem, { w: number; d: number; h: number }>> = {
  'vault-door': { w: 1.3, d: 0.35, h: 2.2 },
  'backup-shelf': { w: 1.5, d: 0.5, h: 1.9 },
  'ballot-box': { w: 1.2, d: 0.6, h: 1.15 },
  'voting-booth': { w: 1.3, d: 0.75, h: 1.95 },
  'blueprint-table': { w: 1.2, d: 0.75, h: 1.2 },
  'robot-bench': { w: 1.5, d: 0.7, h: 1.7 },
  'camera-rig': { w: 1.3, d: 0.7, h: 1.85 },
  'phone-bay': { w: 1.5, d: 0.7, h: 1.45 },
  'device-table': { w: 1.2, d: 0.7, h: 1.05 },
  'server-rack': { w: 0.75, d: 0.75, h: 2.0 },
  'patch-panel': { w: 1.2, d: 0.6, h: 1.1 },
  arcade: { w: 0.8, d: 0.75, h: 1.85 },
  'controller-stand': { w: 1.2, d: 0.6, h: 1.1 },
};

/** What each set puts in which spot (the board screen is on every floor, so no set names it). */
export const PROJECT_SETS: Record<PropSet, Partial<Record<Exclude<SpotId, 'board'>, ProjectItem>>> = {
  vault: { 'south-w': 'vault-door', 'south-e': 'backup-shelf', 'wall-south': 'tenant-screen' },
  civic: { 'north-e': 'ballot-box', 'south-e': 'voting-booth', 'wall-south': 'noticeboard', 'wall-north': 'map-poster' },
  workshop: { 'north-e': 'blueprint-table', 'south-e': 'robot-bench', 'wall-south': 'blueprint-poster' },
  broadcast: { 'south-w': 'camera-rig', 'south-e': 'phone-bay', 'wall-south': 'live-wall', 'wall-north': 'countdown', 'wall-east': 'clips-counter' },
  devices: { 'north-e': 'device-table', 'wall-south': 'wireframes' },
  servers: { 'south-e': 'server-rack', 'north-w': 'patch-panel', 'wall-south': 'terminal-wall' },
  arcade: { 'south-e': 'arcade', 'north-e': 'controller-stand', 'wall-south': 'level-map' },
};

/** Which sets show security cameras in the corners. */
export const hasCameras = (set: PropSet) => set === 'vault';

export interface PlacedItem {
  spot: SpotId;
  item: ProjectItem;
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Its size: the item's own on the floor, its spot's on a wall (h is a wall item's height). */
  w: number;
  d: number;
  h: number;
}

/** A set's props where they stand, floor ones set back against their wall. */
export function projectItems(set: PropSet): PlacedItem[] {
  return Object.entries(PROJECT_SETS[set]).map(([id, item]) => {
    const spot = PROJECT_SPOTS[id as SpotId];
    const size = ITEM_SIZE[item];
    if (spot.kind === 'wall' || !size) return { spot: id as SpotId, item, x: spot.x, y: spot.y, z: spot.z, rotY: spot.rotY, w: spot.w, d: 0.06, h: spot.d };
    const back = (spot.d - size.d) / 2; // from the spot's middle toward the wall behind it
    return { spot: id as SpotId, item, x: spot.x - Math.sin(spot.rotY) * back, y: 0, z: spot.z - Math.cos(spot.rotY) * back, rotY: spot.rotY, ...size };
  });
}

/** A floor spot's footprint, as the walkways keep it clear. */
const spotRect = (s: ProjectSpot): Rect => (Math.abs(Math.sin(s.rotY)) > 0.5 ? rect(s.x, s.z, s.d, s.w, s.maxH) : rect(s.x, s.z, s.w, s.d, s.maxH));

/** Every floor spot's footprint, on every office floor: the walkways plan round them whatever stands there. */
export const reservedProjectRects = (): Rect[] => Object.values(PROJECT_SPOTS).filter((s) => s.kind === 'floor').map(spotRect);

/** What you (and the toys) bump into: the set's floor props, each its own size. */
export function projectRects(set: PropSet): Rect[] {
  return projectItems(set)
    .filter((p) => PROJECT_SPOTS[p.spot].kind === 'floor')
    .map((p) => (Math.abs(Math.sin(p.rotY)) > 0.5 ? rect(p.x, p.z, p.d, p.w, p.h) : rect(p.x, p.z, p.w, p.d, p.h)));
}

// ---------- a floor's set ----------

type Floor = FloorProfile & { props?: PropSet | null; setup?: { useCase: UseCase | null } };

/** A floor's set: the manager's pick, else from its profile and use case (shared/floorProps.ts). */
export const repoPropSet = (repo: Floor): PropSet => floorPropSet({ ...repo, useCase: repo.setup?.useCase ?? null });

/** The tool on a floor's desks. */
export const repoDeskTool = (repo: Floor): DeskTool => deskToolFor(repo.setup?.useCase ?? null, repoPropSet(repo));
