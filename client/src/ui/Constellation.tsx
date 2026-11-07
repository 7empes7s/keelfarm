// The map room's stage (#137): the memory map as a 3D constellation in its own small R3F canvas, the stage
// MemoryMap.tsx draws the graph with in the map room (MapRoom.tsx) instead of the 2D canvas. Floors are clusters,
// objectives bright hubs, agents in their shirts' colours. Drag orbits, pinch or wheel zooms; a tap or click selects
// (tap again or double-click flies there), a long press or right click opens the card. Stars, halos, sparks and task
// lights are instanced, links one line batch, labels only near the camera (skyLayout.ts has the rules).
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import type { MapChange, MapNode } from '../../../shared/memoryMap';
import { useStore } from '../store';
import { MAX_DPR, StatsProbe, statsEnabled } from '../perf';
import { reduceMotion } from './a11y';
import { tone } from './sfx';
import { bounds, createSky, labelIds, lightAt, settleSky, sparkParticles, starDetail, taskLights, tickSky, SPARK_MS, type Sky, type Star } from './skyLayout';
import type { MapStageProps } from './MapCanvas';

const BG = '#0b0d1a';
const HUBS = new Set<MapNode['type']>(['company', 'floor', 'objective', 'ceo']);
const GROW_MS = 700;
const FLY_MS = 900;
const LIGHTS_MAX = 64;
const FX_MAX = 256;
const capacityFor = (n: number) => Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, n))));

/** The merge chime: a bright rising triad (the alerts group's level and mute apply, like every office sound). */
const chime = () => [784, 988, 1319].forEach((freq, i) => tone({ name: 'map:merge', group: 'alerts', freq, type: 'triangle', at: i * 0.09, dur: 0.5, peak: 0.08 }));

export function Constellation(props: MapStageProps) {
  const down = useRef({ x: 0, y: 0 });
  return (
    <div className="mm-canvas mr-canvas" onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}>
      <Canvas
        dpr={[1, MAX_DPR]}
        camera={{ fov: 50, near: 0.1, far: 1500, position: [0, 20, 70] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={(e) => Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) < 8 && props.onSelect(null)}
        aria-label="The memory map as a constellation"
      >
        <color attach="background" args={[BG]} />
        <fog attach="fog" args={[BG, 80, 260]} />
        <ambientLight intensity={1.1} />
        <directionalLight position={[30, 50, 40]} intensity={1.6} />
        <Scene {...props} />
        {statsEnabled && <StatsProbe paused={false} />}
      </Canvas>
      <div className="mr-hint small" aria-hidden>
        Drag to turn · pinch or scroll to zoom · tap a star, tap again to fly there
      </div>
    </div>
  );
}

const tmp = new THREE.Object3D();
const colour = new THREE.Color();
const faded = new THREE.Color(BG);
const gold = new THREE.Color('#ffd166');
const spark = new THREE.Color('#ff9f1c');
const lightColour = new THREE.Color('#7cffb2');

