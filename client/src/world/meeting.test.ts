import { describe, expect, it } from 'vitest';
import { NO_CALL, type Call } from '../ui/voiceCall';
import { collide, lobbyColliders, MEETING_CHAIRS, MEETING_HEAD, MEETING_ROOM } from './layout';
import { ceoAtCall, chairLabel, chairPlan, chairView, TILE_FPS, tileDue } from './meeting';
import { findPath, spot, walkways } from './walkways';

const call = (patch: Partial<Call>): Call => ({ ...NO_CALL, id: 1, startedAt: 1, ...patch });

describe('the CEO and the call', () => {
  it('is in the corner office with no call, and back there once it ends', () => {
    expect(ceoAtCall(NO_CALL).inRoom).toBe(false);
    expect(ceoAtCall(call({ phase: 'ended' })).inRoom).toBe(false);
  });

  it('is at the meeting table for the whole call, acting out each moment of it', () => {
    expect(ceoAtCall(call({ phase: 'connecting' }))).toEqual({ inRoom: true, gesture: 'wave', expression: 'joyful' });
    expect(ceoAtCall(call({ phase: 'listening' }))).toEqual({ inRoom: true, gesture: 'nod', expression: 'neutral' });
    expect(ceoAtCall(call({ phase: 'thinking' }))).toEqual({ inRoom: true, gesture: 'tap', expression: 'focused' });
    expect(ceoAtCall(call({ phase: 'speaking' }))).toEqual({ inRoom: true, gesture: 'talk', expression: 'joyful' });
  });

  it('stands still, still in the room, while the call is paused or you are away', () => {
    expect(ceoAtCall(call({ phase: 'speaking', paused: true }))).toEqual({ inRoom: true, gesture: 'none', expression: 'neutral' });
    expect(ceoAtCall(call({ phase: 'listening', away: true }))).toEqual({ inRoom: true, gesture: 'none', expression: 'neutral' });
  });

  it('can walk from their desk to the head of the table and back', () => {
    const w = walkways('lobby');
    const head = spot(w, 'meeting')!;
    expect(head).toMatchObject(MEETING_HEAD);
    expect(findPath(w, spot(w, 'ceo')!, head)).not.toBeNull();
    expect(findPath(w, head, spot(w, 'ceo')!)).not.toBeNull();
  });
});

describe('the meeting chairs', () => {
  const inRoom = (p: { x: number; z: number }) => p.x > MEETING_ROOM.minX && p.x < MEETING_ROOM.maxX && p.z > MEETING_ROOM.minZ && p.z < MEETING_ROOM.maxZ;

  it('seat you in the room facing the CEO, and stand you up somewhere free beside the chair', () => {
    const solid = lobbyColliders();
    MEETING_CHAIRS.forEach((_, i) => {
      const v = chairView(i);
      expect(inRoom(v), `chair ${i}`).toBe(true);
      // the view's forward (yaw 0 looks north, -z) points at the CEO's place
      const to = Math.atan2(-(MEETING_HEAD.x - v.x), -(MEETING_HEAD.z - v.z));
      expect(v.yaw, `chair ${i}`).toBeCloseTo(to);
      expect(inRoom(v.exit), `chair ${i}`).toBe(true);
      expect(collide(v.exit.x, v.exit.z, solid), `chair ${i}'s exit`).toEqual(v.exit);
    });
    expect(chairView(0).yaw).toBeCloseTo(-Math.PI / 2); // the far head looks straight down the table, east
  });

  it('sit you down and call the CEO, or join the call that is on', () => {
    expect(chairPlan(2, null, false, false)).toEqual({ sit: true, start: true, fold: false });
    expect(chairPlan(2, null, true, false)).toEqual({ sit: true, start: false, fold: false });
    expect(chairLabel(false, 'Mimoun')).toBe('Sit down and call Mimoun');
    expect(chairLabel(true, 'Mimoun')).toBe('Join the call');
  });

  it('fold the call screen on a phone, so the room shows', () => {
    expect(chairPlan(0, null, true, true).fold).toBe(true);
  });

  it('move you from chair to chair, but do nothing for the one you sit in or one that does not exist', () => {
    expect(chairPlan(1, 0, true, false).sit).toBe(true);
    expect(chairPlan(1, 1, true, false)).toEqual({ sit: false, start: false, fold: false });
    expect(chairPlan(MEETING_CHAIRS.length, null, false, false)).toEqual({ sit: false, start: false, fold: false });
  });
});

describe("the call window's view of the room", () => {
  const shown = { folded: false, hidden: false, onScreen: true };

  it(`draws at most ${TILE_FPS} frames a second`, () => {
    let last = -Infinity;
    let frames = 0;
    for (let tick = 0; tick < 60; tick++) {
      const now = (tick * 1000) / 60; // a second of 60 Hz frames
      if (tileDue(now, last, shown)) {
        last = now;
        frames++;
      }
    }
    expect(frames).toBeGreaterThanOrEqual(TILE_FPS - 2);
    expect(frames).toBeLessThanOrEqual(TILE_FPS);
  });

  it('draws nothing while the call window is folded, the tab hidden or the tile off screen', () => {
    expect(tileDue(10_000, 0, shown)).toBe(true);
    expect(tileDue(10_000, 0, { ...shown, folded: true })).toBe(false);
    expect(tileDue(10_000, 0, { ...shown, hidden: true })).toBe(false);
    expect(tileDue(10_000, 0, { ...shown, onScreen: false })).toBe(false);
  });
});
