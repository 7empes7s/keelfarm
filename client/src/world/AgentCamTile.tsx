// An agent's camera (#539): their character live, head and shoulders at their desk, their monitor glowing behind them
// with their task, in their floor's theme colours. Alive: breathing, blinking, looking into the lens, a wave as it
// comes on, talking with their voice's level (agentCamera.ts mouthOpen), a thinking pose while the CEO works on an
// answer. One small renderer of its own, as the meeting room's view (MeetingTile.tsx): CAM_PX square at CAM_FPS at most,
// no frames while the tile is closed, the tab hidden or the tile off screen, so the office's frame rate pays nothing.
import { useEffect, useMemo, useRef } from 'react';
import { createRoot, extend, useFrame, type ReconcilerRoot } from '@react-three/fiber';
import * as THREE from 'three';
import { CEO_ID } from '../../../shared/types';
import { FLOOR_THEME_INFO, floorThemeOf } from '../../../shared/floorThemes';
import { useStore } from '../store';
import { camDue, camPose, CAM_FPS, CAM_PX, mouthOpen, speechLevel, type CamPose } from '../ui/agentCamera';
import { camProbe, useCamera } from '../ui/agentCameraStore';
import { useAgentCall } from '../ui/agentCallStore';
import { useCall } from '../ui/voiceCallStore';
import { appearanceFor } from './appearance';
import { toolVerb } from './draw';
import { blink, MORPH_AT, MOUTH, newFace, stepFace, type Expression } from './face';
import { applyFace } from './Figure';
import { HANG, StandingFigure } from './LookPreview';
import { toon } from './materials';
import { hashString } from './typing';

/** The tile's size on screen; CAM_PX pixels across at its DPR. */
const CAM_CSS = 180;
const LOOK_AT = new THREE.Vector3(0.14, 1.4, 0);

let shared: Promise<{ canvas: HTMLCanvasElement; root: ReconcilerRoot<HTMLCanvasElement> }> | null = null;

function camRoot() {
  shared ??= (async () => {
    // <Canvas> registers three's objects with R3F; a bare root must, or it fails where no Canvas ran first (pocket mode).
    extend(THREE as unknown as Parameters<typeof extend>[0]);
    const canvas = document.createElement('canvas');
    const root = createRoot(canvas);
    await root.configure({
      size: { width: CAM_CSS, height: CAM_CSS, top: 0, left: 0 },
      dpr: CAM_PX / CAM_CSS,
      gl: { antialias: false, preserveDrawingBuffer: true }, // drawn at 2× its size already: no MSAA, which software WebGL pays dearly for
      camera: { fov: 34, near: 0.1, far: 20, position: [0.05, 1.52, 2.05] },
      frameloop: 'never',
      onCreated: ({ camera }) => camera.lookAt(LOOK_AT),
    });
    return { canvas, root };
  })();
  return shared;
}

/** The right arm's pitch and yaw off hanging, and the head's pitch and roll, for each pose. */
const POSE: Record<CamPose, { arm: number; yaw: number; head: number; roll: number }> = {
  wave: { arm: 2.7, yaw: -0.35, head: 0.04, roll: 0.06 },
  talk: { arm: 0.7, yaw: -0.3, head: 0.03, roll: 0 },
  think: { arm: 2.0, yaw: -0.95, head: 0.1, roll: -0.12 },
  idle: { arm: 0, yaw: 0, head: 0, roll: 0 },
};
const FACE: Record<CamPose, Expression> = { wave: 'joyful', talk: 'joyful', think: 'focused', idle: 'neutral' };

/** The voice's level for whoever is on camera: QA's fake level, the Jarvis voice's, the call's speech, or their greeting. */
function voiceLevel(id: string, t: number, now: number): number {
  const cam = useCamera.getState();
  if (cam.level !== null) return cam.level;
  if (now < cam.sayUntil) return speechLevel(t);
  if (id !== CEO_ID) return 0;
  const agent = useAgentCall.getState();
  if (agent.mode !== 'off') return agent.output;
  const { call } = useCall.getState();
  return call.phase === 'speaking' && !call.paused ? speechLevel(t) : 0;
}

function Person({ id }: { id: string }) {
  const agent = useStore((s) => s.agents[id]);
  const look = useMemo(() => (agent ? appearanceFor(agent) : null), [agent]);
  const body = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const faceMesh = useRef<THREE.Mesh>(null);
  const st = useMemo(() => ({ s: newFace(), seed: hashString(id) % 10007, last: performance.now(), arm: 0, yaw: 0, head: 0, roll: 0, mouth: 0 }), [id]);
  useFrame(() => {
    const now = performance.now();
    const dt = Math.min((now - st.last) / 1000, 0.2);
    st.last = now;
    const t = now / 1000;
    const cam = useCamera.getState();
    const level = voiceLevel(id, t, Date.now());
    const a = useStore.getState().agents[id];
    const thinking = id === CEO_ID ? useCall.getState().call.phase === 'thinking' : a?.status === 'working';
    const pose = camPose(Date.now() - cam.since, level, thinking);
    const p = POSE[pose];
    const k = 1 - Math.exp(-dt * 8);
    st.arm += (p.arm - st.arm) * k;
    st.yaw += (p.yaw - st.yaw) * k;
    st.head += (p.head - st.head) * k;
    st.roll += (p.roll - st.roll) * k;
    st.mouth += (mouthOpen(level) - st.mouth) * (1 - Math.exp(-dt * 22));
    if (body.current) body.current.position.y = Math.sin(t * 1.6) * 0.006; // breathing
    if (arm.current) {
      arm.current.rotation.x = HANG.pitch + st.arm;
      arm.current.rotation.y = -HANG.yaw + st.yaw + (pose === 'wave' ? Math.sin(t * 10) * 0.45 : 0);
    }
    if (head.current) {
      head.current.rotation.x = st.head + (pose === 'talk' ? Math.sin(t * 5.3) * 0.04 * st.mouth : 0);
      head.current.rotation.z = st.roll + Math.sin(t * 0.7) * 0.02;
    }
    stepFace(st.s, FACE[pose], dt);
    applyFace(faceMesh, st.s, blink(t, st.seed));
    const w = faceMesh.current?.morphTargetInfluences;
    if (w) {
      w[MORPH_AT.mouth + MOUTH.open] = Math.max(w[MORPH_AT.mouth + MOUTH.open], st.mouth);
      w[MORPH_AT.mouth + MOUTH.grin] *= 1 - st.mouth * 0.7;
    }
    camProbe.mouth = st.mouth;
    camProbe.frames++;
  });
  if (!agent || !look) return null;
  return (
    <group ref={body} rotation={[0, Math.PI, 0]}>
      <StandingFigure agent={agent} look={look} face={faceMesh} arm={arm} head={head} />
    </group>
  );
}

