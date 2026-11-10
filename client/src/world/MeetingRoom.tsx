// The meeting room in the lobby (#369): voice calls with the CEO happen here. Its glass walls and door round the shared
// furniture (MeetingSet.tsx); E at a free chair sits you down (perch.ts) facing the CEO, joining the call that's on or
// starting one; walking off gets you up and the call goes on. While a call runs the CEO walks over from the corner
// office and stands at the table's head, talking, nodding or thinking with the call (meeting.ts), and walks back after.
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { CEO_ID } from '../../../shared/types';
import { chairCreak } from '../ui/peopleSounds';
import { inCall } from '../ui/voiceCall';
import { setMinimised, startCall } from '../ui/voiceCallEngine';
import { CALL_NARROW, callOn, useCall } from '../ui/voiceCallStore';
import { useStore } from '../store';
import { HURRY_SPEED, headingFor } from './errands';
import { drawSign } from './draw';
import { useInteractable } from './interact';
import { MEETING_CHAIRS, MEETING_HEAD, MEETING_ROOM } from './layout';
import { glow } from './materials';
import { ceoAtCall, chairLabel, chairPlan, chairView, demoMeeting } from './meeting';
import { MeetingSet } from './MeetingSet';
import { WallSign } from './OfficeFloor';
import type { BodyTarget } from './body';
import { bodyState, bodyTarget, claimBody, onErrand, placeBody, seatBody, setBody } from './people';
import { leavePerch, perch, setPerch } from './perch';
import { GlassWall, Plant, Rug } from './Props';
import { Box } from './Toon';
import type { Pt } from './toys/roombaBrain';
import { findPath, spot, walkways } from './walkways';

const ACCENT = '#3a86ff';
const PERCH = 'meeting-';
const HEAD_HEADING = headingFor(Math.PI); // facing west, down the table
const CORNER = 0.4;
const ARRIVED = 0.15;

// ---------- the chairs ----------

/** E at meeting chair i (or the probe): sit down facing the CEO, and call them if no call is on. */
export function sitAtMeeting(i: number) {
  const at = perch()?.id;
  const sitting = at?.startsWith(PERCH) ? Number(at.slice(PERCH.length)) : null;
  const plan = chairPlan(i, sitting, callOn(), window.matchMedia(CALL_NARROW).matches);
  if (!plan.sit) return;
  if (plan.start) startCall(); // E is a key press: the browser lets the call's sound start
  const v = chairView(i);
  setPerch({
    id: `${PERCH}${i}`,
    x: v.x,
    y: v.y,
    z: v.z,
    tilt: 0,
    look: 1,
    minPitch: -0.9,
    maxPitch: 0.9,
    exit: v.exit,
    yaw: v.yaw,
    pitch: v.pitch,
    onLeave: () => useCall.setState({ atTable: false }),
  });
  useCall.setState({ atTable: true });
  if (plan.fold) setMinimised(true);
  chairCreak({ x: v.x, y: 0.4, z: v.z });
}

function ChairTarget({ i, label }: { i: number; label: string }) {
  const c = MEETING_CHAIRS[i];
  const ref = useInteractable<THREE.Mesh>({ id: `meeting-chair-${i}`, label, action: { kind: 'meeting', seat: i } }, 3);
  return (
    <mesh ref={ref} position={[c.x, 0.6, c.z]} visible={false}>
      <boxGeometry args={[0.6, 1.2, 0.6]} />
    </mesh>
  );
}

// ---------- the CEO ----------

type Where = 'office' | 'going' | 'room' | 'back';

