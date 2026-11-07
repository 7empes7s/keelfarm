// The map table in the CEO's office (#137): a round table with a little constellation turning over its glass top.
// E or a click (or a click from the overview) walks into the map room, ui/MapRoom.tsx, which loads only then.
import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useKeyName } from '../ui/controls';
import { reduceMotion } from '../ui/a11y';
import { drawSign } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { MAP_TABLE } from './layout';
import { glow } from './materials';
import { Cyl } from './Toon';

const DOTS: [number, number, number, string][] = [
  [0, 0.32, 0, '#ff9f1c'],
  [0.3, 0.18, 0.1, '#ffd166'],
  [-0.26, 0.24, 0.16, '#8fb3ff'],
  [0.08, 0.44, -0.28, '#80ed99'],
  [-0.16, 0.12, -0.24, '#4cc9f0'],
  [0.22, 0.4, 0.24, '#c77dff'],
  [-0.3, 0.46, -0.04, '#ffd166'],
];
const dot = new THREE.SphereGeometry(1, 12, 8);

export function MapTable() {
  const use = useKeyName('interact');
  const ref = useInteractable<THREE.Group>({ id: 'map-table', label: 'Walk into the map room', action: { kind: 'mapRoom' } }, 3);
  const sky = useRef<THREE.Group>(null);
  const sign = useCanvasTexture(512, 128, (ctx) => drawSign(ctx, 512, 128, [{ text: '🌌 Map room', size: 46 }, { text: `press ${use}`, size: 28, weight: 500 }], '#3c2a63'), [use]);
  useFrame((_, dt) => {
    if (sky.current && !reduceMotion()) sky.current.rotation.y += dt * 0.4;
  });
  return (
    <group ref={ref} position={[MAP_TABLE.x, 0, MAP_TABLE.z]}>
      <Cyl r={0.14} h={0.8} position={[0, 0.4, 0]} color="#495057" />
      <Cyl r={0.42} rTop={0.3} h={0.06} position={[0, 0.03, 0]} color="#343a40" outline />
      <Cyl r={MAP_TABLE.r} h={0.08} position={[0, 0.84, 0]} color="#2b2d42" outline />
      <mesh position={[0, 0.885, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[MAP_TABLE.r - 0.06, 32]} />
        <meshBasicMaterial color="#1b1f3b" toneMapped={false} />
      </mesh>
      <group ref={sky} position={[0, 0.95, 0]}>
        {DOTS.map(([x, y, z, c], i) => (
          <mesh key={i} geometry={dot} material={glow(c)} position={[x, y, z]} scale={i === 0 ? 0.07 : 0.045} />
        ))}
      </group>
      <mesh position={[0, 1.85, 0]}>
        <planeGeometry args={[1, 0.25]} />
        <meshBasicMaterial map={sign} transparent toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