/** Their monitor's screen: the task and what they're doing now, drawn when it changes. */
function useScreen(id: string) {
  const a = useStore((s) => s.agents[id]);
  const issue = a?.issueNumber ? `#${a.issueNumber} ${a.issueTitle ?? ''}` : a?.role === 'ceo' ? 'Running the office' : 'No task right now';
  const doing = a?.currentTool ? toolVerb(a.currentTool) : a?.status === 'working' ? 'Working…' : a?.status ?? '';
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => {
    const c = tex.image as HTMLCanvasElement;
    const g = c.getContext('2d');
    if (!g) return;
    g.fillStyle = '#14182b';
    g.fillRect(0, 0, c.width, c.height);
    g.font = 'bold 18px system-ui, sans-serif';
    g.fillStyle = '#7ee0a8';
    g.fillText('$ cubefarm', 12, 28);
    g.fillStyle = '#e8ecff';
    g.font = '16px system-ui, sans-serif';
    const words = issue.split(' ');
    let line = '';
    let y = 58;
    for (const w of words) {
      if (g.measureText(`${line} ${w}`).width > 232 && line) {
        g.fillText(line, 12, y);
        line = w;
        y += 22;
        if (y > 102) break;
      } else line = line ? `${line} ${w}` : w;
    }
    if (y <= 102) g.fillText(line, 12, y);
    g.fillStyle = '#ffd166';
    g.fillText(`> ${doing}`, 12, 146);
    tex.needsUpdate = true;
  }, [tex, issue, doing]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

function Scene({ id }: { id: string }) {
  const theme = useStore((s) => {
    const a = s.agents[id];
    return floorThemeOf(s.repos.find((r) => r.id === a?.repoId)?.theme);
  });
  const [wall, trim, accent] = FLOOR_THEME_INFO[theme].swatch;
  const screen = useScreen(id);
  return (
    <>
      <color attach="background" args={[wall]} />
      <hemisphereLight args={['#fffaf0', '#a48a6a', 1]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[1.2, 3, 3]} intensity={1.5} />
      <mesh position={[0, 1.6, -1.6]} material={toon(wall)}>
        <planeGeometry args={[6, 4]} />
      </mesh>
      <mesh position={[0, 2.05, -1.58]} material={toon(accent)}>
        <planeGeometry args={[6, 0.08]} />
      </mesh>
      <mesh position={[0, 0.74, -0.75]} material={toon(trim)}>
        <boxGeometry args={[2.2, 0.06, 0.8]} />
      </mesh>
      <group position={[0.62, 1.22, -0.85]} rotation={[0, -0.18, 0]}>
        <mesh material={toon('#2b2f45')}>
          <boxGeometry args={[0.86, 0.54, 0.05]} />
        </mesh>
        <mesh position={[0, 0, 0.027]}>
          <planeGeometry args={[0.8, 0.48]} />
          <meshBasicMaterial map={screen} toneMapped={false} />
        </mesh>
        <pointLight position={[0, 0, 0.3]} intensity={0.6} distance={1.4} color="#9fb8ff" />
      </group>
      <Person id={id} />
    </>
  );
}

/** The live camera of agent `id`, for the camera tile (ui/CameraTile.tsx); it's gone once the tile closes. */
export default function AgentCamTile({ id, label }: { id: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let shown: { root: ReconcilerRoot<HTMLCanvasElement>; canvas: HTMLCanvasElement } | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let onScreen = true;
    let last = -Infinity;
    let cost = 0; // how long the last frame took to draw
    const seen = new IntersectionObserver(([e]) => (onScreen = e.isIntersecting));
    camRoot().then(
      ({ canvas, root }) => {
        if (!live || !host.current) return;
        host.current.appendChild(canvas);
        const store = root.render(<Scene id={id} />);
        seen.observe(host.current);
        shown = { root, canvas };
        timer = setInterval(() => {
          const now = performance.now();
          if (!camDue(now, last, { hidden: document.visibilityState === 'hidden', onScreen }, cost)) return;
          last = now;
          const { advance, gl } = store.getState();
          advance(now);
          gl.getContext().finish(); // the frame's GPU work too (a moment on a GPU, the bulk in software WebGL), so camFps sees it
          cost = performance.now() - now;
        }, 1000 / CAM_FPS);
      },
      (err) => console.warn('No agent camera:', err),
    );
    return () => {
      live = false;
      clearInterval(timer);
      seen.disconnect();
      if (!shown) return;
      shown.root.render(null);
      shown.canvas.remove();
    };
  }, [id]);
  return <div ref={host} className="cam-view" role="img" aria-label={label} />;
}
