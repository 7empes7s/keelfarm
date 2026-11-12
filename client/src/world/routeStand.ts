// Where a deep link's place stands the camera (#413, routes.ts names the spot): the walkways' named spots, the aisle
// facing the whiteboard, the lobby's screens. Pure; Office.tsx hands the pose to the player (Player.tsx standAt).
import type { Spot } from '../routes';
import { HALF_D, LOBBY_SCREENS, SPAWN } from './layout';
import { deskSpot, spot, walkways } from './walkways';

export interface Pose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** The camera's yaw looking along a walkways heading (facing h looks along (cos h, sin h); yaw 0 looks along -z). */
export const yawFor = (heading: number) => Math.atan2(-Math.cos(heading), -Math.sin(heading));

const at = (x: number, z: number, heading: number, pitch = -0.05): Pose => ({ x, z, yaw: yawFor(heading), pitch });
const named = (id: string, pitch?: number) => {
  const s = spot(walkways('lobby'), id)!;
  return at(s.x, s.z, s.facing, pitch);
};

/** A spot's pose: where to stand and which way to look. */
export function standPose(s: Spot): Pose {
  if (typeof s === 'object') {
    const d = deskSpot(s.desk);
    return at(d.x, d.z, d.facing, -0.25); // over their shoulder, at their screen
  }
  switch (s) {
    case 'board':
      return at(0, -HALF_D + 8, -Math.PI / 2, 0.04); // the aisle between the desk rows, the whole board in view
    case 'screens':
      return at((LOBBY_SCREENS.testlab.at[0] + LOBBY_SCREENS.directory.at[0]) / 2, HALF_D - 6, Math.PI / 2, 0.02);
    case 'elevator':
      return { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw, pitch: -0.05 };
    case 'it':
      return named(s, -0.12); // down at the IT lead across the counter, so E opens their chat
    default:
      return named(s);
  }
}
