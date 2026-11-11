// The call window's live view of the meeting room (#369): the CEO at the table's head with the wall screen behind them,
// seen from the far chair, like a video call's tile. One small renderer of its own, as the look preview's
// (LookPreview.tsx), so it shows whatever floor you're on and in pocket mode: made the first time a call window opens and
// kept, its canvas moves into whichever tile shows. It draws at most TILE_FPS frames a second, and none while the window
// is folded, the tab hidden or the tile off screen (meeting.ts tileDue), so it costs the office's own frame rate nothing.
import { useEffect, useMemo, useRef } from 'react';
import { createRoot, extend, useFrame, type ReconcilerRoot } from '@react-three/fiber';
import * as THREE from 'three';
import { CEO_ID } from '../../../shared/types';
import { useStore } from '../store';
import { useCall } from '../ui/voiceCallStore';
import { appearanceFor } from './appearance';
import { blink, newFace, stepFace } from './face';
import { MEETING_HEAD, MEETING_ROOM } from './layout';
import { HANG, StandingFigure } from './LookPreview';
import { ceoAtCall, chairView, TILE_FPS, tileDue } from './meeting';
import { MeetingSet } from './MeetingSet';
import { GlassWall, Rug } from './Props';
import { hashString } from './typing';
import { applyFace } from './Figure';

const SIZE = { width: 320, height: 200 };
const EYE = chairView(0);
const LOOK_AT = new THREE.Vector3(MEETING_HEAD.x + 1, 1.75, MEETING_HEAD.z);

let shared: Promise<{ canvas: HTMLCanvasElement; root: ReconcilerRoot<HTMLCanvasElement> }> | null = null;

function tileRoot() {
  shared ??= (async () => {
    // <Canvas> registers three's objects with R3F; a bare root must, or it fails where no Canvas ran first (pocket mode).
    extend(THREE as unknown as Parameters<typeof extend>[0]);
    const canvas = document.createElement('canvas');
    const root = createRoot(canvas);
    await root.configure({
      size: { ...SIZE, top: 0, left: 0 },
      dpr: [1, 2],
      gl: { antialias: true },
      camera: { fov: 40, near: 0.1, far: 30, position: [EYE.x, EYE.y, EYE.z] },
      scene: { background: new THREE.Color('#f4ece1') },
      frameloop: 'never',
      onCreated: ({ camera }) => camera.lookAt(LOOK_AT),
    });
    return { canvas, root };
  })();
  return shared;
}

/** How the CEO's right arm (its pitch and yaw off hanging) and head (pitch) sit for each gesture of the call. */
const POSE: Record<string, { arm: number; yaw: number; head: number }> = {
  wave: { arm: 2.6, yaw: -0.3, head: 0.05 },
  talk: { arm: 0.95, yaw: -0.35, head: 0.04 },
  tap: { arm: 0.45, yaw: -0.1, head: -0.16 },
  nod: { arm: 0, yaw: 0, head: -0.03 },
  none: { arm: 0, yaw: 0, head: 0 },
};

function Ceo() {
  const agent = useStore((s) => s.agents[CEO_ID]);
  const look = useMemo(() => (agent ? appearanceFor(agent) : null), [agent]);
  const arm = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const faceMesh = useRef<THREE.Mesh>(null);
  const face = useMemo(() => ({ s: newFace(), seed: hashString(CEO_ID) % 10007, last: performance.now(), arm: 0, yaw: 0, head: 0 }), []);
  useFrame(() => {
    // its own clock: frames come a dozen a second, and not at all while the tile is put away
    const now = performance.now();
    const dt = Math.min((now - face.last) / 1000, 0.2);
    face.last = now;
    const t = now / 1000;
    const want = ceoAtCall(useCall.getState().call);
    const p = POSE[want.gesture] ?? POSE.none;
    const k = 1 - Math.exp(-dt * 8);
    face.arm += (p.arm - face.arm) * k;
    face.yaw += (p.yaw - face.yaw) * k;
    face.head += (p.head - face.head) * k;
    const talk = want.gesture === 'talk' ? 1 : 0;
    if (arm.current) {
      arm.current.rotation.x = HANG.pitch + face.arm + Math.sin(t * 4.3) * 0.2 * talk;
      arm.current.rotation.y = -HANG.yaw + face.yaw + Math.sin(t * (want.gesture === 'wave' ? 9 : 2.6)) * (want.gesture === 'wave' ? 0.4 : 0.2 * talk);
    }
    if (head.current) head.current.rotation.x = face.head + (want.gesture === 'nod' ? Math.sin(t * 2.4) * 0.07 : 0);
    stepFace(face.s, want.expression, dt);
    applyFace(faceMesh, face.s, blink(t, face.seed));
  });
  if (!agent || !look) return null;
  return (
    <group position={[MEETING_HEAD.x, 0, MEETING_HEAD.z]} rotation={[0, Math.PI / 2, 0]}>
      <StandingFigure agent={agent} look={look} face={faceMesh} arm={arm} head={head} />
    </group>
  );
}

function Scene() {
  const m = MEETING_ROOM;
  return (
    <>
      <hemisphereLight args={['#fff4e0', '#a48a6a', 1]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[m.minX, 3.4, m.maxZ]} intensity={1.4} />
      <Rug position={[(m.minX + m.maxX) / 2, 0, (m.minZ + m.maxZ) / 2]} size={[m.maxX - m.minX, m.maxZ - m.minZ]} color="#d8e2f3" />
      <GlassWall from={[m.minX, m.minZ]} to={[m.maxX, m.minZ]} />
      <GlassWall from={[m.minX, m.maxZ]} to={[m.maxX, m.maxZ]} />
      <MeetingSet />
      <Ceo />
    </>
  );
}

/** The live view of the meeting room, for the call window. */
export default function MeetingTile({ label }: { label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let shown: { root: ReconcilerRoot<HTMLCanvasElement>; canvas: HTMLCanvasElement } | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let onScreen = true;
    let last = -Infinity;
    const seen = new IntersectionObserver(([e]) => (onScreen = e.isIntersecting));
    tileRoot().then(
      ({ canvas, root }) => {
        if (!live || !host.current) return;
        host.current.appendChild(canvas);
        const store = root.render(<Scene />);
        seen.observe(host.current);
        shown = { root, canvas };
        timer = setInterval(() => {
          const now = performance.now();
          if (!tileDue(now, last, { folded: useCall.getState().minimised, hidden: document.visibilityState === 'hidden', onScreen })) return;
          last = now;
          store.getState().advance(now);
        }, 1000 / TILE_FPS);
      },
      (err) => console.warn('No meeting room view:', err),
    );
    return () => {
      live = false;
      clearInterval(timer);
      seen.disconnect();
      if (!shown) return;
      shown.root.render(null);
      shown.canvas.remove();
    };
  }, []);
  return <div ref={host} className="vcall-tile" role="img" aria-label={label} />;
}