function Scene({ graph, paint, selected, lit, pulses, centre, onSelect, onMenu }: MapStageProps) {
  const agents = useStore((s) => s.agents);
  const camera = useThree((s) => s.camera);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const stars = useRef<THREE.InstancedMesh>(null);
  const halos = useRef<THREE.InstancedMesh>(null);
  const lights = useRef<THREE.InstancedMesh>(null);
  const fx = useRef<THREE.InstancedMesh>(null);
  const lines = useRef<THREE.LineSegments>(null);
  const sky = useRef<Sky>({ stars: [], links: [], alpha: 0 });
  const born = useRef(new Map<string, number>());
  const live = useRef<{ id: string; kind: MapChange['kind']; t0: number }[]>([]);
  const fly = useRef<{ t0: number; target: [THREE.Vector3, THREE.Vector3]; cam: [THREE.Vector3, THREE.Vector3] } | null>(null);
  const fitted = useRef(false);
  const idleAt = useRef(0);
  const labelAt = useRef(0);
  const labelRefs = useRef(new Map<string, THREE.Group>());
  const [labels, setLabels] = useState<string[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const reduce = reduceMotion();
  const count = graph.nodes.length;
  const capacity = capacityFor(count);
  const detail = starDetail(count);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const index = useMemo(() => new Map(graph.nodes.map((n, i) => [n.id, i])), [graph]);
  const edgeIdx = useMemo(() => graph.edges.map((e) => [index.get(e.source) ?? -1, index.get(e.target) ?? -1] as const).filter(([a, b]) => a >= 0 && b >= 0), [graph, index]);
  const tasks = useMemo(() => taskLights(graph).map((l) => [index.get(l.source)!, index.get(l.target)!] as const), [graph, index]);
  const linePositions = useMemo(() => new Float32Array(Math.max(1, edgeIdx.length) * 6), [edgeIdx]);
  const lineColours = useMemo(() => new Float32Array(Math.max(1, edgeIdx.length) * 6), [edgeIdx]);

  // the layout: kept across builds, so a live change or the time slider only adds or nudges stars
  useEffect(() => {
    const prev = new Map(sky.current.stars.map((s) => [s.id, s]));
    const now = performance.now();
    if (prev.size && !reduce) for (const n of graph.nodes) if (!prev.has(n.id)) born.current.set(n.id, now);
    sky.current = createSky(graph.nodes, graph.edges, prev);
    if (reduce || !prev.size) settleSky(sky.current, reduce ? 300 : 120);
  }, [graph, reduce]);

  // colours: the map's paint, agents in their shirts' colours, hubs glowing, what the selection doesn't light fading
  useEffect(() => {
    const s = stars.current;
    const h = halos.current;
    if (!s || !h) return;
    graph.nodes.forEach((n, i) => {
      const agent = paint.byType && n.type === 'agent' && n.target?.kind === 'agent' ? agents[n.target.agentId] : undefined;
      colour.set(agent?.color ?? paint.fill(n));
      if (lit && !lit.has(n.id)) colour.lerp(faded, 0.78);
      s.setColorAt(i, colour);
      colour.set(n.id === selected ? '#ffbf3c' : (paint.ring(n) ?? (agent?.color ?? paint.fill(n))));
      if (lit && !lit.has(n.id)) colour.lerp(faded, 0.9);
      h.setColorAt(i, colour);
    });
    if (s.instanceColor) s.instanceColor.needsUpdate = true;
    if (h.instanceColor) h.instanceColor.needsUpdate = true;
    for (let k = 0; k < edgeIdx.length; k++) {
      const [a, b] = edgeIdx[k];
      const on = !!lit && lit.has(graph.nodes[a].id) && lit.has(graph.nodes[b].id);
      const v = lit ? (on ? 0.85 : 0.06) : 0.28;
      lineColours.fill(v, k * 6, k * 6 + 6);
    }
    const attr = lines.current?.geometry.getAttribute('color');
    if (attr) attr.needsUpdate = true;
  }, [graph, paint, lit, selected, agents, edgeIdx, lineColours, capacity, detail]);

  // live changes: sparks and bursts, and a chime for a merge
  useEffect(() => {
    if (!pulses.changes.length) return;
    if (pulses.changes.some((c) => c.kind === 'merged')) chime();
    if (reduce) return;
    const t0 = performance.now();
    live.current.push(...pulses.changes.filter((c) => c.kind !== 'changed').map((c) => ({ ...c, t0 })));
  }, [pulses, reduce]);

  const flyTo = (id: string) => {
    const s = sky.current.stars[index.get(id) ?? -1];
    const c = controls.current;
    if (!s || !c) return;
    const to = new THREE.Vector3(s.x, s.y, s.z);
    const dir = camera.position.clone().sub(c.target).normalize();
    const cam = to.clone().add(dir.multiplyScalar(6 + s.r * 6));
    if (reduce) {
      c.target.copy(to);
      camera.position.copy(cam);
      c.update();
      return;
    }
    fly.current = { t0: performance.now(), target: [c.target.clone(), to], cam: [camera.position.clone(), cam] };
  };
  // only a new search pick moves the camera, flying to where its star is now
  const flyLatest = useRef(flyTo);
  flyLatest.current = flyTo;
  useEffect(() => {
    if (centre) flyLatest.current(centre.id);
  }, [centre]);

  useFrame((state) => {
    const now = performance.now();
    const sk = sky.current;
    const c = controls.current;
    if (!reduce) tickSky(sk);
    if (!fitted.current && sk.stars.length && c) {
      const b = bounds(sk.stars);
      c.target.set(b.centre.x, b.centre.y, b.centre.z);
      camera.position.set(b.centre.x, b.centre.y + b.radius * 0.55, b.centre.z + b.radius * 2.2 + 8);
      c.update();
      fitted.current = true;
    }
    if (fly.current && c) {
      const t = Math.min(1, (now - fly.current.t0) / FLY_MS);
      const e = t * t * (3 - 2 * t);
      c.target.lerpVectors(fly.current.target[0], fly.current.target[1], e);
      camera.position.lerpVectors(fly.current.cam[0], fly.current.cam[1], e);
      if (t >= 1) fly.current = null;
    }
    // gentle idle rotation, back a few seconds after the last drag
    if (c) c.autoRotate = !reduce && !fly.current && now > idleAt.current;

    const s = stars.current;
    const h = halos.current;
    if (s && h) {
      for (let i = 0; i < sk.stars.length; i++) {
        const st = sk.stars[i];
        const n = graph.nodes[i];
        const b = born.current.get(st.id);
        let grow = 1;
        if (b !== undefined) {
          grow = Math.min(1, (now - b) / GROW_MS);
          if (grow >= 1) born.current.delete(st.id);
          grow = 1 - (1 - grow) ** 3;
        }
        const r = st.r * grow * (st.id === selected ? 1.3 : 1);
        tmp.position.set(st.x, st.y, st.z);
        tmp.scale.setScalar(Math.max(0.0001, r));
        tmp.updateMatrix();
        s.setMatrixAt(i, tmp.matrix);
        const halo = n && (HUBS.has(n.type) || st.id === selected || !!paint.ring(n));
        tmp.scale.setScalar(halo ? r * (HUBS.has(n.type) ? 2.1 : 1.6) : 0.0001);
        tmp.updateMatrix();
        h.setMatrixAt(i, tmp.matrix);
      }
      s.count = h.count = sk.stars.length;
      s.instanceMatrix.needsUpdate = true;
      h.instanceMatrix.needsUpdate = true;
      s.computeBoundingSphere();
    }
    const l = lines.current;
    if (l) {
      for (let k = 0; k < edgeIdx.length; k++) {
        const p = sk.stars[edgeIdx[k][0]];
        const q = sk.stars[edgeIdx[k][1]];
        if (!p || !q) continue;
        linePositions.set([p.x, p.y, p.z, q.x, q.y, q.z], k * 6);
      }
      l.geometry.getAttribute('position').needsUpdate = true;
      l.geometry.setDrawRange(0, edgeIdx.length * 2);
    }
    // agents' task lights run along their edges
    const lm = lights.current;
    if (lm) {
      const t = reduce ? 0.5 : state.clock.elapsedTime;
      let k = 0;
      for (const [a, b] of tasks) {
        const p = sk.stars[a];
        const q = sk.stars[b];
        if (!p || !q || k >= LIGHTS_MAX) continue;
        const f = reduce ? 0.5 : lightAt(t, k);
        tmp.position.set(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, p.z + (q.z - p.z) * f);
        tmp.scale.setScalar(0.22);
        tmp.updateMatrix();
        lm.setMatrixAt(k++, tmp.matrix);
      }
      lm.count = k;
      lm.instanceMatrix.needsUpdate = true;
    }
    // sparks and bursts
    const fm = fx.current;
    if (fm) {
      live.current = live.current.filter((p) => now - p.t0 < SPARK_MS);
      let k = 0;
      for (const p of live.current) {
        const st = sk.stars[index.get(p.id) ?? -1];
        if (!st) continue;
        for (const q of sparkParticles(p.kind, st, now - p.t0)) {
          if (k >= FX_MAX) break;
          tmp.position.set(q.x, q.y, q.z);
          tmp.scale.setScalar(q.size);
          tmp.updateMatrix();
          fm.setMatrixAt(k, tmp.matrix);
          fm.setColorAt(k, colour.copy(q.gold ? gold : spark).multiplyScalar(q.fade));
          k++;
        }
      }
      fm.count = k;
      fm.instanceMatrix.needsUpdate = true;
      if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    }
    for (const [id, g] of labelRefs.current) {
      const st = sk.stars[index.get(id) ?? -1];
      if (st) g.position.set(st.x, st.y + st.r + 0.35, st.z);
    }
    // labels only near the camera, checked a few times a second
    if (now - labelAt.current > 250) {
      labelAt.current = now;
      const ids = [...labelIds(sk.stars, camera.position, [selected, hover])];
      if (ids.length !== labels.length || ids.some((id, i) => id !== labels[i])) setLabels(ids);
    }
  });

  const starOf = (e: ThreeEvent<MouseEvent>): Star | null => (e.instanceId === undefined ? null : (sky.current.stars[e.instanceId] ?? null));
  return (
    <>
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} autoRotateSpeed={0.35} minDistance={2} maxDistance={400} onStart={() => ((fly.current = null), (idleAt.current = Infinity))} onEnd={() => (idleAt.current = performance.now() + 6000)} />
      <instancedMesh
        key={`stars-${capacity}-${detail}`}
        ref={stars}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
        onClick={(e) => {
          e.stopPropagation();
          const s = starOf(e);
          if (!s || e.delta > 8) return;
          if (s.id === selected) flyTo(s.id);
          else onSelect(s.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          const s = starOf(e);
          if (s) flyTo(s.id);
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          e.nativeEvent.preventDefault();
          const s = starOf(e);
          if (s) onMenu(s.id);
        }}
        onPointerMove={(e) => {
          const s = starOf(e);
          if (s && s.id !== hover) setHover(s.id);
        }}
        onPointerOut={() => setHover(null)}
      >
        <icosahedronGeometry args={[1, detail]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh key={`halos-${capacity}`} ref={halos} args={[undefined, undefined, capacity]} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <lineSegments ref={lines} frustumCulled={false} raycast={() => null}>
        <bufferGeometry key={edgeIdx.length}>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[lineColours, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      <instancedMesh ref={lights} args={[undefined, undefined, LIGHTS_MAX]} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial color={lightColour} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={fx} args={[undefined, undefined, FX_MAX]} frustumCulled={false} raycast={() => null}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {labels.map((id) => {
        const n = byId.get(id);
        if (!n) return null;
        return (
          <group key={id} ref={(g) => void (g ? labelRefs.current.set(id, g) : labelRefs.current.delete(id))}>
            <Html center zIndexRange={[2, 0]} className={`mr-label ${id === selected ? 'mr-label-on' : ''}`} pointerEvents="none">
              {HUBS.has(n.type) || id === selected || id === hover ? n.title : n.label}
            </Html>
          </group>
        );
      })}
    </>
  );
}
