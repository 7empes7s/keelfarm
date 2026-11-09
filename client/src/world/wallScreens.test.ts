import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '../../../shared/themes';
import { HALF_D, LOBBY_SCREENS, MISSION, lobbyFurnitureColliders, missionColumn, missionRects, rect, type Rect } from './layout';
import { decorColliders } from './themes/themes';

const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

// Reserve the full width (including bezels) and two metres of approach, from the screen's bottom edge up.
const screens = [
  ...Object.entries(LOBBY_SCREENS).map(([id, { at: [x, y, z], w, h }]) => ({ id, area: rect(x, z - 1, w + 0.14, 2), bottom: y - h / 2 })),
  ...[-1, 0, 1].map((i) => {
    const c = missionColumn(i);
    const halfW = (MISSION.colW + 0.09) / 2;
    const depth = halfW * Math.abs(Math.sin(c.rotY));
    return {
      id: `mission-control-${i}`,
      area: { minX: c.x - halfW, maxX: c.x + halfW, minZ: c.z + depth + 0.09, maxZ: c.z + depth + 2 },
      bottom: MISSION.bottom.y - MISSION.bottom.h / 2,
    };
  }),
  { id: 'mission-control-strip', area: rect(MISSION.x, -HALF_D + 1.05, MISSION.strip.w + 0.08, 2), bottom: MISSION.strip.y - MISSION.strip.h / 2 },
];

const blockedBy = (screen: typeof screens[number], solids: Rect[]) => solids.filter((r) => (r.h ?? Infinity) > screen.bottom && overlaps(screen.area, r));

describe('lobby wall screens', () => {
  it.each(screens)('$id has no furniture standing in front of its face', (screen) => {
    // Mission control's own bezels/posts are screens, not furniture occluding them.
    const own = missionRects();
    const furniture = lobbyFurnitureColliders().filter((r) => !screen.id.startsWith('mission-control') || !own.some((b) => JSON.stringify(b) === JSON.stringify(r)));
    expect(blockedBy(screen, furniture)).toEqual([]);
  });

  it.each(THEME_IDS)('%s leaves the time-lapse screen clear', (theme) => {
    expect(blockedBy(screens.find((s) => s.id === 'timelapse')!, decorColliders(theme, 'lobby'))).toEqual([]);
  });
});