/** Walks the CEO to the table's head while a call is on, and back to their desk after. */
function useCeoAtTheTable() {
  const run = useRef<{ where: Where; legs: Pt[]; leg: number; gesture: string; mine?: BodyTarget }>({ where: 'office', legs: [], leg: 0, gesture: '' });
  /** Moves the CEO, remembering the target so another mover taking over shows. */
  const move = (patch: Partial<Omit<BodyTarget, 'teleport'>>) => {
    setBody(CEO_ID, patch);
    run.current.mine = bodyTarget(CEO_ID);
  };

  const route = (to: Pt, where: Where) => {
    const r = run.current;
    const s = bodyState(CEO_ID);
    const from = s && (s.stage === 'seated' || s.stage === 'rising' ? { x: s.standX, z: s.standZ } : { x: s.x, z: s.z });
    const path = from && findPath(walkways('lobby'), from, to);
    r.where = where;
    r.gesture = '';
    if (from && path?.length) {
      r.legs = [from, ...path];
      r.leg = 1;
      move({ mode: 'walking', x: r.legs[1].x, z: r.legs[1].z, speed: HURRY_SPEED, heading: 0, gesture: 'none' });
      return;
    }
    // not drawn yet, or no way through: they're there already
    r.legs = [];
    if (where === 'going') {
      placeBody(CEO_ID, MEETING_HEAD.x, MEETING_HEAD.z, HEAD_HEADING);
      r.mine = bodyTarget(CEO_ID);
      r.where = 'room';
    } else {
      seatBody(CEO_ID);
      r.where = 'office';
    }
  };

  useEffect(() => {
    // arriving in the lobby mid-call: the CEO is at the table already
    if (ceoAtCall(useCall.getState().call).inRoom) {
      placeBody(CEO_ID, MEETING_HEAD.x, MEETING_HEAD.z, HEAD_HEADING);
      run.current.mine = bodyTarget(CEO_ID);
      run.current.where = 'room';
    }
    const r = run.current;
    return () => {
      if (r.where !== 'office') seatBody(CEO_ID);
      r.where = 'office';
    };
  }, []);

  useFrame(() => {
    const r = run.current;
    const want = ceoAtCall(useCall.getState().call);
    if (want.inRoom && (r.where === 'office' || r.where === 'back')) {
      if (onErrand(CEO_ID)) claimBody(CEO_ID); // a call beats a stroll
      route(MEETING_HEAD, 'going');
    } else if (!want.inRoom && (r.where === 'going' || r.where === 'room')) {
      const home = spot(walkways('lobby'), 'ceo');
      if (home) route(home, 'back');
    }
    // someone else moved them meanwhile (the CEO's walk round the floors, the probe): set off again from where they are
    const taken = r.where !== 'office' && bodyTarget(CEO_ID) !== r.mine;
    if (taken && (r.where === 'going' || r.where === 'room')) route(MEETING_HEAD, 'going');
    if (r.where === 'room') {
      if (r.gesture !== want.gesture) move({ mode: 'standing', x: MEETING_HEAD.x, z: MEETING_HEAD.z, heading: HEAD_HEADING, gesture: want.gesture });
      r.gesture = want.gesture;
      return;
    }
    if (r.where !== 'going' && r.where !== 'back') return;
    const s = bodyState(CEO_ID);
    const p = r.legs[r.leg];
    const last = r.leg === r.legs.length - 1;
    if (!s || !p || s.stage !== 'up' || Math.hypot(p.x - s.x, p.z - s.z) > (last ? ARRIVED : CORNER)) return;
    if (!last) {
      r.leg++;
      const q = r.legs[r.leg];
      move({ mode: 'walking', x: q.x, z: q.z, speed: HURRY_SPEED, heading: 0, gesture: 'none' });
    } else if (r.where === 'going') {
      r.where = 'room'; // the gesture is set next frame
    } else {
      seatBody(CEO_ID);
      r.where = 'office';
    }
  });
}

// ---------- the room ----------

export function MeetingRoom() {
  const m = MEETING_ROOM;
  const on = useCall((s) => inCall(s.call));
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'CEO');
  const label = chairLabel(on, ceo);
  const demo = useStore((s) => s.demo);
  const started = useStore((s) => s.started);
  useCeoAtTheTable();
  useEffect(() => {
    const want = demoMeeting(window.location.search, demo);
    if (want.call && !callOn()) startCall();
    if (want.seat && started) sitAtMeeting(0); // once you're in the office
  }, [demo, started]);
  // leaving the lobby gets you up from the table
  useEffect(
    () => () => {
      if (perch()?.id.startsWith(PERCH)) leavePerch();
    },
    [],
  );
  return (
    <group>
      <Rug position={[(m.minX + m.maxX) / 2, 0.005, (m.minZ + m.maxZ) / 2]} size={[m.maxX - m.minX, m.maxZ - m.minZ]} color="#d8e2f3" />
      <GlassWall from={[m.minX, m.minZ]} to={[m.maxX, m.minZ]} />
      <GlassWall from={[m.minX, m.maxZ]} to={[m.doorMinX, m.maxZ]} />
      <GlassWall from={[m.doorMaxX, m.maxZ]} to={[m.maxX, m.maxZ]} />
      <Box size={[m.doorMaxX - m.doorMinX, 0.5, 0.1]} position={[(m.doorMinX + m.doorMaxX) / 2, 2.55, m.maxZ]} color="#8d99ae" />
      <WallSign
        position={[(m.doorMinX + m.doorMaxX) / 2, 3.1, m.maxZ + 0.06]}
        rotationY={0}
        size={[3.4, 0.5]}
        px={[816, 120]}
        draw={(ctx) => drawSign(ctx, 816, 120, [{ text: on ? `MEETING · on a call with ${ceo}` : 'MEETING ROOM', size: 48 }], ACCENT)}
        deps={[on, ceo]}
      />
      {/* the "on air" light over the door, lit while a call is on */}
      <mesh position={[(m.doorMinX + m.doorMaxX) / 2 + 1.9, 3.1, m.maxZ + 0.06]} material={glow(on ? '#e63946' : '#6c757d')}>
        <sphereGeometry args={[0.09, 12, 8]} />
      </mesh>
      <MeetingSet />
      {MEETING_CHAIRS.map((_, i) => (
        <ChairTarget key={i} i={i} label={label} />
      ))}
      <Plant position={[m.minX + 0.6, 0, m.minZ + 0.6]} scale={0.9} pot={ACCENT} />
    </group>
  );
}
